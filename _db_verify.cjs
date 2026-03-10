const { createClient } = require('@supabase/supabase-js');
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

async function main() {
  // QUERY 1: Every problems row has matching content for BOTH nc_lc and cp_lc
  console.log('═══ QUERY 1: problems rows missing problem_content ═══');

  const { data: problems } = await supabase.from('problems').select('nc_lc, nc_title, cp_lc, cp_title');
  const { data: content } = await supabase.from('problem_content').select('problem_lc, title, difficulty, problem_description, starter_code, entry_point, input_output, source');
  const { data: testCases } = await supabase.from('problem_test_cases').select('problem_lc, input_text, expected_output, sort_order');

  const contentMap = new Map();
  for (const c of content) contentMap.set(c.problem_lc, c);

  const missingContent = [];
  for (const p of problems) {
    if (!contentMap.has(p.nc_lc)) missingContent.push({ lc: p.nc_lc, title: p.nc_title, side: 'neetcode' });
    if (!contentMap.has(p.cp_lc)) missingContent.push({ lc: p.cp_lc, title: p.cp_title, side: 'companion' });
  }
  if (missingContent.length === 0) {
    console.log('  ✅ All problems rows have matching problem_content for both nc_lc and cp_lc');
  } else {
    console.log(`  ❌ ${missingContent.length} missing:`);
    for (const m of missingContent) console.log(`    LC ${m.lc} (${m.title}) - ${m.side}`);
  }

  // QUERY 2: Titles match between problems and problem_content
  console.log('\n═══ QUERY 2: Title mismatches between problems and problem_content ═══');
  const titleMismatches = [];
  for (const p of problems) {
    const ncContent = contentMap.get(p.nc_lc);
    if (ncContent && ncContent.title !== p.nc_title) {
      titleMismatches.push({ lc: p.nc_lc, problemsTitle: p.nc_title, contentTitle: ncContent.title, side: 'neetcode' });
    }
    const cpContent = contentMap.get(p.cp_lc);
    if (cpContent && cpContent.title !== p.cp_title) {
      titleMismatches.push({ lc: p.cp_lc, problemsTitle: p.cp_title, contentTitle: cpContent.title, side: 'companion' });
    }
  }
  if (titleMismatches.length === 0) {
    console.log('  ✅ All titles match');
  } else {
    console.log(`  ⚠️  ${titleMismatches.length} title mismatches:`);
    for (const m of titleMismatches) {
      console.log(`    LC ${m.lc} (${m.side}): problems="${m.problemsTitle}" vs content="${m.contentTitle}"`);
    }
  }

  // QUERY 3: test_cases count matches input_output array length
  console.log('\n═══ QUERY 3: test_cases count vs input_output length ═══');
  const tcCounts = {};
  for (const t of testCases) tcCounts[t.problem_lc] = (tcCounts[t.problem_lc] || 0) + 1;

  const countMismatches = [];
  for (const c of content) {
    const ioLen = Array.isArray(c.input_output) ? c.input_output.length : 0;
    const tcCount = tcCounts[c.problem_lc] || 0;
    if (ioLen !== tcCount) {
      countMismatches.push({ lc: c.problem_lc, title: c.title, ioLen, tcCount, diff: ioLen - tcCount });
    }
  }
  if (countMismatches.length === 0) {
    console.log('  ✅ All test_cases counts match input_output lengths');
  } else {
    console.log(`  ⚠️  ${countMismatches.length} count mismatches:`);
    for (const m of countMismatches.sort((a,b) => a.lc - b.lc)) {
      console.log(`    LC ${m.lc} (${m.title}): input_output=${m.ioLen}, test_cases=${m.tcCount}, diff=${m.diff}`);
    }
  }

  // QUERY 4: Spot check first test case per problem matches input_output[0]
  console.log('\n═══ QUERY 4: First test case data matches input_output[0] ═══');
  // Build map of sort_order=1 test cases
  const firstTests = {};
  for (const t of testCases) {
    if (t.sort_order === 1) firstTests[t.problem_lc] = t;
  }

  const dataMismatches = [];
  for (const c of content) {
    if (!Array.isArray(c.input_output) || c.input_output.length === 0) continue;
    const ioFirst = c.input_output[0];
    const tc = firstTests[c.problem_lc];
    if (!tc) continue;

    const ioInput = ioFirst.input || '';
    const ioOutput = ioFirst.output || '';
    
    if (ioInput !== tc.input_text || ioOutput !== tc.expected_output) {
      dataMismatches.push({
        lc: c.problem_lc,
        title: c.title,
        ioInput: String(ioInput).slice(0, 80),
        tcInput: String(tc.input_text).slice(0, 80),
        ioOutput: String(ioOutput).slice(0, 80),
        tcOutput: String(tc.expected_output).slice(0, 80),
        inputMatch: ioInput === tc.input_text,
        outputMatch: ioOutput === tc.expected_output,
      });
    }
  }
  if (dataMismatches.length === 0) {
    console.log('  ✅ All first test cases match input_output[0]');
  } else {
    console.log(`  ⚠️  ${dataMismatches.length} data mismatches:`);
    for (const m of dataMismatches.sort((a,b) => a.lc - b.lc).slice(0, 30)) {
      console.log(`    LC ${m.lc} (${m.title}):`);
      if (!m.inputMatch) {
        console.log(`      input_output: "${m.ioInput}"`);
        console.log(`      test_case:    "${m.tcInput}"`);
      }
      if (!m.outputMatch) {
        console.log(`      io_output:    "${m.ioOutput}"`);
        console.log(`      tc_output:    "${m.tcOutput}"`);
      }
    }
    if (dataMismatches.length > 30) console.log(`    ... and ${dataMismatches.length - 30} more`);
  }

  // QUERY 5: Orphaned test_cases
  console.log('\n═══ QUERY 5: Orphaned test_cases (no matching problem) ═══');
  const allLcIds = new Set();
  for (const p of problems) { allLcIds.add(p.nc_lc); allLcIds.add(p.cp_lc); }
  const orphanedLcs = new Set();
  for (const t of testCases) {
    if (!allLcIds.has(t.problem_lc)) orphanedLcs.add(t.problem_lc);
  }
  if (orphanedLcs.size === 0) {
    console.log('  ✅ No orphaned test cases');
  } else {
    console.log(`  ❌ ${orphanedLcs.size} orphaned problem_lc values:`, [...orphanedLcs]);
  }

  // QUERY 6: Difficulty check - does problem_content.difficulty match what's in DB?
  console.log('\n═══ QUERY 6: Column completeness in problem_content ═══');
  let nulls = { title: 0, difficulty: 0, description: 0, starter: 0, entry: 0, io: 0 };
  for (const c of content) {
    if (!c.title) nulls.title++;
    if (!c.difficulty) nulls.difficulty++;
    if (!c.problem_description?.trim()) nulls.description++;
    if (!c.starter_code?.trim()) nulls.starter++;
    if (!c.entry_point?.trim()) nulls.entry++;
    if (!c.input_output || (Array.isArray(c.input_output) && c.input_output.length === 0)) nulls.io++;
  }
  const hasNulls = Object.values(nulls).some(v => v > 0);
  if (!hasNulls) {
    console.log('  ✅ All columns fully populated across 300 rows');
  } else {
    for (const [k, v] of Object.entries(nulls)) {
      if (v > 0) console.log(`  ❌ ${k}: ${v} empty/null`);
    }
  }
}

main().catch(e => console.error('Fatal:', e)).finally(() => process.exit(0));
