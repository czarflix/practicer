import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const values = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const splitIndex = line.indexOf('=')
    if (splitIndex <= 0) {
      continue
    }

    const key = line.slice(0, splitIndex).trim()
    let value = line.slice(splitIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

function envValue(key) {
  if (process.env[key]) {
    return process.env[key]
  }

  const localEnv = loadDotEnv(path.join(projectRoot, '.env.local'))
  if (localEnv[key]) {
    return localEnv[key]
  }

  const baseEnv = loadDotEnv(path.join(projectRoot, '.env'))
  return baseEnv[key]
}

function pyJsonLoadLiteral(value) {
  return JSON.stringify(JSON.stringify(value))
}

function buildSudokuHarness(cases) {
  return `def check(candidate):
    import json
    data = json.loads(${pyJsonLoadLiteral(cases)})
    for idx, case in enumerate(data, start=1):
        board = [row[:] for row in case["board"]]
        expected = case["output"]
        result = candidate(board)
        actual = result if result is not None else board
        assert actual == expected, f"Case {idx} failed: expected {expected} got {actual}"
`
}

function buildWordSearch2Harness(cases) {
  return `def check(candidate):
    import json
    data = json.loads(${pyJsonLoadLiteral(cases)})
    for idx, case in enumerate(data, start=1):
        board = [row[:] for row in case["board"]]
        words = list(case["words"])
        expected = sorted(case["output"])
        actual = sorted(candidate(board, words))
        assert actual == expected, f"Case {idx} failed: expected {expected} got {actual}"
`
}

function buildKthSmallestHarness(cases) {
  return `def check(candidate):
    import json
    data = json.loads(${pyJsonLoadLiteral(cases)})
    for idx, case in enumerate(data, start=1):
        root = tree_node(case["root"])
        expected = case["output"]
        actual = candidate(root, case["k"])
        assert actual == expected, f"Case {idx} failed: expected {expected} got {actual}"
`
}

const SOLVED_SUDOKU = [
  ['5', '3', '4', '6', '7', '8', '9', '1', '2'],
  ['6', '7', '2', '1', '9', '5', '3', '4', '8'],
  ['1', '9', '8', '3', '4', '2', '5', '6', '7'],
  ['8', '5', '9', '7', '6', '1', '4', '2', '3'],
  ['4', '2', '6', '8', '5', '3', '7', '9', '1'],
  ['7', '1', '3', '9', '2', '4', '8', '5', '6'],
  ['9', '6', '1', '5', '3', '7', '2', '8', '4'],
  ['2', '8', '7', '4', '1', '9', '6', '3', '5'],
  ['3', '4', '5', '2', '8', '6', '1', '7', '9'],
]

const REPAIRS = {
  33: {
    mode: 'generic',
    cases: [
      { inputText: 'nums = [4,5,6,7,0,1,2], target = 0', expectedText: '4' },
      { inputText: 'nums = [4,5,6,7,0,1,2], target = 3', expectedText: '-1' },
      { inputText: 'nums = [1], target = 0', expectedText: '-1' },
      { inputText: 'nums = [1], target = 1', expectedText: '0' },
      { inputText: 'nums = [1,3], target = 3', expectedText: '1' },
      { inputText: 'nums = [5,1,3], target = 5', expectedText: '0' },
      { inputText: 'nums = [3,1], target = 1', expectedText: '1' },
      { inputText: 'nums = [6,7,8,1,2,3,4,5], target = 4', expectedText: '6' },
    ],
  },
  37: {
    mode: 'custom',
    customCases: [
      {
        board: [
          ['5', '3', '.', '.', '7', '.', '.', '.', '.'],
          ['6', '.', '.', '1', '9', '5', '.', '.', '.'],
          ['.', '9', '8', '.', '.', '.', '.', '6', '.'],
          ['8', '.', '.', '.', '6', '.', '.', '.', '3'],
          ['4', '.', '.', '8', '.', '3', '.', '.', '1'],
          ['7', '.', '.', '.', '2', '.', '.', '.', '6'],
          ['.', '6', '.', '.', '.', '.', '2', '8', '.'],
          ['.', '.', '.', '4', '1', '9', '.', '.', '5'],
          ['.', '.', '.', '.', '8', '.', '.', '7', '9'],
        ],
        output: SOLVED_SUDOKU,
      },
      {
        board: [
          ['5', '3', '4', '6', '7', '8', '9', '1', '2'],
          ['6', '7', '2', '1', '9', '5', '3', '4', '8'],
          ['1', '9', '8', '3', '4', '2', '5', '6', '7'],
          ['8', '5', '9', '7', '6', '1', '4', '2', '3'],
          ['4', '2', '6', '8', '5', '3', '7', '9', '1'],
          ['7', '1', '3', '9', '2', '4', '8', '5', '6'],
          ['9', '6', '1', '5', '3', '7', '2', '8', '4'],
          ['2', '8', '7', '4', '1', '9', '6', '3', '5'],
          ['3', '4', '5', '2', '8', '6', '1', '7', '.'],
        ],
        output: SOLVED_SUDOKU,
      },
      {
        board: [
          ['.', '3', '4', '6', '7', '8', '9', '1', '2'],
          ['6', '.', '2', '1', '9', '5', '3', '4', '8'],
          ['1', '9', '.', '3', '4', '2', '5', '6', '7'],
          ['8', '5', '9', '.', '6', '1', '4', '2', '3'],
          ['4', '2', '6', '8', '.', '3', '7', '9', '1'],
          ['7', '1', '3', '9', '2', '.', '8', '5', '6'],
          ['9', '6', '1', '5', '3', '7', '.', '8', '4'],
          ['2', '8', '7', '4', '1', '9', '6', '.', '5'],
          ['3', '4', '5', '2', '8', '6', '1', '7', '.'],
        ],
        output: SOLVED_SUDOKU,
      },
    ],
    previewCases: [
      { inputText: 'board = [["5","3",".",".","7",".",".",".","."],["6",".",".","1","9","5",".",".","."],[".","9","8",".",".",".",".","6","."],["8",".",".",".","6",".",".",".","3"],["4",".",".","8",".","3",".",".","1"],["7",".",".",".","2",".",".",".","6"],[".","6",".",".",".",".","2","8","."],[".",".",".","4","1","9",".",".","5"],[".",".",".",".","8",".",".","7","9"]]', expectedText: JSON.stringify(SOLVED_SUDOKU) },
      { inputText: 'board = [["5","3","4","6","7","8","9","1","2"],["6","7","2","1","9","5","3","4","8"],["1","9","8","3","4","2","5","6","7"],["8","5","9","7","6","1","4","2","3"],["4","2","6","8","5","3","7","9","1"],["7","1","3","9","2","4","8","5","6"],["9","6","1","5","3","7","2","8","4"],["2","8","7","4","1","9","6","3","5"],["3","4","5","2","8","6","1","7",""]]', expectedText: JSON.stringify(SOLVED_SUDOKU) },
      { inputText: 'board = [[".","3","4","6","7","8","9","1","2"],["6",".","2","1","9","5","3","4","8"],["1","9",".","3","4","2","5","6","7"],["8","5","9",".","6","1","4","2","3"],["4","2","6","8",".","3","7","9","1"],["7","1","3","9","2",".","8","5","6"],["9","6","1","5","3","7",".","8","4"],["2","8","7","4","1","9","6",".","5"],["3","4","5","2","8","6","1","7",""]]', expectedText: JSON.stringify(SOLVED_SUDOKU) },
    ],
    harness: buildSudokuHarness,
  },
  153: {
    mode: 'generic',
    cases: [
      { inputText: 'nums = [3,4,5,1,2]', expectedText: '1' },
      { inputText: 'nums = [4,5,6,7,0,1,2]', expectedText: '0' },
      { inputText: 'nums = [11,13,15,17]', expectedText: '11' },
      { inputText: 'nums = [2,1]', expectedText: '1' },
      { inputText: 'nums = [1]', expectedText: '1' },
      { inputText: 'nums = [5,6,1,2,3,4]', expectedText: '1' },
      { inputText: 'nums = [2,3,4,5,6,7,1]', expectedText: '1' },
      { inputText: 'nums = [10,11,12,13,14,4,5,6,7,8,9]', expectedText: '4' },
    ],
  },
  167: {
    mode: 'generic',
    cases: [
      { inputText: 'numbers = [2,7,11,15], target = 9', expectedText: '[1,2]' },
      { inputText: 'numbers = [2,3,4], target = 6', expectedText: '[1,3]' },
      { inputText: 'numbers = [-1,0], target = -1', expectedText: '[1,2]' },
      { inputText: 'numbers = [1,2,3,4,4,9,56,90], target = 8', expectedText: '[4,5]' },
      { inputText: 'numbers = [-10,-3,0,2,4,8], target = 1', expectedText: '[2,5]' },
      { inputText: 'numbers = [1,3,4,6,8,10], target = 14', expectedText: '[3,6]' },
      { inputText: 'numbers = [1,2], target = 3', expectedText: '[1,2]' },
      { inputText: 'numbers = [0,0,3,4], target = 0', expectedText: '[1,2]' },
    ],
  },
  212: {
    mode: 'custom',
    customCases: [
      {
        board: [['o', 'a', 'a', 'n'], ['e', 't', 'a', 'e'], ['i', 'h', 'k', 'r'], ['i', 'f', 'l', 'v']],
        words: ['oath', 'pea', 'eat', 'rain'],
        output: ['eat', 'oath'],
      },
      {
        board: [['a']],
        words: ['a', 'aa'],
        output: ['a'],
      },
      {
        board: [['a', 'b'], ['c', 'd']],
        words: ['ab', 'abcd', 'ad', 'bd', 'ac', 'ca'],
        output: ['ab', 'ac', 'bd', 'ca'],
      },
      {
        board: [['a', 'a']],
        words: ['a', 'aa', 'aaa'],
        output: ['a', 'aa'],
      },
    ],
    previewCases: [
      { inputText: "board = [['o','a','a','n'],['e','t','a','e'],['i','h','k','r'],['i','f','l','v']], words = ['oath','pea','eat','rain']", expectedText: "['eat','oath']" },
      { inputText: "board = [['a']], words = ['a','aa']", expectedText: "['a']" },
      { inputText: "board = [['a','b'],['c','d']], words = ['ab','abcd','ad','bd','ac','ca']", expectedText: "['ab','ac','bd','ca']" },
      { inputText: "board = [['a','a']], words = ['a','aa','aaa']", expectedText: "['a','aa']" },
    ],
    harness: buildWordSearch2Harness,
  },
  227: {
    mode: 'generic',
    cases: [
      { inputText: 's = "3+2*2"', expectedText: '7' },
      { inputText: 's = " 3/2 "', expectedText: '1' },
      { inputText: 's = " 3+5 / 2 "', expectedText: '5' },
      { inputText: 's = "14-3/2"', expectedText: '13' },
      { inputText: 's = "1000000000 - 500000000 + 250000000"', expectedText: '750000000' },
      { inputText: 's = "1-1+1"', expectedText: '1' },
      { inputText: 's = "42"', expectedText: '42' },
      { inputText: 's = "18/4"', expectedText: '4' },
      { inputText: 's = "2*3+4"', expectedText: '10' },
      { inputText: 's = "12+3*4-6/2"', expectedText: '21' },
    ],
  },
  230: {
    mode: 'custom',
    customCases: [
      { root: [3, 1, 4, null, 2], k: 1, output: 1 },
      { root: [5, 3, 6, 2, 4, null, null, 1], k: 3, output: 3 },
      { root: [2, 1, 3], k: 2, output: 2 },
      { root: [1, null, 2], k: 2, output: 2 },
      { root: [5, 3, 7, 2, 4, 6, 8], k: 7, output: 8 },
      { root: [10, 5, 15, 3, 7, 12, 18], k: 4, output: 10 },
    ],
    previewCases: [
      { inputText: 'root = [3,1,4,null,2], k = 1', expectedText: '1' },
      { inputText: 'root = [5,3,6,2,4,null,null,1], k = 3', expectedText: '3' },
      { inputText: 'root = [2,1,3], k = 2', expectedText: '2' },
      { inputText: 'root = [1,null,2], k = 2', expectedText: '2' },
      { inputText: 'root = [5,3,7,2,4,6,8], k = 7', expectedText: '8' },
      { inputText: 'root = [10,5,15,3,7,12,18], k = 4', expectedText: '10' },
    ],
    harness: buildKthSmallestHarness,
  },
  287: {
    mode: 'generic',
    cases: [
      { inputText: 'nums = [1,3,4,2,2]', expectedText: '2' },
      { inputText: 'nums = [3,1,3,4,2]', expectedText: '3' },
      { inputText: 'nums = [1,1]', expectedText: '1' },
      { inputText: 'nums = [1,1,2]', expectedText: '1' },
      { inputText: 'nums = [2,5,9,6,9,3,8,9,7,1]', expectedText: '9' },
      { inputText: 'nums = [1,4,6,3,2,5,6]', expectedText: '6' },
      { inputText: 'nums = [4,3,1,4,2]', expectedText: '4' },
      { inputText: 'nums = [2,2,2,2,2]', expectedText: '2' },
    ],
  },
  322: {
    mode: 'generic',
    cases: [
      { inputText: 'coins = [1,2,5], amount = 11', expectedText: '3' },
      { inputText: 'coins = [2], amount = 3', expectedText: '-1' },
      { inputText: 'coins = [1], amount = 0', expectedText: '0' },
      { inputText: 'coins = [1], amount = 2', expectedText: '2' },
      { inputText: 'coins = [2,5,10,1], amount = 27', expectedText: '4' },
      { inputText: 'coins = [2,4,6], amount = 7', expectedText: '-1' },
      { inputText: 'coins = [3,7], amount = 14', expectedText: '2' },
      { inputText: 'coins = [5,7,8], amount = 15', expectedText: '2' },
    ],
  },
  778: {
    mode: 'generic',
    cases: [
      { inputText: 'grid = [[0,2],[1,3]]', expectedText: '3' },
      { inputText: 'grid = [[0,1,2,3,4],[24,23,22,21,5],[12,13,14,15,16],[11,17,18,19,20],[10,9,8,7,6]]', expectedText: '16' },
      { inputText: 'grid = [[3,2],[0,1]]', expectedText: '3' },
      { inputText: 'grid = [[0]]', expectedText: '0' },
      { inputText: 'grid = [[0,1,2],[5,4,3],[6,7,8]]', expectedText: '8' },
      { inputText: 'grid = [[8,7,6],[5,4,3],[2,1,0]]', expectedText: '8' },
    ],
  },
  1219: {
    mode: 'generic',
    cases: [
      { inputText: 'grid = [[0,6,0],[5,8,7],[0,9,0]]', expectedText: '24' },
      { inputText: 'grid = [[1,0,7],[2,0,6],[3,4,5],[0,3,0],[9,0,20]]', expectedText: '28' },
      { inputText: 'grid = [[1,2,3],[0,0,4],[7,6,5]]', expectedText: '28' },
      { inputText: 'grid = [[1]]', expectedText: '1' },
      { inputText: 'grid = [[0,0],[0,0]]', expectedText: '0' },
      { inputText: 'grid = [[10,33],[0,21]]', expectedText: '64' },
      { inputText: 'grid = [[1,0,0],[2,3,4],[0,0,5]]', expectedText: '15' },
    ],
  },
}

const TARGET_IDS = Object.keys(REPAIRS).map(Number)

async function main() {
  const supabaseUrl = envValue('VITE_SUPABASE_URL')
  const serviceRoleKey = envValue('VITE_SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_SERVICE_ROLE_KEY in environment.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const summary = []
  for (const lc of TARGET_IDS) {
    const repair = REPAIRS[lc]
    const previewCases = repair.previewCases || repair.cases
    const inputOutput = previewCases.slice(0, 4).map((item) => ({
      input: item.inputText,
      output: item.expectedText,
    }))

    const updatePayload = {
      problem_lc: lc,
      source: 'mixed',
      dataset_test_harness:
        repair.mode === 'custom'
          ? repair.harness(repair.customCases)
          : null,
      input_output: inputOutput,
    }

    const { error: contentError } = await supabase.from('problem_content').upsert(updatePayload, {
      onConflict: 'problem_lc',
    })
    if (contentError) {
      throw new Error(`LC ${lc} content update failed: ${contentError.message}`)
    }

    const { error: deleteError } = await supabase.from('problem_test_cases').delete().eq('problem_lc', lc)
    if (deleteError) {
      throw new Error(`LC ${lc} test delete failed: ${deleteError.message}`)
    }

    const testRows = previewCases.map((item, index) => ({
      problem_lc: lc,
      sort_order: index + 1,
      input_text: item.inputText,
      expected_output: item.expectedText,
      source: 'manual',
      is_active: true,
      notes: 'curated repair 2026-03-07',
    }))

    const { error: insertError } = await supabase.from('problem_test_cases').insert(testRows)
    if (insertError) {
      throw new Error(`LC ${lc} test insert failed: ${insertError.message}`)
    }

    summary.push({
      problem_lc: lc,
      mode: repair.mode,
      tests: testRows.length,
      examples: inputOutput.length,
      hasHarness: Boolean(updatePayload.dataset_test_harness),
    })
    console.log(`Repaired LC ${lc} (${testRows.length} tests)`)
  }

  const outPath = path.join(projectRoot, 'docs', 'dataset273-outlier-repair-summary-2026-03-07.json')
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(`WROTE ${outPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
