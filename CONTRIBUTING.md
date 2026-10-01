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
  engine.ts        polling, new-PR detection, dismiss/snooze, quiet hours, digest (no Electron imports)
  github.ts        GraphQL query and mapping; deviceFlow.ts / session.ts: sign-in and token renewal
  diff.ts          pure "what changed" logic; schedule.ts: calendar rules; notifications.ts: texts
  index.ts         composition root: wires the engine to Electron (tray, panel, IPC, timers)
src/preload/       typed bridge exposed to the panel as window.prRadar
src/renderer/      the panel (React)
src/shared/        types and i18n dictionaries shared by both sides
tests/             vitest unit tests (run with TZ=UTC)
```

Keep logic in Electron-free modules with injected dependencies, so it can be unit tested; `index.ts`, `window.ts`, `tray.ts` and `notifier.ts` are thin adapters.

## Conventions

- **No runtime dependencies.** Everything the app needs ships in the bundle; prefer small, hand-written helpers.
- **Every user-visible string goes through i18n.** Add the key to `src/shared/i18n/en.ts` and `es.ts` (the Spanish dictionary is typed against the English one, and `tests/i18n.test.ts` checks keys and placeholders match).
- **Errors and warnings cross IPC as codes**, translated where they're shown; raw GitHub messages only go to the log.
- Match the surrounding code style; comments explain *why*, not *what*.

## Releasing

1. `npm version X.Y.Z --no-git-tag-version`, commit, then `git tag -a vX.Y.Z -m "PR Radar X.Y.Z"` and push both.
2. The **Release** workflow checks the tag matches `package.json`, runs the tests, builds the universal dmg (client IDs come from the repository variables `OAUTH_CLIENT_ID`, `APP_CLIENT_ID`, `APP_SLUG`) and creates a **draft** release with the dmg and `SHA256SUMS.txt`.
3. Review the draft, write the release notes, publish it. Installed apps see it through the new-version notice.
