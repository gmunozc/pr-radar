import { useEffect, useState } from 'react'
import type { AppState, MyPullRequest, PrDetail as Detail, PullRequest } from '../../shared/types'
import { useT } from '../i18n'
import { REVIEW_LOOK } from '../reviews'
import { useSettings } from '../useSettings'
import { ChecksRow } from './ChecksRow'
import { MyPrItem } from './MyPrItem'
import { PrItem } from './PrItem'

interface Props {
  state: AppState
  prId: string
  /** The PR left every list (merged, closed, dismissed): go back. */
  onGone(): void
}

const isMine = (pr: PullRequest | MyPullRequest): pr is MyPullRequest => 'reviews' in pr

/**
 * One PR in full: its row (with every action), the checks, who reviewed, counts and the
 * description, loaded on demand.
 */
export function PrDetail({ state, prId, onGone }: Props) {
  const t = useT()
  const settings = useSettings()
  const pr = [...state.prs, ...state.myPrs, ...state.involved].find((p) => p.id === prId)
  const [detail, setDetail] = useState<Detail | null | 'loading'>('loading')

  useEffect(() => {
    if (!pr) onGone()
  }, [pr, onGone])

  useEffect(() => {
    let cancelled = false
    setDetail('loading')
    void window.prRadar.prs.detail(prId).then((d) => {
      if (!cancelled) setDetail(d)
    })
    return () => {
      cancelled = true
    }
  }, [prId, pr?.updatedAt])

  if (!pr) return null
  const staleDays = settings?.staleAfterDays ?? 0
  const row = isMine(pr) ? (
    <MyPrItem pr={pr} canWrite={state.canWrite} pending={state.pendingActions[pr.id]} armed={state.armedMerges[pr.id]} staleDays={staleDays} />
  ) : (
    <PrItem pr={pr} snoozeTomorrowAt={state.snoozeTomorrowAt} canWrite={state.canWrite} pending={state.pendingActions[pr.id]} staleDays={staleDays} />
  )

  return (
    <main className="list detail">
      {row}
      {pr.checks.length > 0 && (
        <section className="detail-section">
          <div className="detail-heading">{t('detail.checks')}</div>
          <ChecksRow checks={pr.checks} total={pr.checksTotal} />
        </section>
      )}
      {isMine(pr) && (pr.reviews.length > 0 || pr.pendingReviewers.length > 0) && (
        <section className="detail-section">
          <div className="detail-heading">{t('detail.reviews')}</div>
          <ul className="detail-reviews">
            {pr.reviews.map((r) => {
              const look = REVIEW_LOOK[r.state]
              if (!look) return null
              return (
                <li key={`r-${r.login}`} className={`detail-review review-${look.ring}`}>
                  <img className="reviewer" src={r.avatarUrl} alt="" />
                  <span>{t(look.label, { login: r.login })}</span>
                </li>
              )
            })}
            {pr.pendingReviewers.map((r) => (
              <li key={r.kind === 'user' ? `p-${r.login}` : `t-${r.slug}`} className="detail-review review-pending">
                {r.kind === 'user' ? <img className="reviewer" src={r.avatarUrl} alt="" /> : <span className="reviewer-team">@{r.slug || t('reviewer.team')}</span>}
                <span>{t('reviewer.pending', { name: r.kind === 'user' ? `@${r.login}` : `@${r.slug}` })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="detail-section">
        <div className="detail-heading">{t('detail.description')}</div>
        {detail === 'loading' ? (
          <div className="spinner spinner-sm" />
        ) : detail === null ? (
          <div className="detail-muted">{t('detail.loadFailed')}</div>
        ) : (
          <>
            <div className="detail-stats">
              <span>{t('detail.files', { count: detail.changedFiles })}</span>
              <span>{t('detail.commits', { count: detail.commits })}</span>
              <span>{t('detail.comments', { count: detail.comments })}</span>
            </div>
            {detail.body ? <div className="detail-body">{detail.body}</div> : <div className="detail-muted">{t('detail.noBody')}</div>}
          </>
        )}
      </section>
    </main>
  )
}
