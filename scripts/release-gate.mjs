if (process.env.VBSS_RELEASE !== '1') {
  console.error('publish refused: run "npm run patch-deploy", "minor-deploy" or "major-deploy"; scripts/release.mjs verifies, versions and publishes in one process')
  process.exit(1)
}
