import type {
  GithubErrorKind,
  MyPullRequest,
  MyReviewStatus,
  PullRequest,
  Reviewer,
  ReviewSource,
  ReviewState,
  Settings,
  Viewer,
  Warning
} from '../shared/types'

export const GRAPHQL_URL = 'https://api.github.com/graphql'
export const PAGE_SIZE = 50

// Both lists come from a single query (~1 rate-limit point).
export const PULL_REQUESTS_QUERY = /* GraphQL */ `
  fragment PrFields on PullRequest {
    id
    number
    title
    url
    isDraft
    createdAt
    updatedAt
    additions
    deletions
    repository { nameWithOwner }
    author { login avatarUrl }
  }

  query PullRequests($requested: String!, $mine: String!, $first: Int!) {
    viewer { login avatarUrl }
    requested: search(query: $requested, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          ...PrFields
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                __typename
                ... on User { login }
                ... on Team { slug }
              }
            }
          }
        }
      }
    }
    mine: search(query: $mine, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          ...PrFields
          reviewDecision
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                __typename
                ... on User { login avatarUrl }
                ... on Team { slug }
              }
            }
          }
          latestOpinionatedReviews(first: 20) {
            nodes {
              state
              author { login avatarUrl }
            }
          }
        }
      }
    }
  }
`

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    /** Epoch ms when it is OK to retry (rate limits only). */
    readonly retryAt?: number
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

export interface FetchResult {
  viewer: Viewer
  prs: PullRequest[]
  myPrs: MyPullRequest[]
  warnings: Warning[]
  /** `github-authentication-token-expiration` header: present when the token expires. */
  tokenExpiration?: string | null
}

type FetchFn = typeof fetch
type SearchSettings = Pick<Settings, 'includeTeams' | 'showDrafts'>
type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

interface RawReviewer {
  __typename: string
  login?: string
  avatarUrl?: string
  slug?: string
}

interface RawPr {
  id?: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  repository: { nameWithOwner: string }
  author: { login: string; avatarUrl: string } | null
  reviewRequests: { nodes: Array<{ requestedReviewer: RawReviewer | null }> }
}

interface RawMyPr extends RawPr {
  reviewDecision: ReviewDecision
  latestOpinionatedReviews: {
    nodes: Array<{ state: ReviewState; author: { login: string; avatarUrl: string } | null }>
  }
}

interface RawSearch<T> {
  issueCount: number
  nodes: T[]
}

interface RawResponse {
  data?: {
    viewer: Viewer
    requested: RawSearch<RawPr>
    mine: RawSearch<RawMyPr>
  } | null
  errors?: Array<{ type?: string; message: string }>
}

const BASE_QUERY = ['is:pr', 'is:open', 'archived:false']

export function buildSearchQuery(settings: SearchSettings): string {
  const parts = [...BASE_QUERY, settings.includeTeams ? 'review-requested:@me' : 'user-review-requested:@me']
  if (!settings.showDrafts) parts.push('draft:false')
  return parts.join(' ')
}

export function buildMyPrsQuery(settings: Pick<Settings, 'showDrafts'>): string {
  const parts = [...BASE_QUERY, 'author:@me']
  if (!settings.showDrafts) parts.push('draft:false')
  return parts.join(' ')
}

export function reviewSource(pr: RawPr, viewerLogin: string): ReviewSource {
  const reviewers = pr.reviewRequests.nodes.map((n) => n.requestedReviewer)
  const isDirect = reviewers.some(
    (r) => r?.__typename === 'User' && r.login?.toLowerCase() === viewerLogin.toLowerCase()
  )
  if (isDirect) return { kind: 'direct' }
  const team = reviewers.find((r) => r?.__typename === 'Team')
  // Without visibility into the team (e.g. missing read:org) the reviewer node is null.
  return { kind: 'team', slug: team?.slug ?? '' }
}

/** Summarizes where one of your PRs stands, using GitHub's review decision when the repo has one. */
export function myReviewStatus(
  decision: ReviewDecision,
  pendingCount: number,
  reviewStates: ReviewState[]
): MyReviewStatus {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes_requested'
  if (decision === null && reviewStates.includes('CHANGES_REQUESTED')) return 'changes_requested'
  if (pendingCount > 0) return 'waiting'
  // REVIEW_REQUIRED: branch protection still needs approvals.
  if (decision === 'REVIEW_REQUIRED') return reviewStates.length > 0 ? 'waiting' : 'no_reviewers'
  if (reviewStates.includes('APPROVED')) return 'approved'
  return 'no_reviewers'
}

