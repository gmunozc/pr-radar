/** Filtering and ordering of the lists, kept free of React so it can be unit tested. */
import type { MyPrFilter, MyPullRequest, PullRequest, ReviewFilter, ReviewSort } from '../shared/types'

type Dated = { createdAt: string; updatedAt: string }

const byNewest = (a: Dated, b: Dated) => b.createdAt.localeCompare(a.createdAt)
const byOldest = (a: Dated, b: Dated) => a.createdAt.localeCompare(b.createdAt)
const byUpdated = (a: Dated, b: Dated) => b.updatedAt.localeCompare(a.updatedAt)

const inOrg = (pr: { repo: string }, org: string | null) => org === null || pr.repo.split('/')[0] === org

/** A sorted copy; the sort names are the ones the settings store. */
export function sortPrs<T extends Dated>(prs: T[], sort: ReviewSort): T[] {
  return [...prs].sort(sort === 'oldest' ? byOldest : sort === 'updated' ? byUpdated : byNewest)
}

/** Review requests after the filter, organization and sort chosen by the user. */
export function arrangePrs(prs: PullRequest[], filter: ReviewFilter, org: string | null, sort: ReviewSort): PullRequest[] {
  return sortPrs(
    prs.filter((pr) => (filter === 'all' || pr.source.kind === filter) && inOrg(pr, org)),
    sort
  )
}

const MINE_MATCH: Record<MyPrFilter, (pr: MyPullRequest) => boolean> = {
  all: () => true,
  ready: (pr) => pr.readyToMerge,
  waiting: (pr) => pr.status === 'waiting',
  changes: (pr) => pr.status === 'changes_requested'
}

/** Your PRs after the filter, organization and sort chosen by the user. */
export function arrangeMyPrs(prs: MyPullRequest[], filter: MyPrFilter, org: string | null, sort: ReviewSort): MyPullRequest[] {
  return sortPrs(
    prs.filter((pr) => MINE_MATCH[filter](pr) && inOrg(pr, org)),
    sort
  )
}

/** The tab that lists a PR, or null when it is in none (merged, closed, dismissed…). */
export function tabFor(
  state: { prs: Array<{ id: string }>; myPrs: Array<{ id: string }>; involved: Array<{ id: string }> },
  prId: string
): 'review' | 'mine' | 'involved' | null {
  if (state.prs.some((p) => p.id === prId)) return 'review'
  if (state.myPrs.some((p) => p.id === prId)) return 'mine'
  if (state.involved.some((p) => p.id === prId)) return 'involved'
  return null
}

/** Lower case without accents, so "jose" finds "José". */
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

interface Searchable {
  title: string
  repo: string
  number: number
  author: { login: string } | null
  branch: string
}

/** Whether a PR matches the text filter: title, repository, number (with or without #), author or branch. */
export function matchesQuery(pr: Searchable, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  const haystack = [pr.title, pr.repo, `#${pr.number}`, pr.author ? `@${pr.author.login}` : '', pr.branch].map(normalize).join('\n')
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

export function filterByQuery<T extends Searchable>(prs: T[], query: string): T[] {
  return query.trim() ? prs.filter((pr) => matchesQuery(pr, query)) : prs
}
