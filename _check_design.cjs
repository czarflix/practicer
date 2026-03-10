const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

const ids = [146, 155, 208, 211, 295, 355, 460, 703, 716, 731, 911, 981, 1244, 2013, 133, 138, 142, 117, 235, 271, 285, 297, 372, 430, 449, 652, 715];

async function main() {
  try {
    const { data, error } = await sb.from('problem_content').select('problem_lc, title, entry_point, input_output').in('problem_lc', ids);
    if (error) { console.error('DB error:', error); process.exit(1); }
    if (!data) { console.error('No data returned'); process.exit(1); }
    console.log('Got', data.length, 'rows');
    for (const d of data.sort((a, b) => a.problem_lc - b.problem_lc)) {
      const io0 = d.input_output?.[0];
      console.log('---');
      console.log('LC', d.problem_lc, d.title);
      console.log('  entry_point:', d.entry_point);
      console.log('  io count:', d.input_output?.length);
      console.log('  io[0].input:', JSON.stringify(io0?.input || '').slice(0, 300));
      console.log('  io[0].output:', JSON.stringify(io0?.output || '').slice(0, 300));
    }
  } catch (e) {
    console.error('Exception:', e.message);
  }
  process.exit(0);
}
main();