// Search with type ISSUE can theoretically return non-PR nodes, which come back empty.
const isPr = <T extends { id?: string }>(n: T | null): n is T & { id: string } => Boolean(n && n.id)

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt)

function baseFields(n: RawPr & { id: string }) {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    author: n.author ? { login: n.author.login, avatarUrl: n.author.avatarUrl } : null,
    isDraft: n.isDraft,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    additions: n.additions,
    deletions: n.deletions
  }
}

function toReviewer(r: RawReviewer | null): Reviewer | null {
  if (r?.__typename === 'User' && r.login) return { kind: 'user', login: r.login, avatarUrl: r.avatarUrl ?? '' }
  if (r?.__typename === 'Team') return { kind: 'team', slug: r.slug ?? '' }
  return null
}

function toMyPr(n: RawMyPr & { id: string }): MyPullRequest {
  const pendingReviewers = n.reviewRequests.nodes
    .map((x) => toReviewer(x.requestedReviewer))
    .filter((r): r is Reviewer => r !== null)
  const reviews = n.latestOpinionatedReviews.nodes
    .filter((r) => r.author)
    .map((r) => ({ login: r.author!.login, avatarUrl: r.author!.avatarUrl, state: r.state }))
  return {
    ...baseFields(n),
    status: myReviewStatus(
      n.reviewDecision,
      pendingReviewers.length,
      reviews.map((r) => r.state)
    ),
    pendingReviewers,
    reviews
  }
}

export function mapResponse(body: RawResponse): FetchResult {
  const data = body.data
  if (!data?.viewer || !data.requested || !data.mine) {
    const first = body.errors?.[0]
    if (first?.type === 'RATE_LIMITED') throw new GithubError('rate_limited', first.message)
    throw new GithubError('unknown', first?.message ?? 'Unexpected response from GitHub')
  }

  const viewer = data.viewer
  const prs: PullRequest[] = data.requested.nodes
    .filter(isPr)
    .map((n) => ({ ...baseFields(n), source: reviewSource(n, viewer.login) }))
    .sort(newestFirst)
  const myPrs: MyPullRequest[] = data.mine.nodes.filter(isPr).map(toMyPr).sort(newestFirst)

  const warnings: Warning[] = []
  if (body.errors?.length) {
    const saml = body.errors.some((e) => /SAML/i.test(e.message))
    warnings.push(saml ? { code: 'saml' } : { code: 'partial', params: { detail: body.errors[0].message } })
  }
  if (data.requested.issueCount > data.requested.nodes.length) {
    warnings.push({ code: 'truncated_requested', params: { shown: prs.length, total: data.requested.issueCount } })
  }
  if (data.mine.issueCount > data.mine.nodes.length) {
    warnings.push({ code: 'truncated_mine', params: { shown: myPrs.length, total: data.mine.issueCount } })
  }
  return { viewer, prs, myPrs, warnings }
}

function rateLimitResetAt(res: Response): number | undefined {
  const reset = res.headers.get('x-ratelimit-reset')
  if (reset) return Number(reset) * 1000
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) return Date.now() + Number(retryAfter) * 1000
  return undefined
}

export async function fetchPullRequests(
  token: string,
  settings: SearchSettings,
  fetchFn: FetchFn = fetch
): Promise<FetchResult> {
  let res: Response
  try {
    res = await fetchFn(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'pr-radar'
      },
      body: JSON.stringify({
        query: PULL_REQUESTS_QUERY,
        variables: { requested: buildSearchQuery(settings), mine: buildMyPrsQuery(settings), first: PAGE_SIZE }
      }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new GithubError('network', `Could not reach GitHub (${(err as Error).message})`)
  }

  if (res.status === 401) {
    throw new GithubError('unauthorized', 'GitHub rejected the token (invalid or revoked)')
  }
  if (
    res.status === 429 ||
    (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))
  ) {
    throw new GithubError('rate_limited', 'GitHub rate limit reached', rateLimitResetAt(res))
  }
  if (!res.ok) {
    throw new GithubError('unknown', `GitHub answered ${res.status} ${res.statusText}`)
  }

  let body: RawResponse
  try {
    body = (await res.json()) as RawResponse
  } catch {
    throw new GithubError('unknown', 'GitHub answered with something that is not JSON')
  }
  return { ...mapResponse(body), tokenExpiration: res.headers.get('github-authentication-token-expiration') }
}
