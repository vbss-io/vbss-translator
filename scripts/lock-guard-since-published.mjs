import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { name } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

const argBase = (() => {
  const index = process.argv.indexOf('--base')
  return index === -1 ? null : process.argv[index + 1]
})()

const publishedTag = () => {
  const result = spawnSync(`npm view ${name} version`, { cwd: repoRoot, encoding: 'utf8', shell: true })
  const version = result.stdout.trim()
  if (result.status !== 0 || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`cannot read the published version of ${name} from the registry (exit ${result.status}): ${result.stderr}`)
  }
  return `v${version}`
}

const base = argBase ?? publishedTag()
try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: repoRoot, stdio: 'ignore' })
} catch {
  console.error(`lock-guard base ${base} does not exist in this repository; pass --base <git-ref> or fetch the tag`)
  process.exit(2)
}

const viteTemp = join(repoRoot, 'node_modules', '.vite-temp')
if (existsSync(viteTemp)) rmSync(viteTemp, { recursive: true, force: true })

console.log(`lock-guard base: ${base}`)
const result = spawnSync(
  process.execPath,
  [join(repoRoot, 'scripts', 'lock-guard.mjs'), '--base', base, '--installed', '.'],
  { cwd: repoRoot, stdio: 'inherit' }
)
process.exit(result.status ?? 2)
