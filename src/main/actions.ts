/**
 * Writes to GitHub on the user's behalf: update a PR's branch, enable or disable auto-merge,
 * merge, ask reviewers again, approve. One GraphQL mutation per action. Free of Electron APIs
 * so it can be unit tested; the engine decides which PR and which head commit each action targets.
 */
import type { ActionErrorCode, ActionResult, PrAction } from '../shared/types'
import { graphqlRequest } from './github'

export interface ActionTarget {
  id: string
  /** Head commit the panel showed; mutations that take `expectedHeadOid` fail if it moved. */
  headOid: string
  repo: string
  number: number
  /** Node ids of the reviewers to ask again (rerequest_review). */
  reviewerIds?: string[]
}

type FetchFn = typeof fetch

interface GraphqlError {
  type?: string
  message: string
}

const MUTATIONS: Record<PrAction['kind'], string> = {
  update_branch: /* GraphQL */ `
    mutation UpdateBranch($id: ID!, $head: GitObjectID) {
      updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $head }) { pullRequest { headRefOid } }
    }`,
  enable_auto_merge: /* GraphQL */ `
    mutation EnableAutoMerge($id: ID!, $head: GitObjectID, $method: PullRequestMergeMethod) {
      enablePullRequestAutoMerge(input: { pullRequestId: $id, expectedHeadOid: $head, mergeMethod: $method }) {
        pullRequest { autoMergeRequest { enabledAt mergeMethod } }
      }
    }`,
  disable_auto_merge: /* GraphQL */ `
    mutation DisableAutoMerge($id: ID!) {
      disablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { id } }
    }`,
  merge: /* GraphQL */ `
    mutation Merge($id: ID!, $head: GitObjectID, $method: PullRequestMergeMethod) {
      mergePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head, mergeMethod: $method }) { pullRequest { merged } }
    }`,
  rerequest_review: /* GraphQL */ `
    mutation RerequestReview($id: ID!, $users: [ID!]) {
      requestReviews(input: { pullRequestId: $id, userIds: $users, union: true }) { pullRequest { id } }
    }`,
  approve: /* GraphQL */ `
    mutation Approve($id: ID!, $head: GitObjectID, $body: String) {
      addPullRequestReview(input: { pullRequestId: $id, commitOID: $head, event: APPROVE, body: $body }) {
        pullRequestReview { id }
      }
    }`
}

/** The mutation and variables for an action; `expectedHeadOid` is omitted when the head is unknown. */
export function mutationFor(pr: ActionTarget, action: PrAction): { query: string; variables: Record<string, unknown> } {
  const head = pr.headOid || undefined
  switch (action.kind) {
    case 'update_branch':
      return { query: MUTATIONS.update_branch, variables: { id: pr.id, head } }
    case 'enable_auto_merge':
      return { query: MUTATIONS.enable_auto_merge, variables: { id: pr.id, head, method: action.method } }
    case 'disable_auto_merge':
      return { query: MUTATIONS.disable_auto_merge, variables: { id: pr.id } }
    case 'merge':
      return { query: MUTATIONS.merge, variables: { id: pr.id, head, method: action.method } }
    case 'rerequest_review':
      return { query: MUTATIONS.rerequest_review, variables: { id: pr.id, users: pr.reviewerIds ?? [] } }
    case 'approve':
      return { query: MUTATIONS.approve, variables: { id: pr.id, head, body: action.body?.trim() || undefined } }
  }
}

/**
 * Classifies GraphQL errors from a mutation. GitHub's messages aren't documented, so this
 * matches on wording seen in practice; anything else is `unknown` with the raw message.
 */
export function actionErrorCode(errors: GraphqlError[]): { code: ActionErrorCode; detail: string } {
  const detail = errors.map((e) => e.message).join('; ')
  const first = errors[0]
  let code: ActionErrorCode = 'unknown'
  if (first?.type === 'FORBIDDEN') code = 'forbidden'
  else if (first?.type === 'NOT_FOUND') code = 'not_found'
  else if (/clean status/i.test(detail)) code = 'already_mergeable'
  else if (/expected head|head (ref|sha|commit)?.*(changed|modified|moved|does not match|mismatch)/i.test(detail)) code = 'stale'
  else if (/auto.?merge.*(not (allowed|enabled)|disabled)/i.test(detail)) code = 'auto_merge_unavailable'
  else if (/not mergeable|conflict|required status|review.*required|protected branch|blocked|merge queue|out of date/i.test(detail)) {
    code = 'not_mergeable'
  }
  return { code, detail }
}

/** Runs one action; HTTP-level failures throw GithubError (the engine maps them), GraphQL errors return a code. */
export async function runPrAction(
  token: string,
  pr: ActionTarget,
  action: PrAction,
  fetchFn: FetchFn = fetch
): Promise<ActionResult> {
  const { query, variables } = mutationFor(pr, action)
  const { body } = await graphqlRequest<{ data?: unknown; errors?: GraphqlError[] }>(token, query, variables, fetchFn)
  if (body.errors?.length) return { ok: false, ...actionErrorCode(body.errors) }
  return { ok: true }
}
