/** PRs with every required field, shared by the tests; override only what a test cares about. */
import type { MyPullRequest, PullRequest } from '../src/shared/types'

export const pr = (id = 'PR_1', over: Partial<PullRequest> = {}): PullRequest => ({
  id,
  number: Number(id.replace(/\D/g, '')) || 1,
  title: `PR ${id}`,
  url: `https://github.com/acme/app/pull/${id}`,
  repo: 'acme/app',
  author: { login: 'octo', avatarUrl: '' },
  isDraft: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 1,
  deletions: 1,
  headOid: 'h',
  ci: 'none',
  branch: 'feature',
  labels: [],
  checks: [],
  checksTotal: 0,
  source: { kind: 'direct' },
  viewerDidAuthor: false,
  lastReviewAt: null,
  newCommitsSinceReview: false,
  ...over
})

export const myPr = (id = 'MY_1', over: Partial<MyPullRequest> = {}): MyPullRequest => {
  const { source: _source, viewerDidAuthor: _author, lastReviewAt: _last, newCommitsSinceReview: _fresh, ...base } = pr(id)
  return {
    ...base,
    author: { login: 'me', avatarUrl: '' },
    status: 'waiting',
    pendingReviewers: [],
    reviews: [],
    readyToMerge: false,
    blocker: null,
    conflicts: false,
    mergeable: false,
    baseBranch: 'main',
    permission: 'WRITE',
    can: { updateBranch: false, enableAutoMerge: false, disableAutoMerge: false, merge: true, requestReviews: true },
    autoMerge: null,
    merge: { methods: ['MERGE', 'SQUASH', 'REBASE'], defaultMethod: 'MERGE', deleteBranchOnMerge: false, autoMergeAllowed: false },
    unresolvedThreads: 0,
    requiredApprovals: null,
    ...over
  }
}
