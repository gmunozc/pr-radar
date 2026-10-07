import type { MessageKey } from '../shared/i18n/en'
import type { ReviewState } from '../shared/types'

/** How a review shows: the ring around the avatar and its tooltip. Pending drafts never show. */
export const REVIEW_LOOK: Record<ReviewState, { ring: 'approved' | 'changes' | 'commented'; label: MessageKey } | null> = {
  APPROVED: { ring: 'approved', label: 'reviewer.approved' },
  CHANGES_REQUESTED: { ring: 'changes', label: 'reviewer.changes' },
  COMMENTED: { ring: 'commented', label: 'reviewer.commented' },
  DISMISSED: { ring: 'commented', label: 'reviewer.dismissed' },
  PENDING: null
}
