import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeProblemDescriptionForStorage,
  normalizeProblemExamplesForStorage,
} from '../src/lib/problem-content.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const datasetPath = path.join(projectRoot, 'src', 'final_dataset.json')

function main() {
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'))

  const normalized = raw.map((row) => ({
    ...row,
    problem_description: normalizeProblemDescriptionForStorage(row.problem_description || ''),
    input_output: JSON.stringify(normalizeProblemExamplesForStorage(row.input_output)),
  }))

  fs.writeFileSync(datasetPath, `${JSON.stringify(normalized, null, 2)}\n`)
  console.log(`Normalized ${normalized.length} rows in ${datasetPath}`)
}

main()
