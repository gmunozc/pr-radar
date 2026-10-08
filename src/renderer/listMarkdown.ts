/** A list of PRs as Markdown bullets, for a standup message or a note. Free of the DOM. */
import { timeAgo } from '../shared/format'
import type { Locale, Translate } from '../shared/i18n'
import type { MyPullRequest, PullRequest } from '../shared/types'

type Listed = PullRequest | MyPullRequest

const isMine = (pr: Listed): pr is MyPullRequest => 'status' in pr

/** Brackets and backslashes inside the link text would break the link. */
const escapeMd = (s: string) => s.replace(/[\\[\]]/g, (c) => `\\${c}`)

export function listMarkdown(prs: ReadonlyArray<Listed>, t: Translate, locale: Locale, now: number): string {
  return prs
    .map((pr) => {
      const parts = [`- [${pr.repo}#${pr.number} ${escapeMd(pr.title)}](${pr.url})`]
      if (isMine(pr)) parts.push(t(pr.readyToMerge ? 'status.ready' : `status.${pr.status}`))
      else if (pr.author) parts.push(`@${pr.author.login}`)
      if (pr.isDraft) parts.push(t('pr.draft'))
      parts.push(timeAgo(pr.createdAt, now, locale))
      return parts.join(' · ')
    })
    .join('\n')
}
