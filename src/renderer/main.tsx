// Outside Electron (the renderer served by `npm run panel:dev` and opened in a browser) there is
// no preload: install the fictional API before any module reads window.prRadar. The check is
// compiled away in builds, where the preload always exists.
if (!window.prRadar && import.meta.env.DEV) {
  const { createMockApi } = await import('./mockApi')
  window.prRadar = createMockApi()
}

await import('./bootstrap')
