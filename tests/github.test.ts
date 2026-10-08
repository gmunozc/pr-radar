import { describe, expect, it, vi } from 'vitest'
import {
  checkFromContext,
  fetchInstallations,
  fetchPullRequestDetail,
  installationWarnings,
  buildMyPrsQuery,
  buildSearchQuery,
  ciFromRollup,
  fetchFingerprint,
  fetchFirstUnresolvedThread,
  fetchPullRequests,
  GithubError,
  GRAPHQL_URL,
  graphqlRequest,
  isReadyToMerge,
  mergeBlocker,
  mergeOptions,
  mergeReviews,
  myReviewStatus,
  PROBE_QUERY,
  probeFingerprint,
  reviewFreshness,
  searchQueries
} from '../src/main/github'

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

const search = (nodes: unknown[], issueCount = nodes.length) => ({ issueCount, nodes })

const ok = (nodes: unknown[], extra: Record<string, unknown> = {}, mine: unknown[] = []) =>
  jsonResponse({
    data: { viewer: { login: 'me', avatarUrl: 'x' }, requested: search(nodes), mine: search(mine) },
    ...extra
  })

const rawMyPr = (over: Record<string, unknown> = {}) => ({
  ...rawPr({ author: { login: 'me', avatarUrl: 'x' }, reviewRequests: { nodes: [] } }),
  reviewDecision: null,
  latestOpinionatedReviews: { nodes: [] },
  latestReviews: { nodes: [] },
  ...over
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

describe('buildMyPrsQuery', () => {
  it('searches your own open PRs, optionally without drafts', () => {
    expect(buildMyPrsQuery({ showDrafts: true })).toBe('is:pr is:open archived:false author:@me')
    expect(buildMyPrsQuery({ showDrafts: false })).toBe('is:pr is:open archived:false author:@me draft:false')
  })
})

describe('search exclusions', () => {
  it('excludes bots, authors and repositories from review requests, repositories from your PRs', () => {
    const s = { includeTeams: true, showDrafts: true, hideBots: true, excludeAuthors: ['octo'], excludeRepos: ['acme/legacy'] }
    expect(buildSearchQuery(s)).toBe(
      'is:pr is:open archived:false review-requested:@me -author:app/dependabot -author:app/renovate -author:app/github-actions -author:octo -repo:acme/legacy'
    )
    expect(buildMyPrsQuery(s)).toBe('is:pr is:open archived:false author:@me -repo:acme/legacy')
  })

  it("stops adding exclusions at GitHub's 256-character limit and says so", () => {
    const excludeRepos = Array.from({ length: 30 }, (_, i) => `acme/repository-number-${i}`)
    const q = searchQueries({ includeTeams: true, showDrafts: false, excludeRepos })
    expect(q.requested.length).toBeLessThanOrEqual(256)
    expect(q.mine.length).toBeLessThanOrEqual(256)
    expect(q.requested).toContain('-repo:acme/repository-number-0')
    expect(q.truncated).toBe(true)
    expect(searchQueries({ includeTeams: true, showDrafts: true }).truncated).toBe(false)
  })

  it('maps PRs you take part in and warns when there are more than it shows', async () => {
    const body = jsonResponse({
      data: {
        viewer: { login: 'me', avatarUrl: 'x' },
        requested: search([]),
        mine: search([]),
        involved: search([rawPr({ id: 'I1', reviewRequests: undefined })], 60)
      }
    })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(body))
    expect(result.involved[0]).toMatchObject({ id: 'I1', source: { kind: 'involved' }, viewerDidAuthor: false })
    expect(result.warnings).toContainEqual({ code: 'truncated_involved', params: { shown: 1, total: 60 } })
  })

  it('asks for the involved search only while the tab is on', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => ok([]))
    await fetchPullRequests('tok', { ...settings, showInvolved: false }, 'me', fetchFn)
    const variables = JSON.parse(fetchFn.mock.calls[0][1].body).variables
    expect(variables.withInvolved).toBe(false)
    expect(variables.involved).toBe('is:pr is:open archived:false involves:@me -author:@me -review-requested:@me')
    await fetchPullRequests('tok', settings, 'me', fetchFn)
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).variables.withInvolved).toBe(true)
  })

  it("stays quiet when GitHub's count and its results disagree by a few, as happens right after a merge", async () => {
    const page = (n: number, issueCount: number) => ({
      viewer: { login: 'me', avatarUrl: 'x' },
      requested: search([]),
      mine: search(Array.from({ length: n }, (_, i) => rawMyPr({ id: `M${i}` })), issueCount),
      involved: search([])
    })
    const few = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(jsonResponse({ data: page(13, 14) })))
    expect(few.warnings).toEqual([])
    const overflow = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(jsonResponse({ data: page(50, 51) })))
    expect(overflow.warnings).toContainEqual({ code: 'truncated_mine', params: { shown: 50, total: 51 } })
  })

  it('warns when exclusions were truncated', async () => {
    const excludeRepos = Array.from({ length: 30 }, (_, i) => `acme/repository-number-${i}`)
    const result = await fetchPullRequests('tok', { ...settings, excludeRepos }, 'me', vi.fn().mockResolvedValue(ok([])))
    expect(result.warnings).toEqual([{ code: 'filters_truncated' }])
  })
})

