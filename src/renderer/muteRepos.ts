/** "Mute alerts for this repository" from a row: the list of muted repositories lives in Settings. */
import type { Settings } from '../shared/types'

type MuteSettings = Pick<Settings, 'muteRepos'> | null | undefined

/** The list with `repo` muted or unmuted; unchanged when it already is. */
export function withMuted(repos: readonly string[], repo: string, muted: boolean): string[] {
  const without = repos.filter((r) => r !== repo)
  return muted ? [...without, repo] : without
}

/** Row props for the mute toggle; nothing is offered until the settings are known. */
export function muteProps(
  settings: MuteSettings,
  repo: string,
  save: (muteRepos: string[]) => void
): { muted?: boolean; onMute?(muted: boolean): void } {
  if (!settings) return {}
  return { muted: settings.muteRepos.includes(repo), onMute: (muted) => save(withMuted(settings.muteRepos, repo, muted)) }
}
