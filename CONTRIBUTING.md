# Contributing

Thanks for helping! Bug reports, ideas and pull requests are welcome.

## Getting started

```sh
npm ci
cp .env.example .env   # your own OAuth App / GitHub App client IDs (see README → Build from source)
npm run dev            # hot reload; uses a separate "PR Radar Dev" data folder and keeps
                       # the session in plain text there, so it never touches your installed app
```

Before opening a pull request:

```sh
npm run typecheck
npm test
```

CI runs both on every push and pull request.

## Project layout

```
src/main/          main process
  engine.ts        polling and change probes, new-PR detection, dismiss/snooze, quiet hours, digest (no Electron imports)
  github.ts        GraphQL queries (the list, the change probe, and the on-demand detail, threads and outcome lookups) and
                   mapping; deviceFlow.ts / session.ts: sign-in and token renewal
  diff.ts          pure "what changed" logic; schedule.ts: calendar rules; notifications.ts: texts; mute.ts: muted repositories;
                   trayState.ts: what the tray shows
  launcher.ts      Send to: worktree at the PR head, then a Warp tab with Claude Code;
                   launcherConfig.ts: launchers.json validation; projects.ts: repos and skills
  panelDecision.ts pure rules for opening and closing the panel (click, blur, check after showing); window.ts applies them
  index.ts         composition root: wires the engine to Electron (tray, panel, IPC, timers)
src/preload/       typed bridge exposed to the panel as window.prRadar
src/renderer/      the panel (React); its pure parts live beside it: arrange.ts (filters, search), markdown.ts (description
                   parser), listMarkdown.ts (copy list), rowMenu.ts (shared menu entries), muteRepos.ts
src/shared/        types and i18n dictionaries shared by both sides
tests/             vitest unit tests (run with TZ=UTC)
```

Keep logic in Electron-free modules with injected dependencies, so it can be unit tested; `index.ts`, `window.ts`, `tray.ts` and `notifier.ts` are thin adapters.

## Conventions

- **No runtime dependencies.** Everything the app needs ships in the bundle; prefer small, hand-written helpers.
- **Every user-visible string goes through i18n.** Add the key to `src/shared/i18n/en.ts` and `es.ts` (the Spanish dictionary is typed against the English one, and `tests/i18n.test.ts` checks keys and placeholders match).
- **Errors and warnings cross IPC as codes**, translated where they're shown; raw GitHub messages only go to the log.
- Match the surrounding code style; comments explain *why*, not *what*.
- **Confirmations and menus live inside the panel** (`ActionMenu`, `ConfirmRow`): the panel hides when it loses focus, so native dialogs and context menus would close it.

## Running and debugging

- `npm run dev` uses the "PR Radar Dev" data folder and a plain-text session, so it never touches an installed PR Radar.
- `PR_RADAR_DEBUG=1` logs at debug level (panel show/hide, polling details).
- `PR_RADAR_DEV_VERSION=0.0.1 npm run dev` pretends to be that version, so the new-version banner and the install flow can be exercised against the real releases.
- Notification buttons need a signed app on macOS. The ad-hoc signature of the release builds is enough (the UNUserNotification framework needs one to show anything at all), so they are always on; `npm run dev` shows them too, since Electron's own binary is signed. Settings → **Test** sends a notification with a button to check.
- Panel that won't open (macOS full-screen Spaces, several displays): the `panel …` lines of the log say what happened. The installed app logs the anomalies at info and warn (`panel click ignored`, `panel shown again`, `panel shown without focus`, `panel not displayed after showing`); with `PR_RADAR_DEBUG=1` it logs every show, blur, hide and click with the facts the decision used. `swift scripts/spaces-probe.swift` (private SkyLight calls, diagnostics only) prints the Spaces every PR Radar window belongs to: a healthy panel lists every Space once it has been shown. One stuck on a single Space is the macOS 26/27 bug where closing a full-screen Space rebuilds the Space list of "managed" windows, which is what Chromium makes every always-on-top window; the panel is made transient with `setHiddenInMissionControl(true)` so it joins every Space again whenever it is shown. To reproduce the bug: open the panel once, put any window into full screen (the tray's Debug menu has **Full-screen test window**), close it, and open the panel from another Space. When a Space switch starts, macOS takes the panel off the screen about 50 ms in (the switch itself ends a second later, with the blur), and the panel closes right then (`panel off screen {decision: hide}`) instead of showing up again on the next Space. The Debug menu also has **Log panel state**; `PR_RADAR_DEV_SHOW_PANEL_MS=<ms>` opens the panel by itself after that time and `PR_RADAR_DEV_PANEL_LEVEL=<level>` tries another window level.
- `PR_RADAR_SMOKE=1 npx electron .` (after `npm run build`) starts the app with an empty data folder and exits 0 once the panel has rendered, 1 after 60 s without it. CI runs it on the unpacked Windows and Linux builds, and the release workflow on the arm64 app before creating the draft.
- `npm run panel:dev` serves the panel alone at http://localhost:5174 with fictional data (`src/renderer/mockApi.ts`), so the UI can be worked on without Electron or a GitHub session. `npm run panel:shot out.png --dark --step "<js>"` renders that page offscreen with Electron and saves a PNG; the screenshots in `docs/` come from it.
- `npm run check:graphql` validates every query and mutation against GitHub's live schema through the `gh` CLI (mutations run with an invalid PR id, so nothing is touched). Run it before a release: unit tests can't catch a field GitHub doesn't have. A new GraphQL document needs its own extraction line in `scripts/check-graphql.mjs`.

## Releasing

1. `npm version X.Y.Z --no-git-tag-version`, commit, then `git tag -a vX.Y.Z -m "PR Radar X.Y.Z"` and push both.
2. The **Release** workflow checks the tag matches `package.json`, runs the tests, builds one dmg for Apple Silicon and one for Intel (client IDs come from the repository variables `OAUTH_CLIENT_ID`, `APP_CLIENT_ID`, `APP_SLUG`; `scripts/compress-dmg.mjs` recompresses them) and creates a **draft** release with the dmgs and `SHA256SUMS.txt`.
3. Review the draft, write the release notes, publish it. Installed apps see it through the new-version notice.
