import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUMPS = ['patch', 'minor', 'major']
const FLAGS = ['--dry-run', '--yes-publish']
const args = process.argv.slice(2)
const bump = args.find((arg) => BUMPS.includes(arg))
const dryRun = args.includes('--dry-run') || process.env.npm_config_dry_run === 'true'
const confirmedPublish = args.includes('--yes-publish')
const VERSION_FILES = new Set(['package.json', 'package-lock.json'])

const unknownArgs = args.filter((arg) => !FLAGS.includes(arg) && !BUMPS.includes(arg))
if (!bump || args.filter((arg) => BUMPS.includes(arg)).length !== 1 || unknownArgs.length > 0) {
  console.error('usage: release.mjs <patch|minor|major> [--dry-run | --yes-publish] (flags and bump in any order)')
  process.exit(2)
}
if (!dryRun && !confirmedPublish) {
  console.error(
    'release not started: a real release needs the explicit --yes-publish argument (npm run release -- <patch|minor|major> --yes-publish); to rehearse use npm run release:dry -- <patch|minor|major>'
  )
  process.exit(2)
}

const childEnv = { ...process.env, VBSS_RELEASE: '1' }
delete childEnv.npm_config_dry_run

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' }).trim()

let versionStepStarted = false
let publishStarted = false
let startHead = ''
let tagsBefore = []

const listTags = () => git('tag', '--list').split('\n').filter(Boolean)

const restoreVersionFiles = () => {
  const files = git('diff', '--name-only')
    .split('\n')
    .filter((file) => VERSION_FILES.has(file))
  if (files.length > 0) git('checkout', '--', ...files)
}

const undoVersionStep = () => {
  if (!versionStepStarted) return ''
  if (dryRun) {
    restoreVersionFiles()
    return ''
  }
  if (publishStarted) return ' (publish had already started: the version commit and tag were kept, check the registry before anything else)'
  const notes = []
  for (const tag of listTags().filter((name) => !tagsBefore.includes(name))) {
    try {
      git('tag', '-d', tag)
      notes.push(`tag ${tag} deleted`)
    } catch {
      notes.push(`tag ${tag} could not be deleted, delete it by hand`)
    }
  }
  try {
    if (git('rev-parse', 'HEAD') !== startHead) {
      git('reset', '--keep', startHead)
      notes.push(`HEAD moved back to ${startHead.slice(0, 7)}`)
    }
    restoreVersionFiles()
  } catch {
    notes.push(`HEAD could not be moved back, run "git reset --keep ${startHead}" by hand`)
  }
  return notes.length > 0 ? ` (undone: ${notes.join(', ')})` : ''
}

const refuse = (reason) => {
  const undone = undoVersionStep()
  console.error(`release refused: ${reason}${undone}`)
  process.exit(1)
}

const npm = (npmArgs) => {
  const result = spawnSync(`npm ${npmArgs.join(' ')}`, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: childEnv,
  })
  if (result.status !== 0) refuse(`"npm ${npmArgs.join(' ')}" failed with exit ${result.status ?? 'null'}`)
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

const manifestLabel = () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  return `${manifest.name}@${manifest.version}`
}

console.log(dryRun ? 'mode: dry run (nothing will be published, the repository is restored)' : 'mode: REAL release (--yes-publish given)')

requireCleanTree('before verify')
startHead = git('rev-parse', 'HEAD')
console.log(`release plan: ${bump} bump from ${manifestLabel()}`)

npm(['run', 'verify'])

requireCleanTree('after verify')
if (git('rev-parse', 'HEAD') !== startHead) refuse('HEAD moved during verify')
const verifiedDist = distHash()

tagsBefore = listTags()
versionStepStarted = true
if (dryRun) {
  npm(['version', bump, '--no-git-tag-version'])
} else {
  npm(['version', bump])
  const touched = git('diff', '--name-only', startHead, 'HEAD').split('\n').filter(Boolean)
  const unexpected = touched.filter((file) => !VERSION_FILES.has(file))
  if (unexpected.length > 0) refuse(`the version commit touched unexpected files: ${unexpected.join(', ')}`)
  requireCleanTree('after version')
}

if (distHash() !== verifiedDist) refuse('dist/ changed after verify; run the release again')

console.log(`${dryRun ? 'would publish' : 'publishing'}: ${manifestLabel()}`)

if (!dryRun) publishStarted = true
npm(['publish', ...(dryRun ? ['--dry-run'] : [])])
restoreVersionFiles()
