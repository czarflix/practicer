import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fjulxsdwycrmtamwfjxx.supabase.co'
const supabaseKey = 'sb_publishable_NWfoNa72lCviGjpP7ScS4w_DFIqEkIZ'
const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  console.log("Starting DB query...");
  
  const { data: problems, error: pError } = await supabase.from('problems').select('*');
  console.log("Fetched problems count:", problems ? problems.length : 0);
  if (pError) console.error("Error:", pError);
  
  const { data: content, error: cError } = await supabase.from('problem_content').select('*');
  console.log("Fetched content count:", content ? content.length : 0);
  if (cError) console.error("Error:", cError);
  
  const { data: tests, error: tError } = await supabase.from('problem_test_cases').select('*');
  console.log("Fetched tests count:", tests ? tests.length : 0);
  if (tError) console.error("Error:", tError);
}

check().catch(console.error);
