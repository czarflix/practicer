
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Service Role Key or Project URL in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key);

const REQUIRED_IDS = [
  117,133,138,142,146,155,208,211,235,271,285,295,297,355,372,430,449,460,652,703,715,716,731,911,981,1244,2013
];

/**
 * Normalise input_output into an array of { input: string, output: string }.
 *
 * Source data comes in two shapes:
 *   A) Stringified / raw object: { inputs: [...], outputs: [...] }
 *      → zip the two arrays into [{ input, output }, …]
 *   B) Already an array of objects, each with `inputs` + `outputs` keys
 *      (class-design problems like LRUCache)
 *      → stringify each element's inputs/outputs
 */
function normaliseIO(raw) {
  let io = raw;

  // 1. Parse if stringified
  if (typeof io === 'string') {
    try { io = JSON.parse(io); } catch { return []; }
  }
  if (io == null) return [];

  // 2. Already an array (format B)
  if (Array.isArray(io)) {
    return io.map(el => ({
      input:  JSON.stringify(el.inputs  ?? el.input  ?? ''),
      output: JSON.stringify(el.outputs ?? el.output ?? '')
    }));
  }

  // 3. Object with parallel arrays (format A)
  if (typeof io === 'object' && Array.isArray(io.inputs) && Array.isArray(io.outputs)) {
    return io.inputs.map((inp, idx) => ({
      input:  JSON.stringify(inp),
      output: JSON.stringify(io.outputs[idx])
    }));
  }

  // Fallback: wrap single object
  return [{ input: JSON.stringify(io), output: '""' }];
}

async function insertMissingData() {
  // ── Connectivity check ──
  const { error: pingErr } = await supabase
    .from('problems')
    .select('nc_lc')
    .limit(1);
  if (pingErr) {
    console.error('❌ Cannot reach Supabase:', pingErr.message);
    process.exit(1);
  }
  console.log('✅ Supabase connection OK\n');

  // ── Load source data ──
  const filePath = path.join(__dirname, 'src', 'final_dataset.json');
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const filteredData = data.filter(item => {
    const id = item.question_id || item.leetcode_id;
    return REQUIRED_IDS.includes(id);
  });
  console.log(`Found ${filteredData.length} / 27 problems in final_dataset.json`);

  // ── Fetch existing titles from problems table ──
  const { data: existingProblems } = await supabase
    .from('problems')
    .select('nc_lc, nc_title, cp_lc, cp_title')
    .or(
      REQUIRED_IDS.map(id => `nc_lc.eq.${id}`).join(',')
    );

  const titleMap = {};
  for (const p of existingProblems || []) {
    if (p.nc_lc) titleMap[p.nc_lc] = p.nc_title;
    if (p.cp_lc) titleMap[p.cp_lc] = p.cp_title;
  }

  let successContent = 0;
  let successTests = 0;

  for (const item of filteredData) {
    const lc = item.question_id || item.leetcode_id;
    console.log(`\n----- Processing LC ${lc} -----`);

    const ioArray = normaliseIO(item.input_output);

    // 1. Upsert problem_content
    const contentPayload = {
      problem_lc: lc,
      title: titleMap[lc] || `Problem ${lc}`,
      difficulty: item.difficulty || 'Medium',
      problem_description: item.problem_description || '',
      starter_code: item.starter_code || '',
      entry_point: item.entry_point || 'solution',
      source: 'dataset',
      tags: [],
      dataset_split: 'train',
      input_output: ioArray   // always an array → satisfies check constraint
    };

    const { error: cError } = await supabase
      .from('problem_content')
      .upsert(contentPayload, { onConflict: 'problem_lc' });

    if (cError) {
      console.error(`  ❌ problem_content failed:`, cError.message);
      continue;
    }
    console.log(`  ✅ problem_content upserted`);
    successContent++;

    // 2. Replace problem_test_cases
    if (ioArray.length === 0) {
      console.log(`  ⚠️  No test cases in source data`);
      continue;
    }

    // Delete existing rows first
    await supabase.from('problem_test_cases').delete().eq('problem_lc', lc);

    const testsPayload = ioArray.map((t, idx) => ({
      problem_lc: lc,
      input_text: t.input,
      expected_output: t.output,
      sort_order: idx + 1,
      is_active: true
    }));

    const { error: tError } = await supabase
      .from('problem_test_cases')
      .insert(testsPayload);

    if (tError) {
      console.error(`  ❌ problem_test_cases failed:`, tError.message);
    } else {
      console.log(`  ✅ ${testsPayload.length} test cases inserted`);
      successTests++;
    }
  }

  console.log(`\n🎉 Done — content: ${successContent}/27, tests: ${successTests}/27`);
}

insertMissingData()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => {
    process.exit(0);
  });
