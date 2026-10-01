/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_GITHUB_CLIENT_ID?: string
  /** owner/repo whose releases are checked for updates; empty disables the check (forks). */
  readonly MAIN_VITE_UPDATE_REPO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