describe('myReviewStatus', () => {
  it('follows the review decision when the repo has one', () => {
    expect(myReviewStatus('APPROVED', 1, [])).toBe('approved')
    expect(myReviewStatus('CHANGES_REQUESTED', 0, ['APPROVED'])).toBe('changes_requested')
    expect(myReviewStatus('REVIEW_REQUIRED', 0, ['APPROVED'])).toBe('waiting')
    expect(myReviewStatus('REVIEW_REQUIRED', 0, [])).toBe('no_reviewers')
  })

  it('uses pending requests and reviews when there is no decision', () => {
    expect(myReviewStatus(null, 2, [])).toBe('waiting')
    expect(myReviewStatus(null, 1, ['APPROVED'])).toBe('waiting')
    expect(myReviewStatus(null, 1, ['CHANGES_REQUESTED'])).toBe('changes_requested')
    expect(myReviewStatus(null, 0, ['APPROVED'])).toBe('approved')
    expect(myReviewStatus(null, 0, [])).toBe('no_reviewers')
    // Comments without a decision: someone is looking, so it is waiting rather than unreviewed.
    expect(myReviewStatus(null, 0, ['COMMENTED'])).toBe('waiting')
    expect(myReviewStatus('REVIEW_REQUIRED', 0, ['COMMENTED', 'DISMISSED'])).toBe('waiting')
  })
})

