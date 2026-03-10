const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Check entry_point and first few test cases for design problems
  const designIds = [146, 155, 208, 211, 295, 355, 703, 981, 460, 716, 731, 911, 1244, 2013, 715];
  
  for (const id of designIds) {
    const { data: content } = await sb
      .from('problem_content')
      .select('problem_lc, title, entry_point')
      .eq('problem_lc', id)
      .single();
    
    const { data: tests } = await sb
      .from('problem_test_cases')
      .select('id, sort_order, input_text, expected_output')
      .eq('problem_lc', id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(2);
    
    console.log('---');
    console.log(`LC ${id} | ${content?.title} | entry: ${content?.entry_point}`);
    console.log(`  test_cases count fetched: ${tests?.length ?? 0}`);
    if (tests && tests[0]) {
      console.log(`  tc[0].input (200c): ${String(tests[0].input_text).slice(0, 200)}`);
      console.log(`  tc[0].expected (200c): ${String(tests[0].expected_output).slice(0, 200)}`);
    }
  }

  // Also check a known working regular problem for comparison
  const { data: regContent } = await sb.from('problem_content').select('problem_lc, title, entry_point').eq('problem_lc', 1).single();
  const { data: regTests } = await sb.from('problem_test_cases').select('id, sort_order, input_text, expected_output').eq('problem_lc', 1).eq('is_active', true).order('sort_order', { ascending: true }).limit(2);
  console.log('\n=== COMPARISON: Regular problem ===');
  console.log(`LC 1 | ${regContent?.title} | entry: ${regContent?.entry_point}`);
  if (regTests && regTests[0]) {
    console.log(`  tc[0].input: ${String(regTests[0].input_text).slice(0, 200)}`);
    console.log(`  tc[0].expected: ${String(regTests[0].expected_output).slice(0, 200)}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
