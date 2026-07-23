import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in an untracked environment before running this diagnostic.')
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function check() {
  console.log('Starting DB query...')
  const { data: problems, error: pError } = await supabase.from('problems').select('*').limit(1)
  console.log('Fetched problems:', problems ? problems.length : 0)
  if (pError) console.error('Error:', pError.message)
}

check().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
