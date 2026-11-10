import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const [bump, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
const VERSION_FILES = new Set(['package.json', 'package-lock.json'])

if (!['patch', 'minor', 'major'].includes(bump) || flags.some((flag) => flag !== '--dry-run')) {
  console.error('usage: release.mjs <patch|minor|major> [--dry-run]')
  process.exit(2)
}

const refuse = (reason) => {
  console.error(`release refused: ${reason}`)
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const restoreDryRun = () => {
  if (dryRun) git('checkout', '--', ...VERSION_FILES)
}

const npm = (args) => {
  const result = spawnSync(`npm ${args.join(' ')}`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VBSS_RELEASE: '1' },
  })
  if (result.status !== 0) {
    restoreDryRun()
    refuse(`"npm ${args.join(' ')}" failed with exit ${result.status ?? 'null'}`)
  }
}

const listFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })

const distHash = () => {
  const dist = join(repoRoot, 'dist')
  if (!existsSync(dist)) refuse('dist/ does not exist after verify')
  const hash = createHash('sha256')
  for (const file of listFiles(dist).sort()) {
    hash.update(file.slice(dist.length))
    hash.update(readFileSync(file))
  }
  return hash.digest('hex')
}

const requireCleanTree = (when) => {
  if (git('status', '--porcelain') !== '') refuse(`the working tree is dirty ${when}; commit or stash first`)
}

requireCleanTree('before verify')
const startHead = git('rev-parse', 'HEAD')

npm(['run', 'verify'])

requireCleanTree('after verify')
if (git('rev-parse', 'HEAD') !== startHead) refuse('HEAD moved during verify')
const verifiedDist = distHash()

if (dryRun) {
  npm(['version', bump, '--no-git-tag-version'])
} else {
  npm(['version', bump])
  const touched = git('diff', '--name-only', startHead, 'HEAD').split('\n').filter(Boolean)
  const unexpected = touched.filter((file) => !VERSION_FILES.has(file))
  if (unexpected.length > 0) refuse(`the version commit touched unexpected files: ${unexpected.join(', ')}`)
  requireCleanTree('after version')
}

if (distHash() !== verifiedDist) {
  restoreDryRun()
  refuse('dist/ changed after verify; run the release again')
}

npm(['publish', ...(dryRun ? ['--dry-run'] : [])])
restoreDryRun()
