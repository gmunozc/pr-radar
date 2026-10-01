/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GITHUB_CLIENT_ID?: string
  /** Client ID and slug of the read-only GitHub App (preferred sign-in when set). */
  readonly MAIN_VITE_GITHUB_APP_CLIENT_ID?: string
  readonly MAIN_VITE_GITHUB_APP_SLUG?: string
  /** owner/repo whose releases are checked for updates; empty disables the check (forks). */
  readonly MAIN_VITE_UPDATE_REPO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
