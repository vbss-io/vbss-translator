#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, posix, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const HELP = `lock-guard - package intake gate (node >= 22, no dependencies)

Usage:
  node lock-guard.mjs [--base <git-ref>] [--root <dir>] [--installed <dir> ...] [--policy-dir <dir>] [--json]
  node lock-guard.mjs --spec <name@version> [--spec ...] [--root <dir>] [--json]

Lock mode (default): reads yarn.lock (v1), pnpm-lock.yaml (v6/v9) or package-lock.json (v2/v3)
from the working tree of --root (default: cwd) and from --base (default: origin/main) via
"git show". Every entry of the head lockfile is checked for host and tarball changes; every
name@version that is new (or changed) relative to the base is checked against the registry.
Spec mode: checks the given specs against the registry, no lockfile needed.
--installed <dir> (repeatable; run after "install --frozen-lockfile --ignore-scripts") also walks
the real installed tree: every node_modules directory at any depth under --root and each <dir>
(only .git is skipped; workspace globs are not used to find them), each package's own nested
node_modules, and the pnpm store node_modules/.pnpm/<key>/node_modules. Every real directory in a
node_modules must have a package.json and is checked: its name@version must be in the evaluated
lockfile (npm: at the same path; yarn: folder name equal to package.json name or a lockfile alias;
pnpm store: key matching package.json), and its install scripts (preinstall/install/postinstall,
or binding.gyp without one) must be allowlisted. Packages proven bundled by their parent's
bundleDependencies are only checked for scripts. A link in a node_modules must resolve to a
workspace package (a directory with package.json matching the root workspaces patterns; *, **
and nested patterns are supported) or to a package the walk checked; anything else, including a
link outside the repo or a node_modules that is itself a link, fails. Only these internals may
appear in a node_modules: .bin .cache .pnpm .vite .vitest (directories) and .modules.yaml
.yarn-integrity .yarn-state.yml .package-lock.json (files); any other dot entry or plain file
fails. No network is used for this step.
--policy-dir <dir> reads .github/age-exceptions.json and install-scripts-allow.json from <dir>
instead of --root.

