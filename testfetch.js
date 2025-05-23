import fetch from 'node-fetch';

const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56YXZvcnBvb3NtYW9uYmV2Y21iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMDQ5MjgsImV4cCI6MjA2MzU4MDkyOH0.F8i58PrdUWYBblz_qjzJcEnNTbdXzbxtKKBJizSpAqE';

async function test() {
  try {
    const res = await fetch('https://nzavorpoosmaonbevcmb.supabase.co/rest/v1/cows', {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    console.log(data);
  } catch (err) {
    console.error('Fetch test error:', err);
  }
}

test();
