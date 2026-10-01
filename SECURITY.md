# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository ([private vulnerability reporting](https://github.com/gmunozc/pr-radar/security/advisories/new)). Don't open a public issue. You'll get an answer as soon as possible; please give a reasonable amount of time to fix the issue before disclosing it.

## How PR Radar handles your GitHub access

- **Sign-in** uses GitHub's device flow; the app never sees your password. With the GitHub App, the token is read-only and limited to the repositories where you installed the app. With the OAuth App, it has the `repo` scope (needed to read private pull requests through an OAuth App).
- **Tokens** (access and refresh) are stored in `~/Library/Application Support/PR Radar/auth.bin`, encrypted with Electron's `safeStorage`, whose key lives in the macOS Keychain ("PR Radar Safe Storage"). The file is written atomically with mode `0600`. Where the OS offers no encryption (some Linux setups) it falls back to plain text and logs a warning.
- **Logs and diagnostics** pass through a redaction step that removes anything that looks like a GitHub token or an `Authorization` header.
- **Network:** only `api.github.com`, `github.com` and `avatars.githubusercontent.com`. No telemetry, no third-party services.

## Electron hardening

- The panel runs with `contextIsolation`, `sandbox` and no Node.js integration; it talks to the main process through a small typed API (`src/preload/index.ts`), and every IPC input is validated in the main process.
- A Content Security Policy only allows the app's own scripts and styles, and images from GitHub's avatar CDN.
- The panel can't navigate or open windows; external links only open for `https://github.com` URLs (and update downloads only for this repository's releases).

## Release builds

Releases are built by GitHub Actions from a tagged commit (`.github/workflows/release.yml`) and published with a `SHA256SUMS.txt`. Builds are ad-hoc signed, not notarized: there is no Apple Developer ID.
