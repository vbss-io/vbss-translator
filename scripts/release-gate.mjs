import { checkStamp, writeStamp } from './release-state.mjs'

const mode = process.argv[2]

if (mode === 'stamp') {
  const state = writeStamp()
  console.log(`verify stamp written for ${state.head.slice(0, 7)} (clean: ${state.clean})`)
} else if (mode === 'check') {
  const result = checkStamp()
  if (!result.ok) {
    console.error(`release gate refused: ${result.reason}`)
    process.exit(1)
  }
  console.log(`release gate ok for ${result.state.head.slice(0, 7)}`)
} else {
  console.error('usage: release-gate.mjs <stamp|check>')
  process.exit(2)
}
