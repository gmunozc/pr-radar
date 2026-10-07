import { useT } from '../i18n'
import type { SendTo } from '../useLaunchers'

/** Under a PR: "Preparing…" while a "Send to…" action sets up its workspace, or why it failed. */
export function SendToStatus({ sendTo }: { sendTo: SendTo }) {
  const t = useT()
  if (sendTo.launching) {
    return (
      <div className="launch-status" role="status">
        <span className="spinner spinner-sm" />
        {t('launch.preparing', { label: sendTo.launching })}
      </div>
    )
  }
  if (!sendTo.error) return null
  return (
    <div className="confirm-error" role="alert">
      {sendTo.error}
    </div>
  )
}