describe('fetchPullRequests', () => {
  it('maps your own PRs with pending reviewers, reviews and status, newest first', async () => {
    const older = rawMyPr({
      id: 'MY_1',
      createdAt: '2026-09-01T00:00:00Z',
      reviewDecision: 'APPROVED',
      latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'ana', avatarUrl: 'a' } }] }
    })
    const newer = rawMyPr({
      id: 'MY_2',
      createdAt: '2026-09-20T00:00:00Z',
      reviewRequests: {
        nodes: [
          { requestedReviewer: { __typename: 'User', login: 'bob', avatarUrl: 'b' } },
          { requestedReviewer: { __typename: 'Team', slug: 'backend' } },
          { requestedReviewer: null }
        ]
      }
    })
    const result = await fetchPullRequests('tok', settings, undefined, vi.fn().mockResolvedValue(ok([], {}, [older, newer])))

    expect(result.myPrs.map((p) => p.id)).toEqual(['MY_2', 'MY_1'])
    expect(result.myPrs[0]).toMatchObject({
      status: 'waiting',
      pendingReviewers: [
        { kind: 'user', login: 'bob', avatarUrl: 'b' },
        { kind: 'team', slug: 'backend' }
      ],
      reviews: []
    })
    expect(result.myPrs[1]).toMatchObject({
      status: 'approved',
      reviews: [{ login: 'ana', avatarUrl: 'a', state: 'APPROVED' }]
    })
  })

  it('maps PRs, labels direct vs team requests and sorts newest first', async () => {
    const team = rawPr({
      id: 'PR_2',
      number: 7,
      createdAt: '2026-09-01T00:00:00Z',
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Team', slug: 'frontend' } }] }
    })
    const fetchFn = vi.fn().mockResolvedValue(ok([rawPr(), team, {}]))

    const result = await fetchPullRequests('tok', settings, undefined, fetchFn)

    expect(result.viewer.login).toBe('me')
    expect(result.prs.map((p) => p.id)).toEqual(['PR_1', 'PR_2'])
    expect(result.prs[0].source).toEqual({ kind: 'direct' })
    expect(result.prs[0].repo).toBe('acme/app')
    expect(result.prs[1].source).toEqual({ kind: 'team', slug: 'frontend' })
    expect(result.warnings).toEqual([])

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.github.com/graphql')
    expect(init.headers.Authorization).toBe('Bearer tok')
    const variables = JSON.parse(init.body).variables
    expect(variables.requested).toContain('review-requested:@me')
    expect(variables.mine).toContain('author:@me')
  })

  it('labels a hidden team reviewer as an unnamed team', async () => {
    const pr = rawPr({ reviewRequests: { nodes: [{ requestedReviewer: null }] } })
    const result = await fetchPullRequests('tok', settings, undefined, vi.fn().mockResolvedValue(ok([pr])))
    expect(result.prs[0].source).toEqual({ kind: 'team', slug: '' })
  })

  it('surfaces SAML partial results as a warning', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      ok([rawPr()], {
        errors: [{ type: 'FORBIDDEN', message: 'Resource protected by organization SAML enforcement.' }]
      })
    )
    const result = await fetchPullRequests('tok', settings, undefined, fetchFn)
    expect(result.prs).toHaveLength(1)
    expect(result.warnings).toEqual([{ code: 'saml' }])
  })

  it('warns when results are truncated', async () => {
    const res = jsonResponse({
      data: { viewer: { login: 'me', avatarUrl: 'x' }, requested: search([rawPr()], 80), mine: search([]) }
    })
    const result = await fetchPullRequests('tok', settings, undefined, vi.fn().mockResolvedValue(res))
    expect(result.warnings).toContainEqual({ code: 'truncated_requested', params: { shown: 1, total: 80 } })
  })

  it('classifies 401 as unauthorized', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    await expect(fetchPullRequests('tok', settings, undefined, fetchFn)).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('classifies rate limits and exposes the reset time', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } }
      )
    )
    const err = await fetchPullRequests('tok', settings, undefined, fetchFn).catch((e) => e)
    expect(err).toBeInstanceOf(GithubError)
    expect(err.kind).toBe('rate_limited')
    expect(err.retryAt).toBe(reset * 1000)
  })

  it('classifies fetch failures as network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    await expect(fetchPullRequests('tok', settings, undefined, fetchFn)).rejects.toMatchObject({ kind: 'network' })
  })

  it('throws when GraphQL returns only errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: null, errors: [{ message: 'boom' }] }))
    await expect(fetchPullRequests('tok', settings, undefined, fetchFn)).rejects.toMatchObject({
      kind: 'unknown',
      message: 'boom'
    })
  })
})

describe('ciFromRollup', () => {
  it('maps every rollup state', () => {
    expect(ciFromRollup('SUCCESS')).toBe('success')
    expect(ciFromRollup('FAILURE')).toBe('failure')
    expect(ciFromRollup('ERROR')).toBe('failure')
    expect(ciFromRollup('PENDING')).toBe('pending')
    expect(ciFromRollup('EXPECTED')).toBe('pending')
    expect(ciFromRollup(null)).toBe('none')
    expect(ciFromRollup(undefined)).toBe('none')
  })
})

