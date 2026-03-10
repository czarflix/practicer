import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { buildProblemPresentation } from '../src/lib/problem-content.js'

const OUT_DIR = '/Users/czarflix/dsa_metadata/dsa_workspace_presentation'
const OUT_PATH = path.join(OUT_DIR, 'dsa_workspace_base.json')
const SUMMARY_PATH = path.join(OUT_DIR, 'dsa_workspace_base_summary.json')
const BATCH_SIZE = 100

function readEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.trim().startsWith('#') && line.includes('='))
      .map((line) => {
        const divider = line.indexOf('=')
        return [line.slice(0, divider).trim(), line.slice(divider + 1).trim()]
      }),
  )
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function normalizePresentation(content) {
  const examples = Array.isArray(content?.input_output || content?.examples) ? content.input_output || content.examples : []
  const existingPresentation =
    content?.presentation &&
    typeof content.presentation === 'object' &&
    !Array.isArray(content.presentation) &&
    Object.keys(content.presentation).length > 0
      ? content.presentation
      : null

  return existingPresentation ?? buildProblemPresentation({ description: content?.problem_description || '', examples })
}

async function fetchProblemContentMap(supabase, problemKeys) {
  const rows = []

  for (let index = 0; index < problemKeys.length; index += BATCH_SIZE) {
    const slice = problemKeys.slice(index, index + BATCH_SIZE)
    const { data, error } = await supabase.from('problem_content').select('*').in('problem_key', slice)
    if (error) {
      throw error
    }
    rows.push(...(data || []))
  }

  return new Map(rows.map((row) => [row.problem_key, row]))
}

async function main() {
  const env = readEnv('/Users/czarflix/Downloads/DSA/dsa-app/.env.local')
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data: problems, error: problemError } = await supabase
    .from('v_study_problems')
    .select('*')
    .eq('track_key', 'dsa')
    .order('tier', { ascending: true })
    .order('phase', { ascending: true })
    .order('study_order', { ascending: true })

  if (problemError) {
    throw problemError
  }

  const problemRows = problems || []
  const contentMap = await fetchProblemContentMap(
    supabase,
    problemRows.map((row) => row.problem_key),
  )

  const exported = problemRows.map((problem) => {
    const content = contentMap.get(problem.problem_key) || {}
    const presentation = normalizePresentation(content)

    return {
      problem_key: problem.problem_key,
      title: problem.title,
      problem_lc: problem.problem_lc,
      difficulty: problem.difficulty,
      tier: problem.tier,
      phase: problem.phase,
      phase_name: problem.phase_name,
      phase_order: problem.phase_order,
      study_order: problem.study_order,
      source: {
        platform: problem.source_platform || 'LeetCode',
        canonical_url: problem.canonical_source_url || problem.leetcode_url || problem.source_url || '',
        original_url: problem.source_url || problem.canonical_source_url || problem.leetcode_url || '',
        neetcode_url: problem.neetcode_url || '',
      },
      raw: {
        problem_description: content.problem_description || '',
        statement_clean: content.statement_clean || '',
        constraints_text: content.constraints_text || '',
        input_output: Array.isArray(content.input_output) ? content.input_output : [],
      },
      presentation,
    }
  })

  ensureDir(OUT_DIR)
  fs.writeFileSync(OUT_PATH, JSON.stringify(exported, null, 2))
  fs.writeFileSync(
    SUMMARY_PATH,
    JSON.stringify(
      {
        problems: exported.length,
        with_examples: exported.filter((row) => Array.isArray(row.presentation?.examples) && row.presentation.examples.length > 0)
          .length,
        with_interface: exported.filter(
          (row) =>
            Array.isArray(row.presentation?.interfaceItems) && row.presentation.interfaceItems.length > 0,
        ).length,
        with_follow_up: exported.filter(
          (row) => Array.isArray(row.presentation?.followUp) && row.presentation.followUp.length > 0,
        ).length,
      },
      null,
      2,
    ),
  )

  console.log(
    JSON.stringify(
      {
        out_path: OUT_PATH,
        summary_path: SUMMARY_PATH,
        problems: exported.length,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
