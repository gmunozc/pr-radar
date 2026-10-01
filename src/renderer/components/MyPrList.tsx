import type { AppState } from '../../shared/types'
import { PullRequestIcon } from '../icons'
import { MyPrItem } from './MyPrItem'

const MY_PULLS_URL = 'https://github.com/pulls'

export function MyPrList({ state }: { state: AppState }) {
  if (state.status === 'loading' && state.myPrs.length === 0) {
    return (
      <main className="list list-empty">
        <div className="spinner" />
      </main>
    )
  }

  if (state.myPrs.length === 0) {
    return (
      <main className="list list-empty">
        <PullRequestIcon size={32} className="empty-icon-muted" />
        <div className="empty-title">No tienes PRs abiertos</div>
        <div className="empty-sub">Aquí verás tus PRs y quién falta por revisarlos.</div>
      </main>
    )
  }

  return (
    <>
      <main className="list">
        {state.myPrs.map((pr) => (
          <MyPrItem key={pr.id} pr={pr} />
        ))}
      </main>
      <footer className="footer">
        <button className="link" onClick={() => void window.prRadar.openExternal(MY_PULLS_URL)}>
          Ver mis PRs en GitHub
        </button>
      </footer>
    </>
  )
}