The gate fails closed: anything that cannot be checked fails, except @vbss-io/* packages from
npm.pkg.github.com when LOCK_GUARD_GHPKG_TOKEN is not set (reported as WARN unverified; the
tarball URL path and presence of an integrity hash are still checked).

Rules (all FAIL):
  age             new version published less than 14 days ago (unless in .github/age-exceptions.json)
  install-script  new version has preinstall/install/postinstall/hasInstallScript/gypfile
                  (unless in .github/install-scripts-allow.json)
  host            any lockfile entry resolved outside registry.yarnpkg.com, registry.npmjs.org,
                  npm.pkg.github.com (the last one only for @vbss-io/*), or a file:/link:/git/http
                  source that is not a workspace package of this repo, or with no resolved URL
  tarball-path    new/changed entry whose resolved URL is not /<name>/-/<basename>-<version>.tgz
                  (npm.pkg.github.com: /download/<name>/<version>/<sha>)
  integrity       new/changed entry without an integrity hash, or whose sha512 (sha1 when that is
                  all there is) differs from the registry dist.integrity / dist.shasum
  tarball-swap    same name@version as the base but a different resolved URL or integrity, or a
                  hash that was dropped
  trust-downgrade the previous version had provenance or a trusted publisher and the new one not
  registry        metadata unavailable (any non-200), version missing, or invalid publish date
  layout          (pnpm) pnpm-workspace.yaml sets nodeLinker/node-linker, virtualStoreDir, modulesDir or
                  storeDir to a non-default value
  registry-config (pnpm) pnpm-workspace.yaml or pnpm-lock.yaml declares a registry other than
                  registry.npmjs.org
  lockfile        unparseable or mixed local/registry entries, parses to nothing, or empty while
                  package.json declares dependencies
  not-exact       (spec mode) the spec has no exact version
  override-range  root resolutions/overrides/pnpm.overrides added or changed with a non exact version

Strict grammar: only the canonical form each package manager writes is accepted; anything else
is a lockfile failure.
  yarn v1   comments only before the first entry; headers are ", "-joined specs quoted exactly
            when yarn would quote them; fields version, resolved, integrity (each once) and
            dependencies/optionalDependencies maps with "name range" lines; blank line ends an entry
  pnpm 9.0  first line lockfileVersion: '9.0'; top-level settings, overrides, importers, packages,
            snapshots; 2-space indentation; plain or single-quoted scalars (keys quoted only when
            they start with a YAML indicator such as @); single-line flow {}/[]; no anchors,
            aliases, tags, merge keys, comments, double quotes, block scalars or duplicate keys;
            resolution exactly {integrity: X}, {integrity: X, tarball: URL} or
            {directory: P, type: directory}
  npm v2/v3 JSON without duplicate keys; inBundle only when the owning package declares it in
            bundleDependencies (or it sits inside / is a dependency of a proven bundled package)
  all       valid UTF-8, no BOM, LF or consistent CRLF only, no control characters, no U+2028/2029/0085,
            no tabs (npm JSON may use tabs as whitespace)
Integrity tokens must match (sha512|sha384|sha256|sha1)-<base64>, one per algorithm, and every
token must equal the registry dist.integrity / dist.shasum.

Limitation: pnpm omits the tarball URL for packages from the configured registry, and .npmrc
(which may hold tokens) is never read; such entries are assumed to come from registry.npmjs.org.
A registry set in .npmrc or in the environment is not detected; integrity is still compared
with registry.npmjs.org for new entries, which catches a different tarball. Likewise
nodeLinker/node-linker, virtualStoreDir, modulesDir and storeDir are only checked in
pnpm-workspace.yaml (a non-default value there fails as "layout"); a value set in .npmrc cannot
be read.

THREAT MODEL
  In scope: packages entering through the registry. Fresh versions (age), install scripts,
  provenance or trusted-publisher downgrades, lockfile entries whose host, tarball path or
  integrity do not match the registry, and lockfile parse divergence (a lockfile the package
  manager reads differently from this tool), which the strict grammar rejects and the
  --installed reconciliation detects from what was really installed.
  Not checked here: file contents of installed packages. The installed step compares name,
  version and install scripts, not files. Content integrity is enforced by the package manager
  (frozen lockfile plus integrity verification at install) and by the lockfile step (lockfile
  integrity equal to the registry dist.integrity). A package's bundleDependencies can carry
  nested packages inside its tarball; that is accepted because the parent tarball's integrity
  is verified against the registry.
  Out of scope: an attacker with write access to the repository or to the CI workflows. Such an
  attacker can also edit or skip this gate, so branch protection and code review cover that
  case, not this tool.

.github/age-exceptions.json:
  [{ "package": "body-parser", "version": "2.4.0", "reason": "security fix", "until": "YYYY-MM-DD" }]
  until must be at most 30 days ahead; expired or invalid entries fail the run.
.github/install-scripts-allow.json:
  [{ "package": "esbuild", "version": "0.25.12", "reason": "native binary" }]   exact version required
  An entry vouches only for a non-bundled lockfile entry whose integrity was verified against the
  registry in this run, and (with --installed) only for an installed copy at a location where the
  package manager installed that registry tarball: npm, the lockfile path of a non-bundled entry;
  yarn v1, the top-level node_modules/<name> of the repo root or a workspace; pnpm, the store copy
  .pnpm/<name>@<version>.../node_modules/<name>. A bundled copy (per the lockfile or the installed
  parent manifest) with install scripts always fails ("bundled copy, allowlist does not apply").
  Another location needs an entry with "path": the exact relative install path (no globs), e.g.
  { "package": "esbuild", "version": "0.25.12", "path": "apps/web/node_modules/vite/node_modules/esbuild",
    "reason": "..." }; it still requires the registry integrity check.

Network: only GET requests to registry metadata. No credentials are sent, except
LOCK_GUARD_GHPKG_TOKEN (env, optional) as a Bearer header to npm.pkg.github.com only. With the
token set, @vbss-io/* packages are fully checked and a 401/403 fails.
Exit codes: 0 pass, 1 failures, 2 usage or runtime error.`

const MIN_AGE_DAYS = 14
const MAX_EXCEPTION_DAYS = 30
const DAY_MS = 86_400_000
const CONCURRENCY = 8
const TIMEOUT_MS = 30_000
const NPM_HOST = 'registry.npmjs.org'
const GITHUB_HOST = 'npm.pkg.github.com'
const GITHUB_SCOPE = '@vbss-io/'
const ALLOWED_HOSTS = new Set(['registry.yarnpkg.com', NPM_HOST, GITHUB_HOST])
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']
const TRUST_LABELS = ['no provenance', 'provenance', 'trusted publisher']
const MAX_PROBLEMS = 20
const LOCKFILES = [
  ['yarn', 'yarn.lock'],
  ['pnpm', 'pnpm-lock.yaml'],
  ['npm', 'package-lock.json']
]
const PLAIN_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/
const EXACT_VERSION = /^(npm:(@[^/@]+\/)?[^/@]+@)?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

class UsageError extends Error {}

const fail = (rule, pkg, detail) => ({ level: 'fail', rule, package: pkg, detail })

const splitSpec = (spec) => {
  const at = spec.indexOf('@', 1)
  return at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, '']
}

export const describeResolved = (resolved) => {
  let url
  try {
    url = new URL(resolved)
  } catch {
    return { reason: 'unparseable resolved value', shown: String(resolved).replace(/\/\/[^/]*@/, '//<userinfo redacted>@').slice(0, 120) }
  }
  const authority = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(resolved)?.[1] ?? ''
  const shown = `${url.hostname}${url.pathname}`
  if (url.protocol !== 'https:') return { reason: `non-https scheme "${url.protocol.slice(0, -1)}"`, shown }
  if (url.username || url.password || authority.includes('@')) return { reason: 'userinfo in URL (redacted)', shown }
  const port = /:(\d*)$/.exec(authority)
  if (port) return { reason: `explicit port "${port[1]}"`, shown }
  return { reason: null, shown, host: url.hostname }
}

const sourceOf = (resolved, defaultHost) => {
  if (!resolved) return defaultHost ? { source: 'registry', host: defaultHost } : { source: 'missing' }
  const described = describeResolved(resolved)
  if (described.reason === null) return { source: 'registry', host: described.host, shown: described.shown }
  return { source: 'other', reason: described.reason, shown: described.shown }
}

const isExactInstallPath = (path) => {
  if (typeof path !== 'string' || /[*?[\]{}\\\s]/.test(path) || path.startsWith('/')) return false
  const segments = path.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false
  return /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path)
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const addEntry = (entries, name, version, resolved, integrity, defaultHost, hasInstallScript = false) => {
  const key = `${name}@${version}`
  const entry = entries.get(key) ?? { name, version, occurrences: [] }
  const same = (seen) => seen.resolved === resolved && seen.integrity === integrity && seen.hasInstallScript === hasInstallScript
  if (!entry.occurrences.some(same)) {
    entry.occurrences.push({ resolved, integrity, hasInstallScript, ...sourceOf(resolved, defaultHost) })
  }
  entries.set(key, entry)
}

const emptyLock = () => ({ entries: new Map(), overrides: {}, locals: [], workspaces: [], bundled: [], paths: new Map(), aliases: new Set(), direct: new Set(), problems: [] })

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

const yarnNeedsQuotes = (value) =>
  value.startsWith('true') || value.startsWith('false') || /[:\s\\",[\]]/.test(value) || /^[0-9]/.test(value) || !/^[a-zA-Z]/.test(value)

const yarnScalar = (raw) => {
  const quoted = /^"([^"\\\u0000-\u001f]*)"$/.exec(raw)
  if (quoted) return yarnNeedsQuotes(quoted[1]) ? quoted[1] : null
  return raw && !CONTROL_CHARACTER.test(raw) && !yarnNeedsQuotes(raw) ? raw : null
}

const yarnHeaderSpecs = (line) => {
  const specs = []
  const token = /("[^"\\\u0000-\u001f]*"|[^\s",:]+)(, |:$)/y
  let match
  while ((match = token.exec(line))) {
    const spec = yarnScalar(match[1])
    if (spec === null) return null
    specs.push(spec)
    if (match[2] === ':') return token.lastIndex === line.length ? specs : null
  }
  return null
}

const YARN_FIELDS = new Set(['version', 'resolved', 'integrity'])
const YARN_MAPS = new Set(['dependencies', 'optionalDependencies'])

export const parseYarnLock = (text) => {
  if (/^__metadata:/m.test(text)) throw new UsageError('yarn berry lockfile is not supported, only yarn v1')
  const lock = emptyLock()
  const seenSpecs = new Set()
  let block = null
  let blocks = 0
  const flush = () => {
    if (!block) return
    blocks++
    const parsed = block.specs.map((spec) => {
      const local = /^(.+?)@(file|link|workspace|portal):(.*)$/.exec(spec)
      if (local) return { spec, name: local[1], path: local[3] }
      const [name, range] = splitSpec(spec.includes('@npm:') ? spec.slice(spec.indexOf('@npm:') + 5) : spec)
      if (spec.includes('@npm:')) lock.aliases.add(`${spec.slice(0, spec.indexOf('@npm:'))}>${name}`)
      return { spec, name, range, alias: spec.includes('@npm:') }
    })
    const locals = parsed.filter((item) => item.path !== undefined)
    const remote = parsed.filter((item) => item.path === undefined)
    const names = new Set(remote.map((item) => item.name))
    if (!block.fields.version || remote.some((item) => !item.range)) return lock.problems.push(`unparseable block "${block.header}"`)
    if (locals.length > 0 && remote.length > 0) lock.problems.push(`block mixes local and registry specs "${block.header}"`)
    if (names.size > 1) lock.problems.push(`block specs resolve to different packages "${block.header}"`)
    for (const item of locals) lock.locals.push({ label: item.spec, path: item.path })
    if (remote.length > 0 || block.fields.resolved) {
      addEntry(lock.entries, (remote[0] ?? locals[0]).name, block.fields.version, block.fields.resolved, block.fields.integrity)
      if (remote.some((item) => !item.alias)) lock.direct.add(`${remote[0].name}@${block.fields.version}`)
    }
  }
  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const where = `line ${index + 1}`
    if (line === '') {
      flush()
      block = null
      continue
    }
    if (line.startsWith('#')) {
      if (blocks > 0 || block) lock.problems.push(`${where}: comment after the first entry`)
      continue
    }
    if (!line.startsWith(' ')) {
      flush()
      const specs = yarnHeaderSpecs(line)
      if (!specs) {
        lock.problems.push(`${where}: non-canonical entry header "${line}"`)
        block = null
        continue
      }
      for (const spec of specs) {
        if (seenSpecs.has(spec)) lock.problems.push(`${where}: duplicate spec "${spec}"`)
        seenSpecs.add(spec)
      }
      block = { header: line.slice(0, -1), specs, fields: {}, map: null, mapKeys: null }
      continue
    }
    if (!block) {
      lock.problems.push(`${where}: line outside any entry`)
      continue
    }
    const nested = /^ {4}(\S+) (\S.*)$/.exec(line)
    if (nested && block.map) {
      const key = yarnScalar(nested[1])
      const value = yarnScalar(nested[2])
      if (key === null || value === null) lock.problems.push(`${where}: non-canonical dependency line "${line.trim()}"`)
      else if (block.mapKeys.has(key)) lock.problems.push(`${where}: duplicate dependency "${key}"`)
      else block.mapKeys.add(key)
      continue
    }
    const map = /^ {2}([A-Za-z]+):$/.exec(line)
    if (map && YARN_MAPS.has(map[1]) && !(map[1] in block.fields)) {
      block.fields[map[1]] = true
      block.map = map[1]
      block.mapKeys = new Set()
      continue
    }
    const field = /^ {2}([A-Za-z]+) (\S.*)$/.exec(line)
    const value = field && yarnScalar(field[2])
    if (field && YARN_FIELDS.has(field[1]) && !(field[1] in block.fields) && value !== null) {
      block.fields[field[1]] = value
      block.map = null
      continue
    }
    lock.problems.push(`${where}: unknown, duplicate or non-canonical field "${line.trim()}"`)
  }
  flush()
  if (blocks > 0 && lock.entries.size === 0 && lock.locals.length === 0) lock.problems.push('no entries parsed')
  return lock
}

const unquote = (value) => value.trim().replace(/^'(.*)'$|^"(.*)"$/, '$1$2')

const YAML_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/
const SSRI_TOKEN = /^(sha512|sha384|sha256|sha1)-[A-Za-z0-9+/]+={0,2}$/

const yamlPlain = (raw, flow) => {
  if (!raw || CONTROL_CHARACTER.test(raw) || raw !== raw.trim() || YAML_INDICATOR.test(raw) || /: |:$| #/.test(raw)) return null
  if (flow && /[,[\]{}]/.test(raw)) return null
  return raw
}

const yamlScalar = (raw, flow = false) => {
  const quoted = /^'((?:[^']|'')*)'$/.exec(raw)
  if (quoted) return /[\u0000-\u001f]/.test(quoted[1]) ? null : quoted[1].replace(/''/g, "'")
  return yamlPlain(raw, flow)
}

const yamlKey = (raw) => {
  const quoted = /^'([^']+)'$/.exec(raw)
  if (quoted) return YAML_INDICATOR.test(quoted[1]) ? quoted[1] : null
  return raw === '<<' ? null : yamlPlain(raw, false)
}

const yamlFlow = (raw) => {
  const map = /^\{(.*)\}$/.exec(raw)
  const sequence = /^\[(.*)\]$/.exec(raw)
  const body = (map ?? sequence)?.[1]
  if (body === undefined) return null
  if (body === '') return map ? {} : []
  const items = body.split(', ')
  if (sequence) return items.every((item) => yamlScalar(item, true) !== null) ? items.map((item) => yamlScalar(item, true)) : null
  const result = {}
  for (const item of items) {
    const pair = /^([^:]+): (.+)$/.exec(item)
    const key = pair && yamlScalar(pair[1], true)
    const value = pair && yamlScalar(pair[2], true)
    if (key === null || value === null || !pair || key in result) return null
    result[key] = value
  }
  return result
}

const PNPM_SECTIONS = new Set(['settings', 'overrides', 'importers', 'packages', 'snapshots'])
const PNPM_PACKAGE_FIELDS = new Set(['resolution', 'engines', 'hasBin', 'os', 'cpu', 'libc', 'deprecated', 'peerDependencies', 'peerDependenciesMeta', 'bundledDependencies', 'version'])
const PNPM_SEQUENCES = new Set(['transitivePeerDependencies', 'bundledDependencies', 'os', 'cpu', 'libc'])
const PNPM_SNAPSHOT_FIELDS = new Set(['dependencies', 'optionalDependencies', 'transitivePeerDependencies', 'optional'])
const PNPM_RESOLUTIONS = [
  [/^\{integrity: (\S+)\}$/, ([integrity]) => ({ integrity })],
  [/^\{integrity: (\S+), tarball: (https:\/\/[^\s,{}'"]+)\}$/, ([integrity, resolved]) => ({ integrity, resolved })],
  [/^\{directory: ([^\s,{}'"]+), type: directory\}$/, ([directory]) => ({ directory })]
]

export const parsePnpmResolution = (raw) => {
  for (const [pattern, build] of PNPM_RESOLUTIONS) {
    const match = pattern.exec(raw)
    if (!match) continue
    const resolution = build(match.slice(1))
    if (resolution.integrity !== undefined && !SSRI_TOKEN.test(resolution.integrity)) return null
    return resolution
  }
  return null
}

export const parsePnpmLock = (text) => {
  const lines = text.split(/\r?\n/)
  if (lines[0] !== "lockfileVersion: '9.0'") throw new UsageError(`unsupported pnpm lockfile, only lockfileVersion '9.0' is accepted (found "${lines[0]}")`)
  const lock = emptyLock()
  const seenSections = new Set()
  const keysByDepth = []
  const parentKeys = []
  let section = null
  let parentOpen = false
  let previousIndent = 0
  let current = null
  let importer = null
  let packageLines = 0
  const problem = (index, message) => lock.problems.push(`line ${index + 1}: ${message}`)
  const flush = () => {
    if (!current) return
    const { key, fields, index } = current
    current = null
    const [name, keyVersion] = splitSpec(key)
    const isUrl = /^https:\/\//.test(keyVersion)
    if (!fields.resolution) return problem(index, `package "${key}" has no canonical resolution`)
    if (fields.resolution.directory !== undefined) {
      if (!/^file:/.test(keyVersion)) return problem(index, `directory resolution on non-file key "${key}"`)
      return lock.locals.push({ label: key, path: fields.resolution.directory })
    }
    const version = isUrl ? fields.version : keyVersion
    if (!PLAIN_VERSION.test(version ?? '') || (!isUrl && fields.version !== undefined) || (isUrl && fields.resolution.resolved !== keyVersion)) {
      return problem(index, `package key "${key}" is not name@version (or a tarball URL with a matching version field)`)
    }
    addEntry(lock.entries, name, version, fields.resolution.resolved, fields.resolution.integrity, NPM_HOST)
  }
  for (const [index, line] of lines.entries()) {
    if (index === 0 || line === '') continue
    if (/\t|\s$/.test(line)) {
      problem(index, 'tab or trailing whitespace')
      continue
    }
    const indent = line.length - line.trimStart().length
    const body = line.slice(indent)
    if (indent === 0) {
      flush()
      const top = /^([A-Za-z]+):$/.exec(line)
      section = top?.[1] ?? null
      if (!section || !PNPM_SECTIONS.has(section) || seenSections.has(section)) problem(index, `unknown or duplicate top-level line "${line}"`)
      seenSections.add(section)
      keysByDepth.length = 0
      parentOpen = true
      previousIndent = 0
      continue
    }
    if (indent % 2 !== 0 || indent > previousIndent + 2 || (indent > previousIndent && !parentOpen)) {
      problem(index, 'unexpected indentation')
      continue
    }
    previousIndent = indent
    const depth = indent / 2
    keysByDepth.length = depth + 1
    const item = /^- (.+)$/.exec(body)
    if (item) {
      parentOpen = false
      if (yamlScalar(item[1]) === null || !PNPM_SEQUENCES.has(parentKeys[depth - 1])) problem(index, `non-canonical sequence item "${body}"`)
      continue
    }
    const pair = /^('[^']+'|[^'\s][^']*?):(?: (.+))?$/.exec(body)
    const key = pair && yamlKey(pair[1])
    if (!pair || key === null) {
      problem(index, `non-canonical key "${body}"`)
      continue
    }
    parentKeys[depth] = key
    keysByDepth[depth] ??= new Set()
    if (keysByDepth[depth].has(key)) problem(index, `duplicate key "${key}"`)
    keysByDepth[depth].add(key)
    const raw = pair[2]
    parentOpen = raw === undefined
    const flow = raw !== undefined && /^[{[]/.test(raw)
    const value = raw === undefined ? undefined : flow ? yamlFlow(raw) : yamlScalar(raw)
    if (raw !== undefined && value === null && !(section === 'packages' && depth === 2 && key === 'resolution')) {
      problem(index, `non-canonical value "${body}"`)
      continue
    }
    if (section === 'overrides' && depth === 1) lock.overrides[key] = value
    if (section === 'importers' && depth === 1) {
      importer = key
      lock.workspaces.push(key)
    }
    if (section === 'importers' && depth === 4 && key === 'version' && /^link:/.test(value)) {
      lock.locals.push({ label: `${importer} -> ${value}`, path: posix.join(importer, value.slice(5)) })
    }
    if (section === 'packages') {
      packageLines++
      if (depth === 1) {
        flush()
        if (raw !== undefined) problem(index, `package "${key}" must be a block mapping`)
        current = { key, fields: {}, index }
      } else if (depth === 2 && current) {
        if (!PNPM_PACKAGE_FIELDS.has(key)) problem(index, `unknown package field "${key}"`)
        if (key === 'resolution') {
          const resolution = parsePnpmResolution(raw ?? '')
          if (!resolution) problem(index, `non-canonical resolution "${raw}"`)
          else current.fields.resolution = resolution
        } else current.fields[key] = value
      }
    }
    if (section === 'snapshots' && depth === 2 && !PNPM_SNAPSHOT_FIELDS.has(key)) problem(index, `unknown snapshot field "${key}"`)
  }
  flush()
  if (packageLines > 0 && lock.entries.size === 0 && lock.locals.length === 0) lock.problems.push('no entries parsed')
  return lock
}

const findDuplicateJsonKeys = (text) => {
  const duplicates = []
  const stack = []
  let expectKey = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      let end = i + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      const top = stack.at(-1)
      if (top?.type === 'object' && expectKey) {
        const key = JSON.parse(text.slice(i, end + 1))
        if (top.keys.has(key)) duplicates.push(key)
        top.keys.add(key)
        expectKey = false
      }
      i = end
    } else if (char === '{') {
      stack.push({ type: 'object', keys: new Set() })
      expectKey = true
    } else if (char === '[') {
      stack.push({ type: 'array' })
    } else if (char === '}' || char === ']') {
      stack.pop()
    } else if (char === ',') {
      expectKey = stack.at(-1)?.type === 'object'
    }
  }
  return duplicates
}

const folderOf = (path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
const ownerOf = (path) => {
  const at = path.lastIndexOf('/node_modules/')
  return at < 0 ? '' : path.slice(0, at)
}
const declaresDependency = (entry, name) =>
  Object.hasOwn(entry?.dependencies ?? {}, name) || Object.hasOwn(entry?.optionalDependencies ?? {}, name)

export const provenBundled = (packages) => {
  const candidates = Object.entries(packages).filter(([path, entry]) => path.includes('node_modules/') && entry?.inBundle)
  const proven = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const [path] of candidates) {
      if (proven.has(path)) continue
      const owner = ownerOf(path)
      const ownerEntry = owner ? packages[owner] : undefined
      if (!ownerEntry) continue
      const folder = folderOf(path)
      const list = ownerEntry.bundleDependencies ?? ownerEntry.bundledDependencies
      const declared = list === true ? declaresDependency(ownerEntry, folder) : Array.isArray(list) && list.includes(folder)
      const insideBundle = proven.has(owner)
      const viaSibling = [...proven].some((other) => ownerOf(other) === owner && declaresDependency(packages[other], folder))
      if (declared || insideBundle || viaSibling) {
        proven.add(path)
        grew = true
      }
    }
  }
  return proven
}

export const parseNpmLock = (text) => {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ...emptyLock(), problems: [`invalid JSON: ${error.message}`] }
  }
  if (!parsed?.packages) throw new UsageError('package-lock.json without "packages" (lockfileVersion 1) is not supported')
  const lock = emptyLock()
  for (const key of findDuplicateJsonKeys(text).slice(0, MAX_PROBLEMS)) lock.problems.push(`duplicate JSON key "${key}"`)
  if (parsed.dependencies !== undefined) lock.problems.push(...legacyDependencyProblems(parsed.packages, parsed.dependencies).slice(0, MAX_PROBLEMS))
  const rootWorkspaces = parsed.packages['']?.workspaces
  lock.workspaces = Array.isArray(rootWorkspaces) ? rootWorkspaces : (rootWorkspaces?.packages ?? [])
  const bundled = provenBundled(parsed.packages)
  let candidates = 0
  for (const [path, entry] of Object.entries(parsed.packages)) {
    if (!path.includes('node_modules/')) continue
    candidates++
    const name = entry?.name ?? folderOf(path)
    lock.paths.set(path, { name, version: entry?.version, link: entry?.link === true, inBundle: entry?.inBundle === true })
    if (entry?.inBundle && bundled.has(path)) {
      lock.bundled.push({ name, version: entry.version, hasInstallScript: entry.hasInstallScript === true })
      continue
    }
    if (entry?.inBundle) lock.problems.push(`"${path}" is marked inBundle but no owning package declares it in bundleDependencies`)
    if (entry?.link) {
      lock.locals.push({ label: path, path: String(entry.resolved ?? '') })
      continue
    }
    if (!entry?.version) {
      lock.problems.push(`unparseable entry "${path}"`)
      continue
    }
    addEntry(lock.entries, name, entry.version, entry.resolved, entry.integrity, undefined, entry.hasInstallScript === true)
  }
  if (candidates > 0 && lock.entries.size === 0 && lock.locals.length === 0 && lock.bundled.length === 0) lock.problems.push('no entries parsed')
  return lock
}

const parseLock = (kind, text) => (kind === 'yarn' ? parseYarnLock(text) : kind === 'pnpm' ? parsePnpmLock(text) : parseNpmLock(text))

const globToRegExp = (glob) =>
  new RegExp(`^${normalizePath(glob).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`)

const normalizePath = (path) => posix.normalize(String(path).replace(/\\/g, '/')).replace(/^\.\/|\/$/g, '') || '.'

export const isWorkspacePath = (path, workspaces) => {
  const normalized = normalizePath(path)
  if (normalized.startsWith('..') || posix.isAbsolute(normalized) || /\.(tgz|tar\.gz)$/.test(normalized)) return false
  return workspaces.some((glob) => globToRegExp(glob).test(normalized))
}

const safeSource = (resolved) => {
  try {
    const url = new URL(resolved)
    url.username = ''
    url.password = ''
    url.search = ''
    return url.href
  } catch {
    return String(resolved).slice(0, 120)
  }
}

export const hostProblem = (name, occurrence) => {
  if (occurrence.source === 'missing') return 'no resolved URL in lockfile'
  if (occurrence.source === 'other') return `${occurrence.reason}: ${occurrence.shown}`
  if (occurrence.source !== 'registry' || !ALLOWED_HOSTS.has(occurrence.host)) return `resolved from ${occurrence.shown ?? occurrence.host}`
  if (occurrence.host === GITHUB_HOST && !name.startsWith(GITHUB_SCOPE)) return `only ${GITHUB_SCOPE}* may resolve from ${GITHUB_HOST}`
  return null
}

const normalizeResolved = (resolved) => {
  try {
    const url = new URL(resolved)
    url.hash = ''
    url.username = ''
    url.password = ''
    if (url.hostname === 'registry.yarnpkg.com') url.hostname = NPM_HOST
    return url.href
  } catch {
    return resolved
  }
}

export const hashesOf = ({ resolved, integrity, shasum }) => {
  const hashes = new Map()
  const errors = []
  const tokens = String(integrity ?? '').trim().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (!SSRI_TOKEN.test(token)) {
      errors.push(`invalid integrity token "${token.slice(0, 40)}"`)
      continue
    }
    const algorithm = token.slice(0, token.indexOf('-'))
    const value = token.slice(algorithm.length + 1)
    if (hashes.has(algorithm)) errors.push(`more than one ${algorithm} token`)
    hashes.set(algorithm, algorithm === 'sha1' ? Buffer.from(value, 'base64').toString('hex') : value)
  }
  for (const extra of [/#([0-9a-fA-F]{40})$/.exec(resolved ?? '')?.[1], /^[0-9a-fA-F]{40}$/.test(shasum ?? '') ? shasum : undefined]) {
    if (!extra) continue
    if (hashes.has('sha1') && hashes.get('sha1') !== extra.toLowerCase()) errors.push('sha1 hashes disagree')
    hashes.set('sha1', extra.toLowerCase())
  }
  return { hashes, errors }
}

const hashesAgree = (a, b) => {
  let common = 0
  for (const [algorithm, hash] of a.hashes) {
    if (!b.hashes.has(algorithm)) continue
    if (b.hashes.get(algorithm) !== hash) return false
    common++
  }
  return common > 0
}

export const sameArtifact = (head, base) => {
  if (head.resolved && base.resolved && normalizeResolved(head.resolved) !== normalizeResolved(base.resolved)) return false
  const now = hashesOf(head)
  const before = hashesOf(base)
  if (now.errors.length > 0) return false
  if (before.hashes.has('sha512') && !now.hashes.has('sha512')) return false
  return before.hashes.size === 0 || hashesAgree(before, now)
}

export const tarballPathProblem = (name, version, occurrence) => {
  if (!occurrence.resolved) return null
  let url
  let path
  try {
    url = new URL(occurrence.resolved)
    path = decodeURIComponent(url.pathname)
  } catch {
    return 'resolved URL cannot be parsed'
  }
  if (url.search || url.username || url.password) return 'resolved URL carries a query or credentials'
  if (url.hostname === GITHUB_HOST) {
    const prefix = `/download/${name}/${version}/`
    return path.startsWith(prefix) && /^[0-9a-f]+$/.test(path.slice(prefix.length)) ? null : `resolved path ${path} is not ${prefix}<sha>`
  }
  const canonical = `/${name}/-/${name.split('/').pop()}-${version}.tgz`
  return path === canonical ? null : `resolved path ${path} is not ${canonical}`
}

export const integrityProblem = (occurrence, registryVersion) => {
  const lock = hashesOf(occurrence)
  if (lock.hashes.size === 0 || lock.errors.length > 0) return null
  const registry = hashesOf({ integrity: registryVersion.integrity, shasum: registryVersion.shasum })
  for (const [algorithm, hash] of lock.hashes) {
    if (!registry.hashes.has(algorithm)) return `${algorithm} in lockfile cannot be confirmed by the registry dist`
    if (registry.hashes.get(algorithm) !== hash) return `${algorithm} in lockfile differs from registry dist`
  }
  return null
}

const lockHashProblem = (occurrence) => (hashesOf(occurrence).hashes.size === 0 ? 'no integrity hash in lockfile' : null)

const validTimestamp = (value) => {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z$/.exec(value)
  if (!match) return Number.NaN
  const ms = Date.parse(value)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 19) === match[1] ? ms : Number.NaN
}

const flattenOverrides = (value, prefix, out) => {
  for (const [key, child] of Object.entries(value ?? {})) {
    const path = key === '.' ? prefix : prefix ? `${prefix} > ${key}` : key
    if (child && typeof child === 'object') flattenOverrides(child, path, out)
    else out[path] = String(child)
  }
  return out
}

export const collectOverrides = (pkg, lockOverrides = {}) => {
  const out = new Map()
  for (const [key, value] of Object.entries(pkg?.resolutions ?? {})) out.set(`resolutions: ${key}`, String(value))
  const overrides = { ...lockOverrides, ...flattenOverrides(pkg?.overrides, '', {}), ...pkg?.pnpm?.overrides }
  for (const [key, value] of Object.entries(overrides)) out.set(`overrides: ${key}`, String(value))
  return out
}

export const checkOverrides = (head, base) => {
  const findings = []
  for (const [key, value] of head) {
    if (base.get(key) === value || value === '-' || EXACT_VERSION.test(value)) continue
    findings.push(fail('override-range', key, `"${value}" is not an exact version`))
  }
  return findings
}

const parseSemver = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?/.exec(version ?? '')
  return match ? { nums: match.slice(1, 4).map(Number), pre: match[4] } : null
}

export const compareSemver = (a, b) => {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return String(a).localeCompare(String(b))
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i]
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, undefined, { numeric: true })
}

const previousOf = (version, candidates) => {
  const sorted = [...candidates].filter((candidate) => candidate !== version).sort(compareSemver)
  return sorted.filter((candidate) => compareSemver(candidate, version) < 0).at(-1) ?? sorted.at(-1)
}

const reduceDoc = (doc) => ({
  time: doc.time && typeof doc.time === 'object' ? doc.time : {},
  versions: Object.fromEntries(
    Object.entries(doc.versions ?? {}).map(([version, manifest]) => [
      version,
      {
        installScripts: [
          ...INSTALL_HOOKS.filter((hook) => manifest?.scripts?.[hook]),
          ...(manifest?.hasInstallScript ? ['hasInstallScript'] : []),
          ...(manifest?.gypfile ? ['gypfile'] : [])
        ],
        trust: manifest?._npmUser?.trustedPublisher ? 2 : manifest?.dist?.attestations ? 1 : 0,
        integrity: manifest?.dist?.integrity,
        shasum: manifest?.dist?.shasum
      }
    ])
  )
})

export const createRegistry = (fetchImpl = globalThis.fetch, { githubToken } = {}) => {
  const cache = new Map()
  const queue = []
  let active = 0
  const pump = () => {
    while (active < CONCURRENCY && queue.length > 0) {
      const { task, done } = queue.shift()
      active++
      task().then(done).finally(() => {
        active--
        pump()
      })
    }
  }
  const request = async (url, headers) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (response.status === 200) {
          const doc = await response.json()
          if (!doc || typeof doc !== 'object') return { status: 'error', detail: 'metadata is not a JSON object' }
          return { status: 'ok', doc: reduceDoc(doc) }
        }
        if (response.status === 404) return { status: 'missing' }
        if (response.status === 401 || response.status === 403) return { status: 'auth', detail: `HTTP ${response.status}` }
        if (attempt >= 2 || response.status < 500) return { status: 'error', detail: `HTTP ${response.status}` }
      } catch (error) {
        if (attempt >= 2) return { status: 'error', detail: error.name === 'SyntaxError' ? 'invalid JSON metadata' : error.message }
      }
    }
  }
  const lookup = (host, name) => {
    const github = host === GITHUB_HOST
    const url = `${github ? `https://${GITHUB_HOST}` : `https://${NPM_HOST}`}/${name.replace('/', '%2f')}`
    const headers = github && githubToken ? { accept: 'application/json', authorization: `Bearer ${githubToken}` } : { accept: 'application/json' }
    if (!cache.has(url)) {
      cache.set(url, new Promise((done) => queue.push({ task: () => request(url, headers), done })))
      pump()
    }
    return cache.get(url)
  }
  lookup.githubAuthenticated = Boolean(githubToken)
  lookup.requests = () => cache.size
  return lookup
}

const isRealDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const readJsonFile = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback)

const readPolicyList = (root, file, findings) => {
  const value = readJsonFile(join(root, '.github', file), [])
  if (Array.isArray(value)) return value
  findings.push(fail('exception-invalid', file, 'must be a JSON array'))
  return []
}

export const loadPolicy = (root, now) => {
  const findings = []
  const today = now.toISOString().slice(0, 10)
  const horizon = new Date(now.getTime() + MAX_EXCEPTION_DAYS * DAY_MS).toISOString().slice(0, 10)
  const ageExceptions = []
  for (const entry of readPolicyList(root, 'age-exceptions.json', findings)) {
    const label = `${entry?.package}@${entry?.version}`
    if (!entry?.package || !PLAIN_VERSION.test(entry.version ?? '') || !entry.reason || !isRealDate(entry.until)) {
      findings.push(fail('exception-invalid', label, `needs package, exact version, reason, until: ${JSON.stringify(entry)}`))
    } else if (entry.until < today) {
      findings.push(fail('exception-expired', label, `age exception expired on ${entry.until}`))
    } else if (entry.until > horizon) {
      findings.push(fail('exception-too-long', label, `until ${entry.until} is more than ${MAX_EXCEPTION_DAYS} days ahead (max ${horizon})`))
    } else {
      ageExceptions.push(entry)
    }
  }
  const installAllow = []
  for (const entry of readPolicyList(root, 'install-scripts-allow.json', findings)) {
    if (!entry?.package || !PLAIN_VERSION.test(entry.version ?? '') || !entry.reason || (entry.path !== undefined && !isExactInstallPath(entry.path))) {
      findings.push(fail('exception-invalid', `${entry?.package}@${entry?.version}`, `install-scripts-allow needs package, exact version, reason and optionally an exact relative install path: ${JSON.stringify(entry)}`))
    } else {
      installAllow.push(entry)
    }
  }
  return { ageExceptions, installAllow, findings }
}

const verifiedAgainst = (occurrence, meta) => {
  const { hashes, errors } = hashesOf(occurrence)
  return hashes.size > 0 && errors.length === 0 && !integrityProblem(occurrence, meta)
}

export const evaluate = async ({ name, version, host, previous, occurrences = [], identityOnly = false, registryOnly = false }, { lookup, policy, now }) => {
  const label = `${name}@${version}`
  const problem = hostProblem(name, { source: 'registry', host })
  if (problem) return [fail('host', label, problem)]
  const result = await lookup(host, name)
  if (result.status === 'auth' && host === GITHUB_HOST && !lookup.githubAuthenticated) {
    return [{ level: 'warn', rule: 'unverified', package: label, detail: `${host} requires auth (set LOCK_GUARD_GHPKG_TOKEN); integrity, age, scripts and provenance not checked` }]
  }
  if (result.status !== 'ok') return [fail('registry', label, result.status === 'missing' ? `not found on ${host}` : `${host}: ${result.detail}`)]
  const meta = result.doc.versions[version]
  if (!meta) return [fail('registry', label, `version not in ${host} metadata`)]
  const findings = []
  for (const occurrence of occurrences) {
    const mismatch = integrityProblem(occurrence, meta)
    if (mismatch) findings.push(fail('integrity', label, mismatch))
  }
  if (identityOnly) return findings
  const published = result.doc.time[version]
  const publishedMs = validTimestamp(published)
  if (Number.isNaN(publishedMs)) return [...findings, fail('registry', label, `missing or invalid publish date ${JSON.stringify(published ?? null)}`)]
  const ageDays = (now.getTime() - publishedMs) / DAY_MS
  if (ageDays < MIN_AGE_DAYS) {
    const exception = policy.ageExceptions.find((entry) => entry.package === name && entry.version === version)
    findings.push(
      exception
        ? { level: 'allowed', rule: 'age', package: label, detail: `${ageDays.toFixed(1)} days old, exception until ${exception.until}: ${exception.reason}` }
        : fail('age', label, `published ${published.slice(0, 10)}, ${ageDays.toFixed(1)} days old (< ${MIN_AGE_DAYS})`)
    )
  }
  const lockClaimsScript = occurrences.some((occurrence) => occurrence.hasInstallScript)
  if (lockClaimsScript && meta.installScripts.length === 0) {
    findings.push(fail('install-script', label, 'lockfile says hasInstallScript but the registry shows no install script'))
  } else if (meta.installScripts.length > 0) {
    const allowed = policy.installAllow.find((entry) => entry.package === name && entry.version === version)
    const verified = registryOnly || (occurrences.length > 0 && occurrences.every((occurrence) => verifiedAgainst(occurrence, meta)))
    findings.push(
      allowed && verified
        ? { level: 'allowed', rule: 'install-script', package: label, detail: `${meta.installScripts.join(', ')} allowed: ${allowed.reason}` }
        : fail('install-script', label, `${meta.installScripts.join(', ')}${allowed ? ' (allowlisted, but the lockfile integrity was not verified against the registry)' : ''}`)
    )
  }
  const before = previous && result.doc.versions[previous]
  if (before && before.trust > meta.trust) {
    findings.push(fail('trust-downgrade', label, `${previous} had ${TRUST_LABELS[before.trust]}, ${version} has ${TRUST_LABELS[meta.trust]}`))
  }
  return findings
}

const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const gitShow = (root, ref, file) => {
  try {
    return git(root, ['show', `${ref}:./${file}`])
  } catch {
    return null
  }
}

const workspaceGlobs = (pkg) => {
  const workspaces = pkg?.workspaces
  return Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])
}

const lockFindings = (head, base) => {
  const findings = head.problems.slice(0, MAX_PROBLEMS).map((problem) => fail('lockfile', 'lockfile', problem))
  if (head.problems.length > MAX_PROBLEMS) findings.push(fail('lockfile', 'lockfile', `${head.problems.length - MAX_PROBLEMS} more unparseable entries`))
  for (const local of head.locals) {
    if (!isWorkspacePath(local.path, head.workspaces)) findings.push(fail('host', local.label, `local source "${local.path}" is not a workspace package of this repo`))
  }
  const changed = []
  for (const [key, entry] of head.entries) {
    const before = base.entries.get(key)
    const touched = []
    const parsedHashes = entry.occurrences.map((occurrence) => hashesOf(occurrence))
    for (const [index, hashes] of parsedHashes.entries()) {
      for (const error of hashes.errors) findings.push(fail('integrity', key, error))
      const other = parsedHashes.slice(index + 1).find((next) => next.hashes.size > 0 && hashes.hashes.size > 0 && !hashesAgree(hashes, next))
      if (other) findings.push(fail('integrity', key, 'occurrences of the same version carry different integrity'))
    }
    for (const occurrence of entry.occurrences) {
      const problem = hostProblem(entry.name, occurrence)
      if (problem) findings.push(fail('host', key, problem))
      const swapped = before && !before.occurrences.some((previous) => sameArtifact(occurrence, previous))
      if (swapped) findings.push(fail('tarball-swap', key, `resolved/integrity differs from or was dropped since base (${safeSource(occurrence.resolved ?? 'default registry')})`))
      if (before && !swapped) continue
      const pathProblem = problem ? null : tarballPathProblem(entry.name, entry.version, occurrence)
      if (pathProblem) findings.push(fail('tarball-path', key, pathProblem))
      const hashProblem = problem ? null : lockHashProblem(occurrence)
      if (hashProblem) findings.push(fail('integrity', key, hashProblem))
      if (!problem) touched.push(occurrence)
    }
    if (before && touched.length > 0) changed.push({ entry, occurrences: touched })
  }
  return { findings, changed }
}

export const declaresDependencies = (root, rootPkg, globs) => {
  const manifests = [rootPkg, ...findWorkspaceDirs(root, globs).map((dir) => readJsonFile(join(root, dir, 'package.json'), null)).filter(Boolean)]
  const internal = new Set(manifests.map((pkg) => pkg?.name).filter(Boolean))
  return manifests.some((pkg) =>
    ['dependencies', 'devDependencies', 'optionalDependencies'].some((field) =>
      Object.entries(pkg?.[field] ?? {}).some(([dep, spec]) => !internal.has(dep) && !/^(workspace|link|file):/.test(String(spec)))
    )
  )
}

const pnpmWorkspaceGlobs = (text) => {
  const globs = []
  let inPackages = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = /^packages:\s*$/.test(line)
    const item = inPackages && /^\s+-\s*(.+)$/.exec(line)
    if (item) globs.push(unquote(item[1]))
  }
  return globs
}

export const registryConfigProblems = (sources) => {
  const findings = []
  for (const [label, text] of sources) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^ {0,2}['"]?(@[^'":\s]+:)?registr(?:y|ies)['"]?\s*:\s*(.*)$/.exec(line)
      if (match && !/^https:\/\/registry\.npmjs\.org\/?$/.test(unquote(match[2]))) {
        findings.push(fail('registry-config', label, `declares "${line.trim()}"; pnpm entries without a tarball URL would resolve there`))
      }
    }
  }
  return findings
}

export const decodeLockfile = (buffer, kind) => {
  const problems = []
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) problems.push('byte order mark')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    return { text: '', problems: [...problems, 'invalid UTF-8'] }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/.test(text)) problems.push('control character or Unicode line separator')
  if (kind !== 'npm' && text.includes('\t')) problems.push('tab character')
  const crlf = text.includes('\r\n')
  if (crlf ? /\r(?!\n)|(?<!\r)\n/.test(text) : text.includes('\r')) problems.push(crlf ? 'mixed line endings' : 'bare carriage return')
  return { text, problems }
}

const INSTALL_SCRIPT_HOOKS = ['preinstall', 'install', 'postinstall']

const NODE_MODULES_INTERNAL_DIRS = new Map([
  ['.bin', 'executable shims written by every package manager'],
  ['.cache', 'tool caches (babel, eslint, terser) that write under node_modules'],
  ['.pnpm', 'pnpm virtual store, walked below'],
  ['.vite', 'Vite dependency pre-bundling cache'],
  ['.vitest', 'Vitest results cache']
])
const NODE_MODULES_INTERNAL_FILES = new Map([
  ['.modules.yaml', 'pnpm install state'],
  ['.yarn-integrity', 'yarn v1 install state'],
  ['.yarn-state.yml', 'yarn node-modules linker state'],
  ['.package-lock.json', 'npm hidden lockfile']
])

const readManifest = (dir) => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

const readDirents = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const normalizeInstalledVersion = (version) => {
  if (typeof version !== 'string') return null
  const cleaned = version.trim().replace(/^[v=]/, '')
  return STRICT_SEMVER.test(cleaned) ? cleaned : null
}

const installScriptsOf = (dir, manifest) => {
  const hooks = INSTALL_SCRIPT_HOOKS.filter((hook) => manifest?.scripts?.[hook])
  if (!manifest?.scripts?.install && !manifest?.scripts?.preinstall && existsSync(join(dir, 'binding.gyp'))) hooks.push('binding.gyp (implicit node-gyp rebuild)')
  return hooks
}

const toPosix = (path) => path.split(/[\\/]+/).join('/')

const walkRepoTree = (root, onDirectory) => {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const dirent of readDirents(dir)) {
      const full = join(dir, dirent.name)
      if (dirent.name === 'node_modules' && dirent.isSymbolicLink()) onDirectory(full, 'link')
      if (dirent.name === '.git' || !dirent.isDirectory() || dirent.isSymbolicLink()) continue
      if (dirent.name === 'node_modules') onDirectory(full, true)
      else {
        onDirectory(full, false)
        stack.push(full)
      }
    }
  }
}

export const findWorkspaceDirs = (root, globs) => {
  const patterns = globs.map(globToRegExp)
  const dirs = []
  if (patterns.some((pattern) => pattern.test('.'))) dirs.push('.')
  walkRepoTree(root, (dir, isNodeModules) => {
    if (isNodeModules) return
    const rel = toPosix(relative(root, dir))
    if (patterns.some((pattern) => pattern.test(rel)) && existsSync(join(dir, 'package.json'))) dirs.push(rel)
  })
  return dirs.sort()
}

const bundledNames = (owner, children) => {
  if (!owner) return new Set()
  if (owner.bundled) return new Set(children.keys())
  const list = owner.manifest?.bundleDependencies ?? owner.manifest?.bundledDependencies
  const bundled = new Set(list === true ? Object.keys(owner.manifest?.dependencies ?? {}) : Array.isArray(list) ? list : [])
  let grew = true
  while (grew) {
    grew = false
    for (const name of [...bundled]) {
      const child = children.get(name)
      for (const dependency of Object.keys({ ...child?.manifest?.dependencies, ...child?.manifest?.optionalDependencies })) {
        if (children.has(dependency) && !bundled.has(dependency)) {
          bundled.add(dependency)
          grew = true
        }
      }
    }
  }
  return new Set([...bundled].filter((name) => children.has(name)))
}

export const walkInstalled = (root, extraRoots, workspaceDirs, storeRoots = new Set()) => {
  const findings = []
  const packages = []
  const links = []
  const visited = new Set()
  const queue = []
  for (const start of [root, ...extraRoots]) {
    walkRepoTree(start, (dir, isNodeModules) => {
      if (isNodeModules === 'link') findings.push(fail('installed', toPosix(relative(root, dir)), 'node_modules is a link'))
      else if (isNodeModules) queue.push({ nodeModules: dir, owner: null })
    })
  }
  const linkOf = (path) => links.push({ path, rel: toPosix(relative(root, path)) })
  const processNodeModules = ({ nodeModules, owner }) => {
    if (lstatSync(nodeModules).isSymbolicLink()) return findings.push(fail('installed', toPosix(relative(root, nodeModules)), 'node_modules is a link'))
    const children = new Map()
    const entries = []
    for (const dirent of readDirents(nodeModules)) {
      const full = join(nodeModules, dirent.name)
      const rel = toPosix(relative(root, full))
      if (dirent.isSymbolicLink()) {
        linkOf(full)
        continue
      }
      if (dirent.name.startsWith('.')) {
        if (dirent.isDirectory() && NODE_MODULES_INTERNAL_DIRS.has(dirent.name)) {
          if (dirent.name === '.pnpm' && storeRoots.has(nodeModules)) processStore(full)
          else if (dirent.name === '.pnpm') findings.push(fail('installed', rel, 'unexpected dot entry in node_modules: .pnpm is a store only at the root node_modules of the repo or a workspace'))
        } else if (!(dirent.isFile() && NODE_MODULES_INTERNAL_FILES.has(dirent.name))) {
          findings.push(fail('installed', rel, 'unexpected dot entry in node_modules'))
        }
        continue
      }
      if (!dirent.isDirectory()) {
        findings.push(fail('installed', rel, 'plain file at the top of node_modules'))
        continue
      }
      if (dirent.name.startsWith('@')) {
        for (const scoped of readDirents(full)) {
          const scopedFull = join(full, scoped.name)
          if (scoped.isSymbolicLink()) linkOf(scopedFull)
          else if (scoped.isDirectory()) entries.push({ dir: scopedFull, folder: `${dirent.name}/${scoped.name}` })
          else findings.push(fail('installed', toPosix(relative(root, scopedFull)), 'plain file inside a scope directory'))
        }
      } else {
        entries.push({ dir: full, folder: dirent.name })
      }
    }
    for (const entry of entries) {
      const rel = toPosix(relative(root, entry.dir))
      const manifest = readManifest(entry.dir)
      if (!manifest) {
        findings.push(fail('installed', rel, 'directory in node_modules without a readable package.json'))
        continue
      }
      children.set(entry.folder, { ...entry, rel, manifest })
    }
    const bundled = bundledNames(owner, children)
    for (const [folder, child] of children) {
      const isBundled = bundled.has(folder)
      visited.add(child.dir)
      const storeKey = /(?:^|\/)node_modules\/\.pnpm\/([^/]+)\/node_modules\/(?:@[^/]+\/)?[^/]+$/.exec(child.rel)?.[1]
      packages.push({ ...child, bundled: isBundled, storeKey })
      queue.push({ nodeModules: join(child.dir, 'node_modules'), owner: { manifest: child.manifest, bundled: isBundled }, nested: true })
    }
  }
  const processStore = (store) => {
    for (const dirent of readDirents(store)) {
      const full = join(store, dirent.name)
      const rel = toPosix(relative(root, full))
      if (dirent.name === 'lock.yaml' && dirent.isFile()) continue
      if (dirent.name === 'node_modules' && dirent.isDirectory() && !dirent.isSymbolicLink()) {
        queue.push({ nodeModules: full, owner: null })
        continue
      }
      if (!dirent.isDirectory() || dirent.isSymbolicLink()) {
        findings.push(fail('installed', rel, 'unexpected entry in the pnpm virtual store'))
        continue
      }
      for (const inner of readDirents(full)) {
        const innerFull = join(full, inner.name)
        if (inner.name === 'node_modules' && inner.isDirectory() && !inner.isSymbolicLink()) queue.push({ nodeModules: innerFull, owner: null })
        else findings.push(fail('installed', toPosix(relative(root, innerFull)), 'unexpected entry in a pnpm store key directory'))
      }
    }
  }
  while (queue.length > 0) {
    const next = queue.shift()
    if (next.nested && !existsSync(next.nodeModules)) continue
    processNodeModules(next)
  }
  const workspaceReal = new Set(workspaceDirs.map((dir) => join(root, dir)))
  for (const { path, rel } of links) {
    let target
    try {
      target = realpathSync.native(path)
    } catch {
      findings.push(fail('installed', rel, 'broken link in node_modules'))
      continue
    }
    if (workspaceReal.has(target) || visited.has(target)) continue
    const where = relative(root, target)
    const outside = where.startsWith('..') || resolve(where) === where
    findings.push(fail('installed', rel, outside ? `link resolves outside the repo (${target})` : `link resolves to "${toPosix(where)}", which is neither a workspace package nor a walked package`))
  }
  return { findings, packages }
}

export const checkInstalled = async ({ root: givenRoot, dirs, kind, lock, workspaces, policy, verifyIntegrity = async () => 'no registry verification in this run' }) => {
  const root = realpathSync.native(givenRoot)
  const findings = []
  const seen = new Set()
  const report = (finding) => {
    const id = `${finding.level}|${finding.rule}|${finding.package}|${finding.detail}`
    if (!seen.has(id)) findings.push(finding)
    seen.add(id)
  }
  const extraRoots = dirs.map((dir) => realpathSync.native(resolve(dir))).filter((dir) => relative(root, dir).startsWith('..'))
  const workspaceDirs = findWorkspaceDirs(root, workspaces)
  const storeRoots = new Set(kind === 'pnpm' ? [root, ...extraRoots, ...workspaceDirs.map((dir) => join(root, dir))].map((dir) => join(dir, 'node_modules')) : [])
  const walk = walkInstalled(root, extraRoots, workspaceDirs, storeRoots)
  const aliasFolders = new Set([...lock.aliases].map((pair) => pair.split('>')).filter(([alias, real]) => alias !== real).map(([alias]) => alias))
  const prefixes = ['', ...workspaceDirs.filter((dir) => dir !== '.').map((dir) => `${escapeRegExp(dir)}/`)]
  const topLevel = new RegExp(`^(?:${prefixes.join('|')})node_modules/(?:@[^/]+/)?[^/]+$`)
  const registryLocation = ({ kind: manager, rel, folder, manifest, storeKey, lockPath }) => {
    if (manager === 'npm') return Boolean(lockPath && !lockPath.link && !lockPath.inBundle && lockPath.name === manifest.name && lockPath.version === manifest.version)
    if (manager === 'pnpm') return storeKey !== undefined && folder === manifest.name && new RegExp(`^${escapeRegExp(`${manifest.name.replace('/', '+')}@${manifest.version}`)}(?:$|[(_])`).test(storeKey)
    return topLevel.test(rel) && folder === manifest.name
  }
  walk.findings.forEach(report)
  for (const { dir, rel, folder, manifest: installedManifest, bundled, storeKey } of walk.packages) {
    const rawVersion = installedManifest.version
    const normalized = normalizeInstalledVersion(rawVersion)
    const manifest = { ...installedManifest, version: normalized ?? String(rawVersion) }
    const label = `${manifest.name}@${manifest.version}`
    const raw = normalized !== null && rawVersion !== normalized ? ` (package.json version ${JSON.stringify(rawVersion)})` : ''
    if (normalized === null) report(fail('installed-identity', rel, `installed package.json version ${JSON.stringify(rawVersion)} is not a valid semver after trimming and stripping one leading "v" or "="`))
    if (!bundled) {
      if (kind === 'npm') {
        const entry = lock.paths.get(rel)
        if (!entry || entry.link) report(fail('installed', rel, `${label} is installed at a path the lockfile does not list`))
        else if (entry.name !== manifest.name || entry.version !== manifest.version) report(fail('installed-identity', rel, `lockfile says ${entry.name}@${entry.version}, installed package.json is ${label}${raw}`))
      } else if (storeKey !== undefined) {
        if (folder !== manifest.name || !storeKey.startsWith(`${folder.replace('/', '+')}@${manifest.version}`)) report(fail('installed-identity', rel, `store key "${storeKey}" does not match installed package.json ${label}${raw}`))
      } else if (folder !== manifest.name && !lock.aliases.has(`${folder}>${manifest.name}`)) {
        report(fail('installed-identity', rel, `installed as "${folder}" but package.json name is ${manifest.name} and the lockfile has no such alias`))
      }
      if (!lock.entries.has(label)) report(fail('installed', label, `installed (${rel}) but not in the evaluated lockfile entries${raw}`))
    }
    const scripts = installScriptsOf(dir, manifest)
    if (scripts.length === 0) continue
    const lockPath = kind === 'npm' ? lock.paths.get(rel) : undefined
    if (bundled || lockPath?.inBundle) {
      report(fail('install-script', label, `bundled copy, allowlist does not apply: installed package.json (${rel})${raw}: ${scripts.join(', ')}`))
      continue
    }
    if (kind === 'yarn' && aliasFolders.has(folder)) {
      report(fail('install-script', label, `ambiguous folder: alias in lockfile, allowlist does not apply: installed package.json (${rel})${raw}: ${scripts.join(', ')}`))
      continue
    }
    const directOk = kind !== 'yarn' || lock.direct.has(label)
    const candidates = policy.installAllow.filter((entry) => entry.package === manifest.name && entry.version === manifest.version)
    const allowed = !directOk ? undefined : candidates.find((entry) => entry.path === rel) ?? candidates.find((entry) => entry.path === undefined && registryLocation({ kind, rel, folder, manifest, storeKey, lockPath }))
    const unverified = allowed ? await verifyIntegrity(label) : null
    const why = candidates.length === 0 ? '' : !directOk ? ` (allowlisted, but the lockfile has no non-alias entry for ${label})` : !allowed ? ` (allowlisted, but not at a location where the package manager installed the registry tarball: ${rel})` : unverified ? ` (allowlisted, but ${unverified})` : ''
    report(
      allowed && !unverified
        ? { level: 'allowed', rule: 'install-script', package: label, detail: `installed package.json (${rel})${raw}: ${scripts.join(', ')} allowed: ${allowed.reason}` }
        : fail('install-script', label, `installed package.json (${rel})${raw}: ${scripts.join(', ')}${why}`)
    )
  }
  if (walk.packages.length === 0) report(fail('installed', 'node_modules', `no installed packages found under ${root}`))
  return { findings, packages: walk.packages.length }
}

const PNPM_LAYOUT_DEFAULTS = { nodeLinker: 'isolated', 'node-linker': 'isolated', virtualStoreDir: 'node_modules/.pnpm', modulesDir: 'node_modules', storeDir: null }
const PNPM_WORKSPACE_KEYS = new Set([
  'packages',
  'catalog',
  'catalogs',
  'onlyBuiltDependencies',
  'ignoredBuiltDependencies',
  'neverBuiltDependencies',
  'allowBuilds',
  'overrides',
  'patchedDependencies',
  'minimumReleaseAge',
  'minimumReleaseAgeExclude',
  'trustPolicy',
  'blockExoticSubdeps',
  'registry',
  ...Object.keys(PNPM_LAYOUT_DEFAULTS)
])

const workspaceScalar = (raw) => {
  const quoted = /^"([^"\\\u0000-\u001f]*)"$/.exec(raw)
  return quoted ? quoted[1] : yamlScalar(raw)
}

export const pnpmLayoutProblems = (text) => {
  const findings = []
  const bad = (index, detail) => findings.push(fail('workspace-config', 'pnpm-workspace.yaml', `line ${index + 1}: ${detail}`))
  const seen = new Set()
  let blockOpen = false
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    const body = line.slice(indent)
    if (indent === 0) {
      const pair = /^("[^"]+"|[^\s:'"{[][^:]*?):(?: (.+))?$/.exec(body)
      const key = pair && workspaceScalar(pair[1])
      if (!pair || key === null) {
        bad(index, `non-canonical top-level line "${body}" (flow mappings and other YAML forms are not accepted)`)
        blockOpen = false
        continue
      }
      if (!PNPM_WORKSPACE_KEYS.has(key)) bad(index, `unknown key "${key}"`)
      if (seen.has(key)) bad(index, `duplicate key "${key}"`)
      seen.add(key)
      blockOpen = pair[2] === undefined
      if (pair[2] === undefined) {
        if (key in PNPM_LAYOUT_DEFAULTS) bad(index, `layout key "${key}" must be a scalar`)
        continue
      }
      const value = workspaceScalar(pair[2])
      if (value === null) {
        bad(index, `non-canonical value "${pair[2]}" (top-level flow collections are not accepted)`)
        continue
      }
      if (key in PNPM_LAYOUT_DEFAULTS && PNPM_LAYOUT_DEFAULTS[key] !== value.replace(/\/$/, '')) {
        findings.push(fail('layout', 'pnpm-workspace.yaml', `non-standard layout: ${body}`))
      }
      continue
    }
    if (!blockOpen || indent % 2 !== 0) {
      bad(index, `unexpected indentation "${body}"`)
      continue
    }
    const item = /^- (.+)$/.exec(body)
    if (item) {
      if (workspaceScalar(item[1]) === null) bad(index, `non-canonical sequence item "${body}"`)
      continue
    }
    const pair = /^("[^"]+"|'[^']+'|[^\s'"][^']*?):(?: (.+))?$/.exec(body)
    const key = pair && (workspaceScalar(pair[1]) ?? yamlKey(pair[1]))
    const value = pair?.[2] === undefined ? '' : /^[{[]/.test(pair[2]) ? yamlFlow(pair[2]) : workspaceScalar(pair[2])
    if (!pair || key === null || key === '<<' || value === null) bad(index, `non-canonical line "${body}"`)
  }
  return findings
}

const legacyDependencyProblems = (packages, dependencies) => {
  const problems = []
  const seen = new Set()
  const visit = (deps, prefix) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      const path = `${prefix}node_modules/${name}`
      seen.add(path)
      const entry = packages[path]
      if (!entry) {
        problems.push(`legacy "dependencies" lists "${path}" but "packages" does not`)
        continue
      }
      const legacyVersion = String(node?.version ?? '')
      if (entry.link || /^file:/.test(legacyVersion)) {
        if (!(entry.link && /^file:/.test(legacyVersion))) problems.push(`legacy "dependencies" and "packages" disagree on whether "${path}" is a link`)
        continue
      }
      const expected = entry.name && entry.name !== name ? `npm:${entry.name}@${entry.version}` : entry.version
      if (legacyVersion !== expected) problems.push(`legacy "dependencies" has ${path} ${legacyVersion}, "packages" has ${expected}`)
      for (const field of ['resolved', 'integrity']) {
        if ((node?.[field] ?? null) !== (entry[field] ?? null)) problems.push(`legacy "dependencies" and "packages" disagree on ${field} of "${path}"`)
      }
      visit(node?.dependencies, `${path}/`)
    }
  }
  visit(dependencies, '')
  for (const path of Object.keys(packages)) {
    if (path.includes('node_modules/') && !seen.has(path)) problems.push(`"packages" lists "${path}" but legacy "dependencies" does not`)
  }
  return problems
}

const gitShowBuffer = (root, ref, file) => {
  try {
    return execFileSync('git', ['-C', root, 'show', `${ref}:./${file}`], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return null
  }
}

export const runLockMode = async ({ root, base, now, fetchImpl, githubToken, installed = [], policyRoot = root }) => {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`])
  } catch {
    throw new UsageError(`git ref "${base}" not found in ${root}`)
  }
  const found = LOCKFILES.find(([, file]) => existsSync(join(root, file)))
  if (!found) throw new UsageError(`no yarn.lock, pnpm-lock.yaml or package-lock.json in ${root}`)
  const [kind, file] = found
  const headPkg = readJsonFile(join(root, 'package.json'), {})
  const headBytes = decodeLockfile(readFileSync(join(root, file)), kind)
  const headText = headBytes.text
  const head = parseLock(kind, headText)
  head.problems.unshift(...headBytes.problems)
  if (kind === 'yarn') head.workspaces = workspaceGlobs(headPkg)
  const pnpmWorkspaceBytes = existsSync(join(root, 'pnpm-workspace.yaml')) ? decodeLockfile(readFileSync(join(root, 'pnpm-workspace.yaml')), 'pnpm') : { text: '', problems: [] }
  const pnpmWorkspaceText = pnpmWorkspaceBytes.text
  const baseBuffer = gitShowBuffer(root, base, file)
  const baseText = baseBuffer === null ? null : decodeLockfile(baseBuffer, kind)
  let baseLock = baseText === null ? emptyLock() : parseLock(kind, baseText.text)
  const baseWarnings = []
  if (baseText && (baseText.problems.length > 0 || baseLock.problems.length > 0)) {
    baseWarnings.push({ level: 'warn', rule: 'lockfile', package: `${file}@${base}`, detail: 'base lockfile is not canonical; every head entry is treated as new' })
    baseLock = emptyLock()
  }
  const basePkgText = gitShow(root, base, 'package.json')
  const basePkg = basePkgText === null ? {} : JSON.parse(basePkgText)

  const policy = loadPolicy(policyRoot, now)
  const lock = lockFindings(head, baseLock)
  const findings = [
    ...baseWarnings,
    ...policy.findings,
    ...checkOverrides(collectOverrides(headPkg, head.overrides), collectOverrides(basePkg, baseLock.overrides)),
    ...lock.findings
  ]
  if (kind === 'pnpm') findings.push(...registryConfigProblems([['pnpm-workspace.yaml', pnpmWorkspaceText], [file, headText]]), ...pnpmLayoutProblems(pnpmWorkspaceText), ...pnpmWorkspaceBytes.problems.map((problem) => fail('workspace-config', 'pnpm-workspace.yaml', problem)))
  const globs = [...workspaceGlobs(headPkg), ...head.workspaces, ...pnpmWorkspaceGlobs(pnpmWorkspaceText)]
  if (head.entries.size === 0 && head.locals.length === 0 && head.problems.length === 0 && declaresDependencies(root, headPkg, globs)) {
    findings.push(fail('lockfile', file, 'lockfile has no entries but package.json declares dependencies'))
  }
  const baseVersions = new Map()
  for (const entry of baseLock.entries.values()) baseVersions.set(entry.name, [...(baseVersions.get(entry.name) ?? []), entry.version])
  const fresh = [...head.entries.entries()].filter(([key]) => !baseLock.entries.has(key))
  const lookup = createRegistry(fetchImpl, { githubToken })
  const usableOf = (entry) => entry.occurrences.filter((occurrence) => !hostProblem(entry.name, occurrence))
  const byRegistry = (occurrences) => {
    const groups = new Map()
    for (const occurrence of occurrences) {
      const host = occurrence.host === GITHUB_HOST ? GITHUB_HOST : NPM_HOST
      groups.set(host, [...(groups.get(host) ?? []), occurrence])
    }
    return [...groups.entries()]
  }
  const checks = [
    ...fresh.flatMap(([, entry]) => {
      const previous = baseVersions.has(entry.name) ? previousOf(entry.version, baseVersions.get(entry.name)) : undefined
      return byRegistry(usableOf(entry)).map(([host, occurrences]) =>
        evaluate({ name: entry.name, version: entry.version, host, previous, occurrences }, { lookup, policy, now })
      )
    }),
    ...lock.changed.flatMap(({ entry, occurrences }) =>
      byRegistry(occurrences).map(([host, group]) =>
        evaluate({ name: entry.name, version: entry.version, host, occurrences: group, identityOnly: true }, { lookup, policy, now })
      )
    )
  ]
  const baseBundled = new Set(baseLock.bundled.map((item) => `${item.name}@${item.version}`))
  for (const item of head.bundled) {
    const label = `${item.name}@${item.version}`
    if (!item.hasInstallScript || baseBundled.has(label)) continue
    findings.push(fail('install-script', label, 'bundled copy, allowlist does not apply: hasInstallScript in lockfile'))
  }
  for (const result of await Promise.all(checks)) findings.push(...result)
  const verifications = new Map()
  const verifyIntegrity = (label) => {
    if (!verifications.has(label)) verifications.set(label, verifyEntry(head.entries.get(label)))
    return verifications.get(label)
  }
  const verifyEntry = async (entry) => {
    if (!entry) return 'not in the lockfile'
    const occurrences = usableOf(entry)
    if (occurrences.length === 0 || occurrences.length !== entry.occurrences.length) return 'lockfile entry has a rejected source'
    if (occurrences.some((occurrence) => hashesOf(occurrence).hashes.size === 0 || hashesOf(occurrence).errors.length > 0)) return 'lockfile entry has no valid integrity'
    for (const [host, group] of byRegistry(occurrences)) {
      const result = await evaluate({ name: entry.name, version: entry.version, host, occurrences: group, identityOnly: true }, { lookup, policy, now })
      if (result.length > 0) return `integrity not verified against the registry: ${result.map((finding) => finding.detail).join('; ')}`
    }
    return null
  }
  const installedCheck = installed.length > 0 ? await checkInstalled({ root, dirs: installed, kind, lock: head, workspaces: globs, policy, verifyIntegrity }) : null
  if (installedCheck) findings.push(...installedCheck.findings)
  return {
    mode: 'lock',
    lockfile: file,
    base,
    baseHasLock: baseText !== null,
    installedPackages: installedCheck?.packages,
    headEntries: head.entries.size,
    newEntries: fresh.map(([key]) => key),
    changedEntries: lock.changed.map(({ entry }) => `${entry.name}@${entry.version}`),
    registryRequests: lookup.requests(),
    findings
  }
}

export const runSpecMode = async ({ root, specs, now, fetchImpl, githubToken }) => {
  const policy = loadPolicy(root, now)
  const findings = [...policy.findings]
  const lookup = createRegistry(fetchImpl, { githubToken })
  const checks = specs.map(async (spec) => {
    const [name, version] = splitSpec(spec)
    if (!PLAIN_VERSION.test(version)) return [fail('not-exact', spec, 'pin an exact version (name@1.2.3)')]
    const host = name.startsWith(GITHUB_SCOPE) ? GITHUB_HOST : NPM_HOST
    const result = await lookup(host, name)
    const known = result.status === 'ok' ? Object.keys(result.doc.versions).filter((candidate) => !parseSemver(candidate)?.pre) : []
    const previous = known.filter((candidate) => compareSemver(candidate, version) < 0).sort(compareSemver).at(-1)
    return evaluate({ name, version, host, previous, registryOnly: true }, { lookup, policy, now })
  })
  for (const result of await Promise.all(checks)) findings.push(...result)
  return { mode: 'spec', specs, newEntries: specs, registryRequests: lookup.requests(), findings }
}

export const formatReport = (report) => {
  const rows = report.findings.map((finding) => [finding.level.toUpperCase(), finding.rule, finding.package, finding.detail])
  const lines = []
  if (rows.length > 0) {
    const header = ['LEVEL', 'RULE', 'PACKAGE', 'DETAIL']
    const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)))
    const format = (row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join('  ')
    lines.push(format(header), ...rows.map(format), '')
  }
  const count = (level) => report.findings.filter((finding) => finding.level === level).length
  const scope =
    report.mode === 'lock' ? `${report.lockfile} vs ${report.base}${report.baseHasLock ? '' : ' (no lockfile in base)'}, ${report.headEntries} entries checked for host, ${report.changedEntries.length} changed,${report.installedPackages === undefined ? '' : ` ${report.installedPackages} installed packages checked,`}` : 'spec:'
  lines.push(
    `lock-guard ${scope} ${report.newEntries.length} new entries, ${count('fail')} failures, ${count('warn')} warnings, ${count('allowed')} allowed, ${report.registryRequests} registry requests (${report.ms} ms) -> ${count('fail') > 0 ? 'FAIL' : 'PASS'}`
  )
  return lines.join('\n')
}

export const main = async (argv, { fetchImpl = globalThis.fetch, now = new Date(), cwd = process.cwd(), env = process.env, out = console.log, err = console.error } = {}) => {
  let options
  try {
    options = parseArgs({
      args: argv,
      options: {
        base: { type: 'string', default: 'origin/main' },
        root: { type: 'string', default: cwd },
        spec: { type: 'string', multiple: true },
        installed: { type: 'string', multiple: true },
        'policy-dir': { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false }
      }
    }).values
  } catch (error) {
    err(`${error.message}\n\n${HELP}`)
    return 2
  }
  if (options.help) {
    out(HELP)
    return 0
  }
  const started = performance.now()
  const githubToken = env.LOCK_GUARD_GHPKG_TOKEN || undefined
  try {
    const root = resolve(options.root)
    const report = options.spec
      ? await runSpecMode({ root, specs: options.spec, now, fetchImpl, githubToken })
      : await runLockMode({ root, base: options.base, now, fetchImpl, githubToken, installed: options.installed ?? [], policyRoot: resolve(options['policy-dir'] ?? root) })
    report.ms = Math.round(performance.now() - started)
    report.ok = !report.findings.some((finding) => finding.level === 'fail')
    out(options.json ? JSON.stringify(report, null, 2) : formatReport(report))
    return report.ok ? 0 : 1
  } catch (error) {
    err(`lock-guard: ${error instanceof UsageError ? error.message : error.stack}`)
    return 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
