/** Filtering and ordering of the review list, kept free of React so it can be unit tested. */
import type { PullRequest, ReviewFilter, ReviewSort } from '../shared/types'

const byNewest = (a: PullRequest, b: PullRequest) => b.createdAt.localeCompare(a.createdAt)
const byOldest = (a: PullRequest, b: PullRequest) => a.createdAt.localeCompare(b.createdAt)
const byUpdated = (a: PullRequest, b: PullRequest) => b.updatedAt.localeCompare(a.updatedAt)

/** Review requests after the filter, organization and sort chosen by the user. */
export function arrangePrs(prs: PullRequest[], filter: ReviewFilter, org: string | null, sort: ReviewSort): PullRequest[] {
  const kept = prs.filter(
    (pr) => (filter === 'all' || pr.source.kind === filter) && (org === null || pr.repo.split('/')[0] === org)
  )
  return [...kept].sort(sort === 'oldest' ? byOldest : sort === 'updated' ? byUpdated : byNewest)
}
