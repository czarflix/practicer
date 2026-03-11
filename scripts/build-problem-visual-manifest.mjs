import path from 'node:path'
import { buildProblemVisualManifest } from '../src/lib/problem-visuals.js'
import { createServiceRoleClient, projectRoot, writeJsonFile } from './_env.mjs'

const DEFAULT_MANIFEST_PATH = path.join(projectRoot, 'out', 'problem-visuals-manifest.json')
const DEFAULT_SUMMARY_PATH = path.join(projectRoot, 'out', 'problem-visuals-summary.json')

function parseArgs(argv) {
  let manifestPath = DEFAULT_MANIFEST_PATH
  let summaryPath = DEFAULT_SUMMARY_PATH

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--manifest' && next) {
      manifestPath = path.resolve(next)
      index += 1
      continue
    }

    if (arg.startsWith('--manifest=')) {
      manifestPath = path.resolve(arg.slice('--manifest='.length))
      continue
    }

    if (arg === '--summary' && next) {
      summaryPath = path.resolve(next)
      index += 1
      continue
    }

    if (arg.startsWith('--summary=')) {
      summaryPath = path.resolve(arg.slice('--summary='.length))
    }
  }

  return {
    manifestPath,
    summaryPath,
  }
}

async function main() {
  const { manifestPath, summaryPath } = parseArgs(process.argv.slice(2))
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('v_study_problems')
    .select('problem_key,title,track_key,phase_name,category,source_platform,tier,study_order,problem_lc')
    .order('track_key', { ascending: true })
    .order('tier', { ascending: true })
    .order('study_order', { ascending: true })

  if (error) {
    throw error
  }

  const manifest = buildProblemVisualManifest(data ?? [])
  const summary = {
    manifest_path: manifestPath,
    summary_path: summaryPath,
    required_problems: manifest.length,
    dsa: manifest.filter((row) => row.track === 'dsa').length,
    sql: manifest.filter((row) => row.track === 'sql').length,
  }

  writeJsonFile(manifestPath, manifest)
  writeJsonFile(summaryPath, summary)
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