describe('isReadyToMerge and mergeBlocker', () => {
  type Input = Parameters<typeof isReadyToMerge>[0]
  const approved: Input = { status: 'approved', isDraft: false, ci: 'success', mergeable: 'MERGEABLE', mergeState: 'CLEAN' }
  const cases: Array<[string, Partial<Input>, boolean, string | null]> = [
    ['approved, green, clean', {}, true, null],
    ['approved without checks', { ci: 'none' }, true, null],
    ['repo with merge hooks', { mergeState: 'HAS_HOOKS' }, true, null],
    ['checks running', { ci: 'pending', mergeState: 'UNSTABLE' }, false, 'ci_pending'],
    ['checks failing', { ci: 'failure', mergeState: 'UNSTABLE' }, false, 'ci_failing'],
    ['branch protection', { mergeState: 'BLOCKED' }, false, 'blocked'],
    ['base moved', { mergeState: 'BEHIND' }, false, 'behind'],
    ['conflicts', { mergeable: 'CONFLICTING', mergeState: 'DIRTY' }, false, 'conflicts'],
    ['still computing', { mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' }, false, null],
    ['draft', { isDraft: true, mergeState: 'DRAFT' }, false, 'draft'],
    ['waiting for review', { status: 'waiting' }, false, null]
  ]
  for (const [name, over, ready, blocker] of cases) {
    it(name, () => {
      const pr: Input = { ...approved, ...over }
      expect(isReadyToMerge(pr)).toBe(ready)
      expect(mergeBlocker(pr)).toBe(blocker)
    })
  }
})

describe('reviewFreshness', () => {
  it('flags pushes after your last review', () => {
    expect(reviewFreshness({ headRefOid: 'b', myReview: { nodes: [{ submittedAt: 'T', commit: { oid: 'a' } }] } })).toEqual({
      lastReviewAt: 'T',
      newCommitsSinceReview: true
    })
    expect(reviewFreshness({ headRefOid: 'a', myReview: { nodes: [{ submittedAt: 'T', commit: { oid: 'a' } }] } })).toEqual({
      lastReviewAt: 'T',
      newCommitsSinceReview: false
    })
  })

  it('treats a reviewed commit that no longer exists as changed, and no review as unchanged', () => {
    expect(reviewFreshness({ headRefOid: 'a', myReview: { nodes: [{ submittedAt: 'T', commit: null }] } }).newCommitsSinceReview).toBe(true)
    expect(reviewFreshness({ headRefOid: 'a', myReview: { nodes: [] } })).toEqual({ lastReviewAt: null, newCommitsSinceReview: false })
    expect(reviewFreshness({ headRefOid: 'a' })).toEqual({ lastReviewAt: null, newCommitsSinceReview: false })
  })
})

describe('fetchPullRequests details', () => {
  it('asks for your latest review only once your login is known', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => ok([]))
    await fetchPullRequests('tok', settings, undefined, fetchFn)
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).variables).toMatchObject({ login: '', withMyReview: false })
    await fetchPullRequests('tok', settings, 'me', fetchFn)
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).variables).toMatchObject({ login: 'me', withMyReview: true })
  })

  it('maps CI, head commit, review freshness and merge readiness', async () => {
    const reviewed = rawPr({
      headRefOid: 'new',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
      myReview: { nodes: [{ submittedAt: '2026-09-30T12:00:00Z', commit: { oid: 'old' } }] }
    })
    const mine = rawMyPr({
      headRefOid: 'h1',
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] }
    })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([reviewed], {}, [mine])))
    expect(result.prs[0]).toMatchObject({ ci: 'failure', headOid: 'new', newCommitsSinceReview: true, lastReviewAt: '2026-09-30T12:00:00Z' })
    expect(result.myPrs[0]).toMatchObject({ ci: 'success', readyToMerge: true, blocker: null, conflicts: false })
  })

  it('marks fields GitHub refuses to return as unknown and explains it', async () => {
    const mine = rawMyPr({ reviewDecision: 'APPROVED', mergeable: null, mergeStateStatus: null, commits: { nodes: [{ commit: null }] } })
    const errors = [
      { type: 'FORBIDDEN', message: 'Resource not accessible by integration', path: ['mine', 'nodes', 0, 'commits', 'nodes', 0, 'commit', 'statusCheckRollup'] },
      { type: 'FORBIDDEN', message: 'Resource not accessible by integration', path: ['mine', 'nodes', 0, 'mergeable'] }
    ]
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([rawPr()], { errors }, [mine])))
    expect(result.prs[0].ci).toBe('unknown')
    expect(result.myPrs[0]).toMatchObject({ ci: 'unknown', readyToMerge: false, blocker: null })
    expect(result.warnings).toEqual([
      { code: 'missing_permission', params: { field: 'checks' } },
      { code: 'missing_permission', params: { field: 'merge' } }
    ])
  })
})

