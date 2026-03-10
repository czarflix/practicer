import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fjulxsdwycrmtamwfjxx.supabase.co'
const supabaseKey = 'sb_publishable_NWfoNa72lCviGjpP7ScS4w_DFIqEkIZ'
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  const { data: problems, error: pError } = await supabase.from('problems').select('nc_lc, cp_lc, nc_title, cp_title')
  if (pError) { console.error("Error fetching problems:", pError); return; }

  const { data: content, error: cError } = await supabase.from('problem_content').select('problem_lc, problem_description')
  if (cError) { console.error("Error fetching content:", cError); return; }

  const { data: tests, error: tError } = await supabase.from('problem_test_cases').select('problem_lc')
  if (tError) { console.error("Error fetching tests:", tError); return; }

  const problemMap = new Map()
  problems.forEach(p => {
    if (p.nc_lc) problemMap.set(p.nc_lc, p.nc_title)
    if (p.cp_lc) problemMap.set(p.cp_lc, p.cp_title)
  })

  const contentMap = new Map()
  content.forEach(c => {
    contentMap.set(c.problem_lc, c)
  })

  const testLcs = new Set(tests.map(t => t.problem_lc))

  const missingOrEmptyContent = []
  const missingTests = []

  for (const [lc, title] of problemMap.entries()) {
    const c = contentMap.get(lc)
    if (!c || !c.problem_description || c.problem_description.trim() === '') {
      missingOrEmptyContent.push({ lc, title })
    }
    if (!testLcs.has(lc)) {
      missingTests.push({ lc, title })
    }
  }

  console.log(`Total problems in DB: ${problemMap.size}`)
  console.log(`Missing or empty problem descriptions: ${missingOrEmptyContent.length}`)
  console.log(`Missing ANY test cases: ${missingTests.length}`)
  
  const completelyMissing = missingOrEmptyContent.filter(m => missingTests.some(t => t.lc === m.lc))
  console.log(`Problems missing BOTH content and tests: ${completelyMissing.length}`)

  console.log('\n--- Missing Both ---')
  completelyMissing.sort((a,b)=>a.lc-b.lc).forEach(m => console.log(`LC ${m.lc}: ${m.title}`))
  
  // Save to file for the agent to read
  import('fs').then(fs => {
    fs.writeFileSync('missing_data_report.json', JSON.stringify({
      total: problemMap.size,
      missingBoth: completelyMissing,
      missingContent: missingOrEmptyContent,
      missingTests: missingTests
    }, null, 2))
  })
}

check()
