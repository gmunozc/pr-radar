import { describe, expect, it, vi } from 'vitest'
import { buildSearchQuery, fetchReviewRequests, GithubError } from '../src/main/github'

const settings = { includeTeams: true, showDrafts: true }

const rawPr = (over: Record<string, unknown> = {}) => ({
  id: 'PR_1',
  number: 12,
  title: 'Add feature',
  url: 'https://github.com/acme/app/pull/12',
  isDraft: false,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T11:00:00Z',
  additions: 10,
  deletions: 2,
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'octo', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'Me' } }] },
  ...over
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}

const ok = (nodes: unknown[], extra: Record<string, unknown> = {}) =>
  jsonResponse({
    data: { viewer: { login: 'me', avatarUrl: 'x' }, search: { issueCount: nodes.length, nodes } },
    ...extra
  })

describe('buildSearchQuery', () => {
  it('uses review-requested (direct + teams) by default', () => {
    expect(buildSearchQuery(settings)).toBe('is:pr is:open archived:false review-requested:@me')
  })

  it('restricts to direct requests and hides drafts when configured', () => {
    expect(buildSearchQuery({ includeTeams: false, showDrafts: false })).toBe(
      'is:pr is:open archived:false user-review-requested:@me draft:false'
    )
  })
})

describe('fetchReviewRequests', () => {
  it('maps PRs, labels direct vs team requests and sorts newest first', async () => {
    const team = rawPr({
      id: 'PR_2',
      number: 7,
      createdAt: '2026-09-01T00:00:00Z',
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Team', slug: 'frontend' } }] }
    })
    const fetchFn = vi.fn().mockResolvedValue(ok([rawPr(), team, {}]))

    const result = await fetchReviewRequests('tok', settings, fetchFn)

    expect(result.viewer.login).toBe('me')
    expect(result.prs.map((p) => p.id)).toEqual(['PR_1', 'PR_2'])
    expect(result.prs[0].source).toEqual({ kind: 'direct' })
    expect(result.prs[0].repo).toBe('acme/app')
    expect(result.prs[1].source).toEqual({ kind: 'team', slug: 'frontend' })
    expect(result.warnings).toEqual([])

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.github.com/graphql')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body).variables.q).toContain('review-requested:@me')
  })

  it('labels a hidden team reviewer as an unnamed team', async () => {
    const pr = rawPr({ reviewRequests: { nodes: [{ requestedReviewer: null }] } })
    const result = await fetchReviewRequests('tok', settings, vi.fn().mockResolvedValue(ok([pr])))
    expect(result.prs[0].source).toEqual({ kind: 'team', slug: '' })
  })

  it('surfaces SAML partial results as a warning', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      ok([rawPr()], {
        errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }]
      })
    )
    const result = await fetchReviewRequests('tok', settings, fetchFn)
    expect(result.prs).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/SAML/)
  })

  it('warns when results are truncated', async () => {
    const res = jsonResponse({
      data: { viewer: { login: 'me', avatarUrl: 'x' }, search: { issueCount: 80, nodes: [rawPr()] } }
    })
    const result = await fetchReviewRequests('tok', settings, vi.fn().mockResolvedValue(res))
    expect(result.warnings).toContain('Mostrando 1 de 80 PRs.')
  })

  it('classifies 401 as unauthorized', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    await expect(fetchReviewRequests('tok', settings, fetchFn)).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('classifies rate limits and exposes the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }
      )
    )
    const err = await fetchReviewRequests('tok', settings, fetchFn).catch((e) => e)
    expect(err).toBeInstanceOf(GithubError)
    expect(err.kind).toBe('rate_limited')
    expect(err.retryAt).toBe(reset * 1000)
  })

  it('classifies fetch failures as network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(fetchReviewRequests('tok', settings, fetchFn)).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws when GraphQL returns only errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: null, errors: [{ message: 'boom' }] }))
    await expect(fetchReviewRequests('tok', settings, fetchFn)).rejects.toMatchObject({
      kind: 'unknown',
      message: 'boom'
    })
  })
})