describe('fetchPullRequests merge details', () => {
  it('maps capabilities, merge options, auto-merge and branch protection on your PRs', async () => {
    const mine = rawMyPr({
      headRefName: 'feature/x',
      baseRefName: 'main',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      autoMergeRequest: { enabledAt: '2026-10-01T00:00:00Z', mergeMethod: 'SQUASH' },
      viewerCanUpdateBranch: false,
      viewerCanEnableAutoMerge: false,
      viewerCanDisableAutoMerge: true,
      repository: {
        nameWithOwner: 'acme/app',
        autoMergeAllowed: true,
        mergeCommitAllowed: false,
        squashMergeAllowed: true,
        rebaseMergeAllowed: true,
        deleteBranchOnMerge: true,
        viewerDefaultMergeMethod: 'SQUASH',
        viewerPermission: 'ADMIN'
      },
      baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 2 } },
      reviewThreads: { totalCount: 3, nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }] },
      latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { id: 'U_1', login: 'ana', avatarUrl: 'a' } }] }
    })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([], {}, [mine])))
    expect(result.myPrs[0]).toMatchObject({
      branch: 'feature/x',
      baseBranch: 'main',
      mergeable: true,
      permission: 'ADMIN',
      can: { updateBranch: false, enableAutoMerge: false, disableAutoMerge: true, merge: true, requestReviews: true },
      autoMerge: { method: 'SQUASH', enabledAt: '2026-10-01T00:00:00Z' },
      merge: { methods: ['SQUASH', 'REBASE'], defaultMethod: 'SQUASH', deleteBranchOnMerge: true, autoMergeAllowed: true },
      unresolvedThreads: 2,
      requiredApprovals: 2,
      reviews: [{ login: 'ana', avatarUrl: 'a', state: 'APPROVED', id: 'U_1' }]
    })
  })

  it('is mergeable without approvals when the repo requires none, but never as a draft or when blocked', async () => {
    const clean = rawMyPr({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' })
    const draft = rawMyPr({ id: 'D', isDraft: true, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' })
    const blocked = rawMyPr({ id: 'B', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED' })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([], {}, [clean, draft, blocked])))
    const byId = Object.fromEntries(result.myPrs.map((p) => [p.id, p]))
    expect(byId.PR_1).toMatchObject({ mergeable: true, readyToMerge: false, status: 'no_reviewers' })
    expect(byId.D.mergeable).toBe(false)
    expect(byId.B.mergeable).toBe(false)
  })

  it('reports nothing when the repository fields are missing', async () => {
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([], {}, [rawMyPr()])))
    expect(result.myPrs[0]).toMatchObject({
      branch: '',
      baseBranch: '',
      permission: null,
      can: { updateBranch: false, enableAutoMerge: false, disableAutoMerge: false, merge: false, requestReviews: false },
      autoMerge: null,
      merge: { methods: [], defaultMethod: 'MERGE', deleteBranchOnMerge: false, autoMergeAllowed: false },
      unresolvedThreads: null,
      requiredApprovals: null,
      labels: [],
      checks: [],
      checksTotal: 0
    })
  })

  it('maps checks (failing first), labels, the head branch and authorship on review requests', async () => {
    const pr = rawPr({
      headRefName: 'fix/login',
      viewerDidAuthor: true,
      labels: { nodes: [{ name: 'bug', color: 'd73a4a' }, null] },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                state: 'FAILURE',
                contexts: {
                  totalCount: 4,
                  nodes: [
                    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/app/runs/1' },
                    { __typename: 'CheckRun', name: 'tests', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
                    { __typename: 'StatusContext', context: 'ci/circle', state: 'FAILURE', targetUrl: 'https://circleci.com/x' },
                    { __typename: 'CheckRun', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED', detailsUrl: 'https://github.com/acme/app/runs/2' }
                  ]
                }
              }
            }
          }
        ]
      }
    })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([pr])))
    expect(result.prs[0]).toMatchObject({
      branch: 'fix/login',
      viewerDidAuthor: true,
      labels: [{ name: 'bug', color: 'd73a4a' }],
      checksTotal: 4,
      ci: 'failure'
    })
    expect(result.prs[0].checks.map((c) => [c.name, c.state])).toEqual([
      ['ci/circle', 'failure'],
      ['tests', 'pending'],
      ['lint', 'success'],
      ['docs', 'skipped']
    ])
    expect(result.prs[0].checks[0].url).toBe('https://circleci.com/x')
  })

  it('tolerates errors on optional fields without a partial-results banner', async () => {
    const errors = [
      { type: 'FORBIDDEN', message: 'Resource not accessible', path: ['mine', 'nodes', 0, 'baseRef', 'branchProtectionRule'] },
      { type: 'FORBIDDEN', message: 'Resource not accessible', path: ['mine', 'nodes', 0, 'reviewThreads'] }
    ]
    const mine = rawMyPr({ baseRef: null, reviewThreads: null })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([], { errors }, [mine])))
    expect(result.warnings).toEqual([])
    expect(result.myPrs[0]).toMatchObject({ requiredApprovals: null, unresolvedThreads: null })
  })
})

