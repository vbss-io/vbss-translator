import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIN_PERCENT = 80
const METRICS = ['statements', 'branches', 'functions', 'lines']

const summaryPath = process.argv[2] ?? join(repoRoot, 'coverage', 'coverage-summary.json')

let summary
try {
  summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
} catch (error) {
  console.error(`cannot read the coverage summary at ${summaryPath}: ${error.message}`)
  process.exit(2)
}

const files = Object.entries(summary).filter(([name]) => name !== 'total')
if (files.length === 0) {
  console.error(`no per-file entries in ${summaryPath}`)
  process.exit(2)
}

const failures = files.flatMap(([name, metrics]) =>
  METRICS.filter((metric) => metrics[metric].pct < MIN_PERCENT).map(
    (metric) => `${relative(repoRoot, name)} ${metric} ${metrics[metric].pct}% < ${MIN_PERCENT}%`
  )
)

if (failures.length > 0) {
  console.error(`per-file coverage below ${MIN_PERCENT}%:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`per-file coverage ok: ${files.length} files >= ${MIN_PERCENT}% on ${METRICS.join(', ')}`)
