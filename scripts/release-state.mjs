import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const stampPath = join(repoRoot, '.verify-stamp.json')

export const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()

const lockHash = () => createHash('sha256').update(readFileSync(join(repoRoot, 'package-lock.json'))).digest('hex')

export const currentState = () => ({
  head: git('rev-parse', 'HEAD'),
  lock: lockHash(),
  clean: git('status', '--porcelain') === '',
})

export const writeStamp = () => {
  const state = currentState()
  writeFileSync(stampPath, `${JSON.stringify(state, null, 2)}\n`)
  return state
}

export const checkStamp = () => {
  if (!existsSync(stampPath)) {
    return { ok: false, reason: 'no verify stamp found; run "npm run verify" first' }
  }
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
  const state = currentState()
  if (!stamp.clean) return { ok: false, reason: 'the last verify ran on a dirty working tree; commit and run "npm run verify" again' }
  if (!state.clean) return { ok: false, reason: 'the working tree is dirty; commit and run "npm run verify" again' }
  if (stamp.head !== state.head) return { ok: false, reason: `verify passed for ${stamp.head.slice(0, 7)} but HEAD is ${state.head.slice(0, 7)}; run "npm run verify" again` }
  if (stamp.lock !== state.lock) return { ok: false, reason: 'package-lock.json changed since the last verify; run "npm run verify" again' }
  return { ok: true, state }
}