describe('checkFromContext', () => {
  const run = (status: string, conclusion: string | null) =>
    checkFromContext({ __typename: 'CheckRun', name: 'x', status, conclusion })?.state

  it('maps check run conclusions and commit statuses', () => {
    expect(run('COMPLETED', 'SUCCESS')).toBe('success')
    expect(run('COMPLETED', 'FAILURE')).toBe('failure')
    expect(run('COMPLETED', 'TIMED_OUT')).toBe('failure')
    expect(run('COMPLETED', 'CANCELLED')).toBe('failure')
    expect(run('COMPLETED', 'ACTION_REQUIRED')).toBe('failure')
    expect(run('COMPLETED', 'NEUTRAL')).toBe('skipped')
    expect(run('QUEUED', null)).toBe('pending')
    expect(checkFromContext({ __typename: 'StatusContext', context: 's', state: 'ERROR' })?.state).toBe('failure')
    expect(checkFromContext({ __typename: 'StatusContext', context: 's', state: 'PENDING' })?.state).toBe('pending')
    expect(checkFromContext({ __typename: 'Other' })).toBeNull()
    expect(checkFromContext(null)).toBeNull()
  })
})

describe('mergeOptions', () => {
  it('falls back to the first allowed method when the default is not allowed', () => {
    expect(mergeOptions({ mergeCommitAllowed: true, rebaseMergeAllowed: true, viewerDefaultMergeMethod: 'SQUASH' })).toEqual({
      methods: ['MERGE', 'REBASE'],
      defaultMethod: 'MERGE',
      deleteBranchOnMerge: false,
      autoMergeAllowed: false
    })
    expect(mergeOptions(null)).toEqual({ methods: [], defaultMethod: 'MERGE', deleteBranchOnMerge: false, autoMergeAllowed: false })
  })
})

