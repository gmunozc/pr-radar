import type {
  CheckInfo,
  CheckState,
  CiState,
  Installation,
  GithubErrorKind,
  Label,
  MergeBlocker,
  MergeMethod,
  MergeOptions,
  MyPullRequest,
  MyReviewStatus,
  PrCapabilities,
  PullRequest,
  RepoPermission,
  Reviewer,
  ReviewSource,
  ReviewState,
  Settings,
  Viewer,
  Warning
} from '../shared/types'

export const GRAPHQL_URL = 'https://api.github.com/graphql'
export const PAGE_SIZE = 50

// Both lists come from a single query (~2 rate-limit points).
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
    headRefOid
    headRefName
    repository { nameWithOwner }
    author { login avatarUrl }
    labels(first: 5) { nodes { name color } }
    commits(last: 1) {
      nodes {
        commit {
          statusCheckRollup {
            state
            contexts(first: 20) {
              totalCount
              nodes {
                __typename
                ... on CheckRun { name status conclusion detailsUrl }
                ... on StatusContext { context state targetUrl }
              }
            }
          }
        }
      }
    }
  }

  query PullRequests($requested: String!, $mine: String!, $first: Int!, $login: String!, $withMyReview: Boolean!) {
    viewer { login avatarUrl }
    requested: search(query: $requested, type: ISSUE, first: $first) {
      issueCount
      nodes {
        ... on PullRequest {
          ...PrFields
          viewerDidAuthor
          myReview: reviews(author: $login, last: 1, states: [APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED])
            @include(if: $withMyReview) {
            nodes { submittedAt commit { oid } }
          }
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
          mergeable
          mergeStateStatus
          baseRefName
          autoMergeRequest { enabledAt mergeMethod }
          viewerCanUpdateBranch
          viewerCanEnableAutoMerge
          viewerCanDisableAutoMerge
          repository {
            autoMergeAllowed
            mergeCommitAllowed
            squashMergeAllowed
            rebaseMergeAllowed
            deleteBranchOnMerge
            viewerDefaultMergeMethod
            viewerPermission
          }
          baseRef { branchProtectionRule { requiredApprovingReviewCount } }
          reviewThreads(first: 50) { totalCount nodes { isResolved } }
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
              author {
                login
                avatarUrl
                ... on User { id }
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

/** One entry of `statusCheckRollup.contexts`: a check run or a legacy commit status. */
export interface RawCheckContext {
  __typename: string
  name?: string
  status?: string | null
  conclusion?: string | null
  detailsUrl?: string | null
  context?: string
  state?: string | null
  targetUrl?: string | null
}

interface RawRollup {
  state: string
  contexts?: { totalCount: number; nodes: Array<RawCheckContext | null> } | null
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
  headRefOid?: string
  headRefName?: string | null
  labels?: { nodes: Array<{ name: string; color: string } | null> } | null
  viewerDidAuthor?: boolean
  commits?: { nodes: Array<{ commit: { statusCheckRollup: RawRollup | null } | null }> }
  reviewRequests: { nodes: Array<{ requestedReviewer: RawReviewer | null }> }
  myReview?: { nodes: Array<{ submittedAt: string | null; commit: { oid: string } | null }> }
}

type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

interface RawRepoMerge {
  autoMergeAllowed?: boolean | null
  mergeCommitAllowed?: boolean | null
  squashMergeAllowed?: boolean | null
  rebaseMergeAllowed?: boolean | null
  deleteBranchOnMerge?: boolean | null
  viewerDefaultMergeMethod?: string | null
  viewerPermission?: string | null
}

interface RawMyPr extends RawPr {
  reviewDecision: ReviewDecision
  mergeable?: Mergeable | null
  mergeStateStatus?: string | null
  baseRefName?: string | null
  autoMergeRequest?: { enabledAt: string | null; mergeMethod: string | null } | null
  viewerCanUpdateBranch?: boolean | null
  viewerCanEnableAutoMerge?: boolean | null
  viewerCanDisableAutoMerge?: boolean | null
  repository: RawPr['repository'] & RawRepoMerge
  baseRef?: { branchProtectionRule: { requiredApprovingReviewCount: number | null } | null } | null
  reviewThreads?: { totalCount: number; nodes: Array<{ isResolved: boolean } | null> } | null
  latestOpinionatedReviews: {
    nodes: Array<{ state: ReviewState; author: { id?: string; login: string; avatarUrl: string } | null }>
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
  errors?: Array<{ type?: string; message: string; path?: Array<string | number> }>
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

export function ciFromRollup(state: string | null | undefined): CiState {
  switch (state) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

interface MergeInput {
  status: MyReviewStatus
  isDraft: boolean
  ci: CiState
  mergeable: Mergeable | null | undefined
  mergeState: string | null | undefined
}

/** Approved, not a draft, checks green (or none), no conflicts and allowed by branch protection. */
export function isReadyToMerge(pr: MergeInput): boolean {
  return (
    pr.status === 'approved' &&
    !pr.isDraft &&
    (pr.ci === 'success' || pr.ci === 'none') &&
    pr.mergeable === 'MERGEABLE' &&
    (pr.mergeState === 'CLEAN' || pr.mergeState === 'HAS_HOOKS')
  )
}

export const hasConflicts = (pr: Pick<MergeInput, 'mergeable' | 'mergeState'>): boolean =>
  pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY'

/** GitHub would accept a merge now: clean (or hooks only), no conflicts, not a draft. Ignores reviews. */
export const isMergeableNow = (pr: Pick<MergeInput, 'isDraft' | 'mergeable' | 'mergeState'>): boolean =>
  !pr.isDraft && pr.mergeable === 'MERGEABLE' && (pr.mergeState === 'CLEAN' || pr.mergeState === 'HAS_HOOKS')

const MERGE_METHODS: readonly MergeMethod[] = ['MERGE', 'SQUASH', 'REBASE']
const PERMISSIONS: readonly RepoPermission[] = ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ']
const WRITE_PERMISSIONS: readonly RepoPermission[] = ['ADMIN', 'MAINTAIN', 'WRITE']

const toMergeMethod = (s: string | null | undefined): MergeMethod | null =>
  (MERGE_METHODS as readonly string[]).includes(s ?? '') ? (s as MergeMethod) : null

const toPermission = (s: string | null | undefined): RepoPermission | null =>
  (PERMISSIONS as readonly string[]).includes(s ?? '') ? (s as RepoPermission) : null

/** Merge settings of the repository; a method list that is empty means GitHub didn't say. */
export function mergeOptions(repo: RawRepoMerge | null | undefined): MergeOptions {
  const methods: MergeMethod[] = []
  if (repo?.mergeCommitAllowed) methods.push('MERGE')
  if (repo?.squashMergeAllowed) methods.push('SQUASH')
  if (repo?.rebaseMergeAllowed) methods.push('REBASE')
  const preferred = toMergeMethod(repo?.viewerDefaultMergeMethod)
  return {
    methods,
    defaultMethod: preferred && methods.includes(preferred) ? preferred : (methods[0] ?? 'MERGE'),
    deleteBranchOnMerge: repo?.deleteBranchOnMerge === true,
    autoMergeAllowed: repo?.autoMergeAllowed === true
  }
}

/** Maps one check run or commit status; null for unknown node types. */
export function checkFromContext(c: RawCheckContext | null): CheckInfo | null {
  if (!c) return null
  if (c.__typename === 'CheckRun') {
    let state: CheckState
    if (c.status !== 'COMPLETED') state = 'pending'
    else if (c.conclusion === 'SUCCESS') state = 'success'
    else if (c.conclusion === 'NEUTRAL' || c.conclusion === 'SKIPPED' || c.conclusion === 'STALE') state = 'skipped'
    else state = 'failure'
    return { name: c.name ?? '', state, url: c.detailsUrl ?? null }
  }
  if (c.__typename === 'StatusContext') {
    const state: CheckState =
      c.state === 'SUCCESS' ? 'success' : c.state === 'FAILURE' || c.state === 'ERROR' ? 'failure' : 'pending'
    return { name: c.context ?? '', state, url: c.targetUrl ?? null }
  }
  return null
}

const CHECK_ORDER: Record<CheckState, number> = { failure: 0, pending: 1, success: 2, skipped: 3 }

/** Checks on the head commit, failing ones first so the panel can show what blocks a PR. */
export function checksFromRollup(rollup: RawRollup | null | undefined): { checks: CheckInfo[]; total: number } {
  const nodes = rollup?.contexts?.nodes ?? []
  const checks = nodes.map(checkFromContext).filter((c): c is CheckInfo => c !== null)
  checks.sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state])
  return { checks, total: rollup?.contexts?.totalCount ?? checks.length }
}

/** Why an approved PR isn't ready; null when ready, not approved, or GitHub is still computing. */
export function mergeBlocker(pr: MergeInput): MergeBlocker | null {
  if (pr.status !== 'approved' || isReadyToMerge(pr)) return null
  if (pr.isDraft) return 'draft'
  if (hasConflicts(pr)) return 'conflicts'
  if (pr.ci === 'failure') return 'ci_failing'
  if (pr.ci === 'pending') return 'ci_pending'
  if (pr.mergeState === 'BEHIND') return 'behind'
  if (pr.mergeState === 'BLOCKED') return 'blocked'
  // UNKNOWN / unknown: GitHub hasn't computed mergeability yet.
  return null
}

// Search with type ISSUE can theoretically return non-PR nodes, which come back empty.
const isPr = <T extends { id?: string }>(n: T | null): n is T & { id: string } => Boolean(n && n.id)

const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => b.createdAt.localeCompare(a.createdAt)

function baseFields(n: RawPr & { id: string }, ciReadable: boolean) {
  const rollup = n.commits?.nodes[0]?.commit?.statusCheckRollup
  const { checks, total } = ciReadable ? checksFromRollup(rollup) : { checks: [], total: 0 }
  const labels: Label[] = (n.labels?.nodes ?? [])
    .filter((l): l is { name: string; color: string } => !!l && typeof l.name === 'string')
    .map((l) => ({ name: l.name, color: l.color ?? '' }))
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository?.nameWithOwner ?? '',
    author: n.author ? { login: n.author.login, avatarUrl: n.author.avatarUrl } : null,
    isDraft: n.isDraft,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    additions: n.additions,
    deletions: n.deletions,
    headOid: n.headRefOid ?? '',
    ci: ciReadable ? ciFromRollup(rollup?.state) : ('unknown' as const),
    branch: n.headRefName ?? '',
    labels,
    checks,
    checksTotal: total
  }
}

/** Your latest submitted review on a PR, and whether the author pushed after it. */
export function reviewFreshness(n: Pick<RawPr, 'headRefOid' | 'myReview'>): {
  lastReviewAt: string | null
  newCommitsSinceReview: boolean
} {
  const review = n.myReview?.nodes[n.myReview.nodes.length - 1]
  if (!review) return { lastReviewAt: null, newCommitsSinceReview: false }
  // A null commit (e.g. after a force-push rewrote it) also means the code changed.
  return { lastReviewAt: review.submittedAt, newCommitsSinceReview: review.commit?.oid !== n.headRefOid }
}

function toReviewer(r: RawReviewer | null): Reviewer | null {
  if (r?.__typename === 'User' && r.login) return { kind: 'user', login: r.login, avatarUrl: r.avatarUrl ?? '' }
  if (r?.__typename === 'Team') return { kind: 'team', slug: r.slug ?? '' }
  return null
}

function toMyPr(n: RawMyPr & { id: string }, readable: { ci: boolean; merge: boolean }): MyPullRequest {
  const pendingReviewers = n.reviewRequests.nodes
    .map((x) => toReviewer(x.requestedReviewer))
    .filter((r): r is Reviewer => r !== null)
  const reviews = n.latestOpinionatedReviews.nodes
    .filter((r) => r.author)
    .map((r) => ({
      login: r.author!.login,
      avatarUrl: r.author!.avatarUrl,
      state: r.state,
      ...(r.author!.id ? { id: r.author!.id } : {})
    }))
  const base = baseFields(n, readable.ci)
  const status = myReviewStatus(
    n.reviewDecision,
    pendingReviewers.length,
    reviews.map((r) => r.state)
  )
  const merge: MergeInput = {
    status,
    isDraft: n.isDraft,
    ci: base.ci,
    mergeable: readable.merge ? n.mergeable : 'UNKNOWN',
    mergeState: readable.merge ? n.mergeStateStatus : null
  }
  const permission = toPermission(n.repository?.viewerPermission)
  const canWriteRepo = permission !== null && WRITE_PERMISSIONS.includes(permission)
  const can: PrCapabilities = {
    updateBranch: n.viewerCanUpdateBranch === true,
    enableAutoMerge: n.viewerCanEnableAutoMerge === true,
    disableAutoMerge: n.viewerCanDisableAutoMerge === true,
    merge: canWriteRepo,
    requestReviews: canWriteRepo
  }
  const autoMethod = toMergeMethod(n.autoMergeRequest?.mergeMethod)
  const threads = n.reviewThreads?.nodes
  return {
    ...base,
    status,
    pendingReviewers,
    reviews,
    readyToMerge: isReadyToMerge(merge),
    blocker: mergeBlocker(merge),
    conflicts: hasConflicts(merge),
    mergeable: isMergeableNow(merge),
    baseBranch: n.baseRefName ?? '',
    permission,
    can,
    autoMerge:
      n.autoMergeRequest && autoMethod ? { method: autoMethod, enabledAt: n.autoMergeRequest.enabledAt ?? '' } : null,
    merge: mergeOptions(n.repository),
    unresolvedThreads: Array.isArray(threads) ? threads.filter((t) => t && !t.isResolved).length : null,
    requiredApprovals: n.baseRef?.branchProtectionRule?.requiredApprovingReviewCount ?? null
  }
}

/**
 * Fields a token may not be allowed to read. Errors on them degrade the field to "unknown"
 * (CI and merge state get a warning) instead of a "partial results" banner.
 */
const TOLERATED_FIELDS = new Set([
  'statusCheckRollup',
  'commits',
  'mergeable',
  'mergeStateStatus',
  'baseRef',
  'branchProtectionRule',
  'reviewThreads',
  'repository',
  'autoMergeRequest',
  'viewerCanUpdateBranch',
  'viewerCanEnableAutoMerge',
  'viewerCanDisableAutoMerge',
  'viewerDidAuthor',
  'labels'
])

/** Fields GitHub refused to return (e.g. a GitHub App without Checks permission). */
function forbiddenFields(errors: RawResponse['errors']): { ci: boolean; merge: boolean } {
  const paths = (errors ?? []).map((e) => (e.path ?? []).join('.'))
  return {
    ci: paths.some((p) => p.includes('statusCheckRollup') || p.includes('commits')),
    merge: paths.some((p) => p.includes('mergeable') || p.includes('mergeStateStatus'))
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
  const forbidden = forbiddenFields(body.errors)
  const readable = { ci: !forbidden.ci, merge: !forbidden.merge }
  const prs: PullRequest[] = data.requested.nodes
    .filter(isPr)
    .map((n) => ({
      ...baseFields(n, readable.ci),
      source: reviewSource(n, viewer.login),
      viewerDidAuthor: n.viewerDidAuthor === true,
      ...reviewFreshness(n)
    }))
    .sort(newestFirst)
  const myPrs: MyPullRequest[] = data.mine.nodes
    .filter(isPr)
    .map((n) => toMyPr(n, readable))
    .sort(newestFirst)

  const warnings: Warning[] = []
  if (forbidden.ci) warnings.push({ code: 'missing_permission', params: { field: 'checks' } })
  if (forbidden.merge) warnings.push({ code: 'missing_permission', params: { field: 'merge' } })
  const otherErrors = (body.errors ?? []).filter((e) => !(e.path ?? []).some((seg) => TOLERATED_FIELDS.has(String(seg))))
  if (otherErrors.length) {
    const saml = otherErrors.some((e) => /SAML/i.test(e.message))
    warnings.push(saml ? { code: 'saml' } : { code: 'partial', params: { detail: otherErrors[0].message } })
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

/**
 * Posts a GraphQL document. HTTP-level failures (network, 401, rate limit, 5xx) become
 * GithubErrors; GraphQL errors stay in the body for the caller to interpret.
 */
export async function graphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchFn: FetchFn = fetch
): Promise<{ body: T; response: Response }> {
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
      body: JSON.stringify({ query, variables }),
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

  let body: T
  try {
    body = (await res.json()) as T
  } catch {
    throw new GithubError('unknown', 'GitHub answered with something that is not JSON')
  }
  return { body, response: res }
}

export async function fetchPullRequests(
  token: string,
  settings: SearchSettings,
  /** Your login, to find your latest review on each PR; unknown right after signing in. */
  login?: string,
  fetchFn: FetchFn = fetch
): Promise<FetchResult> {
  const { body, response } = await graphqlRequest<RawResponse>(
    token,
    PULL_REQUESTS_QUERY,
    {
      requested: buildSearchQuery(settings),
      mine: buildMyPrsQuery(settings),
      first: PAGE_SIZE,
      login: login ?? '',
      withMyReview: Boolean(login)
    },
    fetchFn
  )
  return { ...mapResponse(body), tokenExpiration: response.headers.get('github-authentication-token-expiration') }
}

/** Repository/organization permissions PR Radar's GitHub App needs (all read-only). */
export const REQUIRED_APP_PERMISSIONS = ['pull_requests', 'checks', 'statuses'] as const

export interface InstallationInfo extends Installation {
  /** Granted permissions, e.g. { pull_requests: 'read' }. */
  permissions: Record<string, string>
}

/** GitHub App installations the signed-in user can access (user-to-server token). */
export async function fetchInstallations(token: string, fetchFn: FetchFn = fetch): Promise<InstallationInfo[]> {
  let res: Response
  try {
    res = await fetchFn('https://api.github.com/user/installations?per_page=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pr-radar'
      },
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    throw new GithubError('network', `Could not reach GitHub (${(err as Error).message})`)
  }
  if (res.status === 401) throw new GithubError('unauthorized', 'GitHub rejected the token (invalid or revoked)')
  if (!res.ok) throw new GithubError('unknown', `GitHub answered ${res.status} ${res.statusText}`)
  const body = (await res.json()) as {
    installations?: Array<{ account?: { login?: string; type?: string } | null; permissions?: Record<string, string> }>
  }
  return (body.installations ?? [])
    .filter((i) => i.account?.login)
    .map((i) => ({
      login: i.account!.login!,
      type: i.account!.type === 'Organization' ? 'Organization' : 'User',
      permissions: i.permissions ?? {}
    }))
}

/** Warnings about where the GitHub App is installed and what it was allowed to read. */
export function installationWarnings(installs: InstallationInfo[]): Warning[] {
  if (installs.length === 0) return [{ code: 'app_not_installed' }]
  const pending = installs.filter((i) => REQUIRED_APP_PERMISSIONS.some((p) => !i.permissions[p]))
  return pending.length
    ? [{ code: 'app_permissions_pending', params: { accounts: pending.map((i) => i.login).join(', ') } }]
    : []
}
