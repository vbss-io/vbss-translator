import { spawnSync } from 'node:child_process'
import { checkStamp, git, repoRoot, writeStamp } from './release-state.mjs'

const [bump, ...publishArgs] = process.argv.slice(2)
const VERSION_FILES = new Set(['package.json', 'package-lock.json'])

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('usage: release.mjs <patch|minor|major> [npm publish args]')
  process.exit(2)
}

const run = (args) => {
  const result = spawnSync(`npm ${args.join(' ')}`, { cwd: repoRoot, stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const gate = checkStamp()
if (!gate.ok) {
  console.error(`release refused: ${gate.reason}`)
  process.exit(1)
}

run(['version', bump])

const touched = git('diff', '--name-only', gate.state.head, 'HEAD').split('\n').filter(Boolean)
const unexpected = touched.filter((file) => !VERSION_FILES.has(file))
if (unexpected.length > 0) {
  console.error(`release refused: the version commit touched unexpected files: ${unexpected.join(', ')}`)
  process.exit(1)
}

writeStamp()
run(['publish', ...publishArgs])