describe('graphqlRequest', () => {
  it('posts the document and returns the parsed body with the response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ data: { ok: true } }, { headers: { 'content-type': 'application/json', 'x-test': '1' } })
    )
    const { body, response } = await graphqlRequest<{ data: { ok: boolean } }>('tok', 'query { x }', { a: 1 }, fetchFn)
    expect(body.data.ok).toBe(true)
    expect(response.headers.get('x-test')).toBe('1')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(GRAPHQL_URL)
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ query: 'query { x }', variables: { a: 1 } })
  })

  it('turns a server error into an unknown GithubError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { status: 502, statusText: 'Bad Gateway' }))
    await expect(graphqlRequest('tok', 'query { x }', {}, fetchFn)).rejects.toMatchObject({ kind: 'unknown' })
  })
})

describe('fetchPullRequestDetail', () => {
  it('maps the description and counts, and reports a missing PR as null', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ data: { node: { body: ' Hello ', changedFiles: 3, totalCommentsCount: 2, commits: { totalCount: 4 } } } })
    )
    await expect(fetchPullRequestDetail('tok', 'PR_1', fetchFn)).resolves.toEqual({ body: 'Hello', changedFiles: 3, commits: 4, comments: 2 })
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).variables).toEqual({ id: 'PR_1' })
    await expect(fetchPullRequestDetail('tok', 'PR_x', vi.fn().mockResolvedValue(jsonResponse({ data: { node: null } })))).resolves.toBeNull()
  })
})

describe('GitHub App installations', () => {
  const full = { pull_requests: 'read', checks: 'read', statuses: 'read', metadata: 'read' }

  it('lists the accounts where the app is installed', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        total_count: 2,
        installations: [
          { account: { login: 'me', type: 'User' }, permissions: full },
          { account: { login: 'acme', type: 'Organization' }, permissions: { pull_requests: 'read' } },
          { account: null }
        ]
      })
    )
    const installs = await fetchInstallations('ghu_x', fetchFn)
    expect(installs).toEqual([
      { login: 'me', type: 'User', permissions: full },
      { login: 'acme', type: 'Organization', permissions: { pull_requests: 'read' } }
    ])
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.github.com/user/installations?per_page=100')
  })

  it('explains a missing installation and permissions waiting for approval', () => {
    expect(installationWarnings([])).toEqual([{ code: 'app_not_installed' }])
    expect(
      installationWarnings([
        { login: 'me', type: 'User', permissions: full },
        { login: 'acme', type: 'Organization', permissions: { pull_requests: 'read' } }
      ])
    ).toEqual([{ code: 'app_permissions_pending', params: { accounts: 'acme' } }])
    expect(installationWarnings([{ login: 'me', type: 'User', permissions: full }])).toEqual([])
  })

  it('reports an expired token as unauthorized', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: 'Bad credentials' }, { status: 401 }))
    await expect(fetchInstallations('ghu_x', fetchFn)).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})

describe('change probes', () => {
  const probePr = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    updatedAt: 'T1',
    headRefOid: 'h1',
    isDraft: false,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...over
  })
  const data = (requested: unknown[], mine: unknown[] = [], involved?: unknown[]) =>
    ({ requested: search(requested), mine: search(mine), ...(involved ? { involved: search(involved) } : {}) }) as Parameters<
      typeof probeFingerprint
    >[0]

  it('does not depend on the order GitHub returns PRs in', () => {
    expect(probeFingerprint(data([probePr('a'), probePr('b')]))).toBe(probeFingerprint(data([probePr('b'), probePr('a')])))
  })

  it('changes with anything a notification could come from', () => {
    const base = probeFingerprint(data([probePr('a')]))
    const variants = [
      data([probePr('a'), probePr('b')]),
      data([probePr('a', { updatedAt: 'T2' })]),
      data([probePr('a', { headRefOid: 'h2' })]),
      data([probePr('a', { isDraft: true })]),
      data([probePr('a', { reviewDecision: 'APPROVED' })]),
      data([probePr('a', { mergeStateStatus: 'BEHIND' })]),
      data([probePr('a', { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } })]),
      data([probePr('a', { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })]),
      data([], [probePr('a')]),
      data([probePr('a')], [], [probePr('c')])
    ]
    for (const variant of variants) expect(probeFingerprint(variant)).not.toBe(base)
    expect(new Set(variants.map(probeFingerprint)).size).toBe(variants.length)
  })

  it('asks for the same searches as the full query and fails without data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: data([probePr('a')]) }))
    await expect(fetchFingerprint('tok', { ...settings, showInvolved: false }, fetchFn)).resolves.toHaveLength(16)
    const { query, variables } = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(query).toBe(PROBE_QUERY)
    expect(variables).toMatchObject({ requested: searchQueries(settings).requested, withInvolved: false, first: 50 })
    const noData = vi.fn().mockResolvedValue(jsonResponse({ data: null, errors: [{ message: 'nope' }] }))
    await expect(fetchFingerprint('tok', settings, noData)).rejects.toMatchObject({ kind: 'unknown', message: 'nope' })
  })
})

