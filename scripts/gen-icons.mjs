// Generates the tray and app icons from inline SVG. Run with `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Octicon "git-pull-request" (16×16), MIT licensed.
const PR_PATH =
  'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z'

// macOS template image: pure black + alpha; the system tints it for light/dark menu bars.
const trayTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#000" d="${PR_PATH}"/></svg>`

// Windows/Linux: a filled badge readable on both light and dark taskbars.
const trayColor = (dot) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#2f81f7"/>
  <g transform="translate(6 6) scale(1.25)"><path fill="#fff" d="${PR_PATH}"/></g>
  ${dot ? '<circle cx="25" cy="7" r="6" fill="#f85149" stroke="#fff" stroke-width="2"/>' : ''}
</svg>`

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2f81f7"/>
      <stop offset="1" stop-color="#8250df"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#g)"/>
  <circle cx="512" cy="512" r="300" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="18"/>
  <circle cx="512" cy="512" r="210" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="14"/>
  <g transform="translate(272 272) scale(30)"><path fill="#fff" d="${PR_PATH}"/></g>
</svg>`

function render(svg, width, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
  const file = join(root, out)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, png)
  console.log(`  ${out} (${width}px)`)
}

console.log('Generating icons:')
render(trayTemplate, 16, 'resources/trayTemplate.png')
render(trayTemplate, 32, 'resources/trayTemplate@2x.png')
render(trayColor(false), 32, 'resources/tray.png')
render(trayColor(true), 32, 'resources/trayActive.png')
render(appIcon, 1024, 'build/icon.png')
