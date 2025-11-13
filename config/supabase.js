// config/supabase.js
import { createClient } from '@supabase/supabase-js';

function makeClient(urlEnv, keyEnv) {
  const url = process.env[urlEnv];
  const key = process.env[keyEnv];

  if (!url || !key) {
    throw new Error(`Missing Supabase env vars: ${urlEnv} / ${keyEnv}`);
  }

  return createClient(url, key);
}

// One client per project
export const opastorDb = makeClient(
  'SUPABASE_OPASTOR_URL',
  'SUPABASE_OPASTOR_KEY',
);

export const trailsDb = makeClient(
  'SUPABASE_TRAILS_URL',
  'SUPABASE_TRAILS_KEY',
);

// Optional: for dynamic tenant selection later
export function getDbClient(tenant) {
  switch (tenant) {
    case 'opastor':
      return opastorDb;
    case 'trails':
      return trailsDb;
    default:
      throw new Error(`Unknown tenant: ${tenant}`);
  }
}
