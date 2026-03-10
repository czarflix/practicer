import fs from 'fs'
import path from 'path'
import readline from 'readline'

const dsaCompanionsFile = '/Users/czarflix/Downloads/DSA/dsa-companions.json'
const trainFile = '/Users/czarflix/Downloads/LeetCodeDataset-train.jsonl'
const testFile = '/Users/czarflix/Downloads/LeetCodeDataset-test.jsonl'

async function run() {
  const dsaData = JSON.parse(fs.readFileSync(dsaCompanionsFile, 'utf8'))
  const requiredLcs = new Map()

  for (const item of dsaData.problems) {
    if (item.neetcode?.lc) requiredLcs.set(item.neetcode.lc, { title: item.neetcode.title, type: 'neetcode' })
    if (item.companion?.lc) requiredLcs.set(item.companion.lc, { title: item.companion.title, type: 'companion' })
  }

  const jsonlLcs = new Set()

  const processFile = async (filePath) => {
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping missing file: ${filePath}`)
      return
    }
    const fileStream = fs.createReadStream(filePath)
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        if (obj.question_id) jsonlLcs.add(Number(obj.question_id))
      } catch (e) { }
    }
  }

  await processFile(trainFile)
  await processFile(testFile)

  const missing = []
  let found = 0

  requiredLcs.forEach((info, lc) => {
    if (jsonlLcs.has(lc)) {
      found++
    } else {
      missing.push({ lc, ...info })
    }
  })

  missing.sort((a,b) => a.lc - b.lc)

  console.log(`Total DSA Problems: ${requiredLcs.size}`)
  console.log(`Matched in JSONL: ${found}`)
  console.log(`Missing in JSONL: ${missing.length}`)
  console.log('\n--- Missing Problems ---')
  missing.forEach(m => console.log(`[LC ${m.lc}] ${m.title} (${m.type})`))

  fs.writeFileSync('missing_27_problems.json', JSON.stringify(missing, null, 2))
}

run().catch(console.error)
