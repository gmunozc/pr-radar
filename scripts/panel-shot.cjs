// Screenshots the panel without showing a window, using Electron's offscreen rendering:
//   npx electron scripts/panel-shot.cjs out.png [--url http://localhost:5174] [--dark]
//     [--width 380] [--height 540] [--wait "<css selector>"] [--step "<js>"]...
// Each --step runs in the page in order (a short pause follows each one); the capture comes
// after the last step. Pair it with `npm run panel:dev` (fictional data) for docs and checks.
const { app, BrowserWindow, nativeTheme } = require('electron')
const { writeFileSync } = require('node:fs')

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith('--')) ?? 'panel.png'
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const steps = args.flatMap((a, i) => (a === '--step' ? [args[i + 1]] : []))
const url = option('url', 'http://localhost:5174/')
const width = Number(option('width', 380))
const height = Number(option('height', 540))
const waitFor = option('wait', '.app')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.dock?.hide()
nativeTheme.themeSource = args.includes('--dark') ? 'dark' : 'light'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    backgroundColor: args.includes('--dark') ? '#1f2328' : '#ffffff',
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true }
  })
  win.webContents.setFrameRate(10)
  win.webContents.on('console-message', (_e, _level, message) => console.error(`[page] ${message}`))
  try {
    await win.loadURL(url)
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(waitFor)})`)) break
      await sleep(100)
    }
    for (const step of steps) {
      await win.webContents.executeJavaScript(`(async () => { ${step} })()`)
      await sleep(400)
    }
    await sleep(300)
    const image = await win.webContents.capturePage()
    writeFileSync(out, image.toPNG())
    console.log(`${out} ${image.getSize().width}x${image.getSize().height}`)
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
