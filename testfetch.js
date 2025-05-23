import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function testSupabase() {
  try {
    const { data, error } = await supabase.from('cows').select('*');
    if (error) {
      console.error('Supabase error:', error);
      return;
    }
    console.log('Data:', data);
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

testSupabase();