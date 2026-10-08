/** The menu entries every row shares, so PrItem and MyPrItem don't each spell them out. */
import type { Translate } from '../shared/i18n'
import type { SharedMenuAction } from '../shared/prActions'
import type { MenuItem } from './components/ActionMenu'

export interface SharedMenuContext {
  pr: { id: string; title: string; url: string; branch: string; repo: string }
  t: Translate
  /** Plain text to the clipboard, with the row's "Copied" feedback. */
  copy(text: string): void
  /** Title and link, as Markdown and as a rich-text link. */
  copyLink(): void
  open(url: string): void
  onDetail?(prId: string): void
  /** Mute or unmute alerts for the PR's repository; absent when the row can't change it. */
  setMuted?(muted: boolean): void
}

export function sharedMenuItem(id: SharedMenuAction, ctx: SharedMenuContext): MenuItem {
  const { pr, t } = ctx
  switch (id) {
    case 'copy_branch':
      return { id, label: t('action.copyBranch'), onSelect: () => ctx.copy(pr.branch) }
    case 'copy_link':
      return { id, label: t('action.copyLink'), onSelect: () => ctx.copy(pr.url) }
    case 'copy_title_link':
      return { id, label: t('action.copyTitleLink'), onSelect: () => ctx.copyLink() }
    case 'details':
      return { id, label: t('action.details'), onSelect: () => ctx.onDetail?.(pr.id) }
    case 'mute_repo':
      return { id, label: t('action.muteRepo', { repo: pr.repo }), onSelect: () => ctx.setMuted?.(true) }
    case 'unmute_repo':
      return { id, label: t('action.unmuteRepo', { repo: pr.repo }), onSelect: () => ctx.setMuted?.(false) }
    case 'view_files':
      return { id, label: t('action.viewFiles'), onSelect: () => ctx.open(`${pr.url}/files`) }
    case 'view_checks':
      return { id, label: t('action.viewChecks'), onSelect: () => ctx.open(`${pr.url}/checks`) }
    case 'open':
      return { id, label: t('action.open'), onSelect: () => ctx.open(pr.url) }
  }
}
