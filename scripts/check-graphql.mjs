// Validates the GraphQL documents in src/main against GitHub's live schema, using the token
// of the `gh` CLI. The query runs for real (read-only); each mutation runs with an invalid PR
// id, so GitHub validates the document and then fails with NOT_FOUND without touching
// anything. Unit tests can't catch a field that doesn't exist on GitHub's side; this does.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const github = readFileSync(new URL('../src/main/github.ts', import.meta.url), 'utf8')
const actions = readFileSync(new URL('../src/main/actions.ts', import.meta.url), 'utf8')
const query = github.match(/PULL_REQUESTS_QUERY = \/\* GraphQL \*\/ `([\s\S]*?)`/)[1]
const mutations = [...actions.matchAll(/(\w+): \/\* GraphQL \*\/ `([\s\S]*?)`/g)].map((m) => [m[1], m[2]])

function run(doc, variables) {
  const args = ['api', 'graphql', '-f', `query=${doc}`]
  for (const [key, value] of Object.entries(variables)) {
    if (Array.isArray(value)) for (const item of value) args.push('-f', `${key}[]=${item}`)
    else args.push(typeof value === 'string' ? '-f' : '-F', `${key}=${value}`)
  }
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  } catch (err) {
    // gh exits 1 when the response carries GraphQL errors; the body is still on stdout.
    if (err.stdout) return JSON.parse(err.stdout)
    throw err
  }
}

let failed = false
function report(name, errors) {
  const validation = errors.filter((e) => e.type !== 'NOT_FOUND')
  if (validation.length === 0) return console.log(`✓ ${name}`)
  failed = true
  console.log(`✗ ${name}: ${validation.map((e) => e.message).join('; ')}`)
}

const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim()
const base = 'is:pr is:open archived:false'
const result = run(query, {
  requested: `${base} review-requested:@me`,
  mine: `${base} author:@me`,
  first: 5,
  login,
  withMyReview: true
})
report('PULL_REQUESTS_QUERY', result.errors ?? [])
for (const [name, doc] of mutations) {
  const r = run(doc, { id: 'PR_kwDOinvalid0000', head: '0'.repeat(40), method: 'SQUASH', body: 'x', users: ['U_kgDOinvalid'] })
  report(`mutation ${name}`, r.errors ?? [])
}
process.exit(failed ? 1 : 0)
