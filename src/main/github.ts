import type { GithubErrorKind, PullRequest, ReviewSource, Settings, Viewer } from '../shared/types'

export const GRAPHQL_URL = 'https://api.github.com/graphql'
export const PAGE_SIZE = 50

export const REVIEW_REQUESTS_QUERY = /* GraphQL */ `
  query ReviewRequests($q: String!, $first: Int!) {
    viewer { login avatarUrl }
    search(query: $q, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
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
  warnings: string[]
}

type FetchFn = typeof fetch

interface RawReviewer {
  __typename: string
  login?: string
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

interface RawResponse {
  data?: {
    viewer: Viewer
    search: { issueCount: number; nodes: RawPr[] }
  } | null
  errors?: Array<{ type?: string; message: string }>
}

export function buildSearchQuery(settings: Pick<Settings, 'includeTeams' | 'showDrafts'>): string {
  const parts = ['is:pr', 'is:open', 'archived:false']
  parts.push(settings.includeTeams ? 'review-requested:@me' : 'user-review-requested:@me')
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

export function mapResponse(body: RawResponse): FetchResult {
  const data = body.data
  if (!data?.viewer || !data.search) {
    const first = body.errors?.[0]
    if (first?.type === 'RATE_LIMITED') throw new GithubError('rate_limited', first.message)
    throw new GithubError('unknown', first?.message ?? 'Respuesta inesperada de GitHub')
  }

  const viewer = data.viewer
  const prs: PullRequest[] = data.search.nodes
    // Search with type ISSUE can theoretically return non-PR nodes, which come back empty.
    .filter((n): n is RawPr & { id: string } => Boolean(n && n.id))
    .map((n) => ({
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
      deletions: n.deletions,
      source: reviewSource(n, viewer.login)
    }))
    // Newest review requests first.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const warnings: string[] = []
  if (body.errors?.length) {
    const saml = body.errors.some((e) => /SAML/i.test(e.message))
    warnings.push(
      saml
        ? 'Algunas organizaciones requieren autorizar SAML SSO para este token; sus PRs no aparecen.'
        : `GitHub devolvió resultados parciales: ${body.errors[0].message}`
    )
  }
  if (data.search.issueCount > data.search.nodes.length) {
    warnings.push(`Mostrando ${prs.length} de ${data.search.issueCount} PRs.`)
  }
  return { viewer, prs, warnings }
}

function rateLimitResetAt(res: Response): number | undefined {
  const reset = res.headers.get('x-ratelimit-reset')
  if (reset) return Number(reset) * 1000
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter) return Date.now() + Number(retryAfter) * 1000
  return undefined
}

export async function fetchReviewRequests(
  token: string,
  settings: Pick<Settings, 'includeTeams' | 'showDrafts'>,
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
        query: REVIEW_REQUESTS_QUERY,
        variables: { q: buildSearchQuery(settings), first: PAGE_SIZE }
      }),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new GithubError('network', `Sin conexión con GitHub (${(err as Error).message})`)
  }

  if (res.status === 401) {
    throw new GithubError('unauthorized', 'El token de GitHub no es válido o fue revocado.')
  }
  if (
    res.status === 429 ||
    (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))
  ) {
    throw new GithubError('rate_limited', 'Límite de peticiones de GitHub alcanzado.', rateLimitResetAt(res))
  }
  if (!res.ok) {
    throw new GithubError('unknown', `GitHub respondió ${res.status} ${res.statusText}`)
  }

  let body: RawResponse
  try {
    body = (await res.json()) as RawResponse
  } catch {
    throw new GithubError('unknown', 'GitHub devolvió una respuesta que no es JSON')
  }
  return mapResponse(body)
}
