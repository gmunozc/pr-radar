import { describe, expect, it, vi } from 'vitest'
import { actionErrorCode, mutationFor, runPrAction, type ActionTarget } from '../src/main/actions'
import { GithubError } from '../src/main/github'

const target: ActionTarget = { id: 'PR_1', headOid: 'abc', repo: 'acme/app', number: 12, reviewerIds: ['U_1', 'U_2'] }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('mutationFor', () => {
  it('names the mutation and passes the expected head commit', () => {
    const update = mutationFor(target, { kind: 'update_branch' })
    expect(update.query).toContain('updatePullRequestBranch')
    expect(update.variables).toEqual({ id: 'PR_1', head: 'abc' })

    const auto = mutationFor(target, { kind: 'enable_auto_merge', method: 'SQUASH' })
    expect(auto.query).toContain('enablePullRequestAutoMerge')
    expect(auto.variables).toEqual({ id: 'PR_1', head: 'abc', method: 'SQUASH' })

    expect(mutationFor(target, { kind: 'disable_auto_merge' })).toMatchObject({ variables: { id: 'PR_1' } })

    const merge = mutationFor(target, { kind: 'merge', method: 'REBASE' })
    expect(merge.query).toContain('mergePullRequest')
    expect(merge.variables).toEqual({ id: 'PR_1', head: 'abc', method: 'REBASE' })

    const again = mutationFor(target, { kind: 'rerequest_review' })
    expect(again.query).toContain('requestReviews')
    expect(again.variables).toEqual({ id: 'PR_1', users: ['U_1', 'U_2'] })

    const approve = mutationFor(target, { kind: 'approve', body: '  LGTM ' })
    expect(approve.query).toContain('event: APPROVE')
    expect(approve.variables).toEqual({ id: 'PR_1', head: 'abc', body: 'LGTM' })
  })

  it('omits the head commit when it is unknown and an empty comment', () => {
    expect(mutationFor({ ...target, headOid: '' }, { kind: 'merge', method: 'MERGE' }).variables).toEqual({
      id: 'PR_1',
      head: undefined,
      method: 'MERGE'
    })
    expect(mutationFor(target, { kind: 'approve', body: '   ' }).variables.body).toBeUndefined()
  })
})

describe('actionErrorCode', () => {
  const cases: Array<[string, { type?: string; message: string }, string]> = [
    ['forbidden', { type: 'FORBIDDEN', message: 'Resource not accessible by integration' }, 'forbidden'],
    ['not found', { type: 'NOT_FOUND', message: 'Could not resolve to a node' }, 'not_found'],
    ['already mergeable', { type: 'UNPROCESSABLE', message: 'Pull request is in clean status' }, 'already_mergeable'],
    ['stale head', { type: 'UNPROCESSABLE', message: 'Head branch was modified. Review and try the merge again.' }, 'stale'],
    ['expected head', { message: 'Expected head oid does not match current head' }, 'stale'],
    ['auto-merge off', { type: 'UNPROCESSABLE', message: 'Auto merge is not allowed for this repository' }, 'auto_merge_unavailable'],
    ['not mergeable', { type: 'UNPROCESSABLE', message: 'Pull Request is not mergeable' }, 'not_mergeable'],
    ['protected', { message: 'Required status check "ci" is expected.' }, 'not_mergeable'],
    ['unknown', { message: 'Something else' }, 'unknown']
  ]
  for (const [name, error, code] of cases) {
    it(name, () => expect(actionErrorCode([error]).code).toBe(code))
  }

  it('keeps every message as detail', () => {
    expect(actionErrorCode([{ message: 'a' }, { message: 'b' }]).detail).toBe('a; b')
  })
})

describe('runPrAction', () => {
  it('posts the mutation with the token and reports success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { mergePullRequest: { pullRequest: { merged: true } } } }))
    await expect(runPrAction('tok', target, { kind: 'merge', method: 'SQUASH' }, fetchFn)).resolves.toEqual({ ok: true })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.github.com/graphql')
    expect(init.headers.Authorization).toBe('Bearer tok')
    const sent = JSON.parse(init.body)
    expect(sent.query).toContain('mergePullRequest')
    expect(sent.variables).toEqual({ id: 'PR_1', head: 'abc', method: 'SQUASH' })
  })

  it('returns the classified GraphQL error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ data: null, errors: [{ type: 'UNPROCESSABLE', message: 'Pull request is in clean status' }] })
    )
    await expect(runPrAction('tok', target, { kind: 'enable_auto_merge', method: 'MERGE' }, fetchFn)).resolves.toEqual({
      ok: false,
      code: 'already_mergeable',
      detail: 'Pull request is in clean status'
    })
  })

  it('lets HTTP failures surface as GithubErrors for the engine to handle', async () => {
    const unauthorized = vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    const err = await runPrAction('tok', target, { kind: 'update_branch' }, unauthorized).catch((e) => e)
    expect(err).toBeInstanceOf(GithubError)
    expect(err.kind).toBe('unauthorized')

    const offline = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(runPrAction('tok', target, { kind: 'update_branch' }, offline)).rejects.toMatchObject({ kind: 'network' })
  })
})