describe('mergeReviews', () => {
  const review = (login: string, state: string, id?: string) => ({ state, author: { login, avatarUrl: login[0], ...(id ? { id } : {}) } })

  it('shows commenters and dismissed reviews next to the decisions, once per person', () => {
    const reviews = mergeReviews(
      {
        latestOpinionatedReviews: { nodes: [review('ana', 'APPROVED', 'U_1'), review('dan', 'DISMISSED')] } as never,
        latestReviews: { nodes: [review('ana', 'COMMENTED', 'U_1'), review('bob', 'COMMENTED'), review('dan', 'DISMISSED'), review('eve', 'PENDING')] } as never
      },
      'me'
    )
    expect(reviews).toEqual([
      { login: 'ana', avatarUrl: 'a', state: 'APPROVED', id: 'U_1' },
      { login: 'bob', avatarUrl: 'b', state: 'COMMENTED' },
      { login: 'dan', avatarUrl: 'd', state: 'DISMISSED' }
    ])
  })

  it('ignores your own comment reviews and copes without the latestReviews field', () => {
    expect(mergeReviews({ latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [review('me', 'COMMENTED')] } } as never, 'me')).toEqual([])
    expect(mergeReviews({ latestOpinionatedReviews: { nodes: [review('ana', 'APPROVED')] }, latestReviews: null } as never, 'me')).toHaveLength(1)
  })

  it('turns "no reviewers" into "waiting" once someone has commented', async () => {
    const mine = rawMyPr({ reviewDecision: 'REVIEW_REQUIRED', latestReviews: { nodes: [review('claude', 'COMMENTED'), review('dan', 'COMMENTED')] } })
    const result = await fetchPullRequests('tok', settings, 'me', vi.fn().mockResolvedValue(ok([], {}, [mine])))
    expect(result.myPrs[0]).toMatchObject({ status: 'waiting', reviews: [{ login: 'claude', state: 'COMMENTED' }, { login: 'dan', state: 'COMMENTED' }] })
  })
})

describe('fetchFirstUnresolvedThread', () => {
  const threads = (nodes: unknown[]) => jsonResponse({ data: { node: { reviewThreads: { nodes } } } })
  const thread = (isResolved: boolean, url: string) => ({ isResolved, comments: { nodes: [{ url }] } })

  it("returns the first unresolved thread's first comment, null when all are resolved or the PR is unknown", async () => {
    const mixed = threads([thread(true, 'https://x/1'), null, thread(false, 'https://x/2'), thread(false, 'https://x/3')])
    await expect(fetchFirstUnresolvedThread('tok', 'PR_1', vi.fn().mockResolvedValue(mixed))).resolves.toBe('https://x/2')
    await expect(fetchFirstUnresolvedThread('tok', 'PR_1', vi.fn().mockResolvedValue(threads([thread(true, 'https://x/1')])))).resolves.toBeNull()
    await expect(fetchFirstUnresolvedThread('tok', 'PR_x', vi.fn().mockResolvedValue(jsonResponse({ data: { node: null } })))).resolves.toBeNull()
  })
})
