// electron-builder hook (afterAllArtifactBuild): recompresses each dmg with LZMA (ULMO), about
// 20% smaller than the zlib image electron-builder 26 writes. ULMO needs macOS 10.15+, and
// Electron 44 already needs macOS 12.
import { execFileSync } from 'node:child_process'
import { renameSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'

const mb = (file) => `${(statSync(file).size / 1048576).toFixed(1)} MB`

export default function compressDmgs({ artifactPaths }) {
  for (const dmg of artifactPaths.filter((file) => file.endsWith('.dmg'))) {
    const tmp = `${dmg}.ulmo.dmg`
    rmSync(tmp, { force: true })
    const before = mb(dmg)
    execFileSync('hdiutil', ['convert', dmg, '-format', 'ULMO', '-o', tmp, '-quiet'])
    renameSync(tmp, dmg)
    console.log(`  • recompressed ${basename(dmg)}: ${before} → ${mb(dmg)}`)
  }
  return []
}
