// Supabase client setup for Musync.
//
// Credentials are injected into `/src/supabase/config.js` by the dev server
// (server.js reads them from the .env file / environment). When no credentials
// are present the app runs in a degraded local-only mode.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

let client = null
let clientPromise = null

export function getSupabase() {
  if (client) return client
  if (!isSupabaseConfigured) return null
  // https://esm.sh/@supabase/supabase-js@2 — same CDN convention as React.
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => {
      client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 10 } },
      })
      return client
    }).catch((error) => {
      clientPromise = null
      throw error
    })
  }
  return clientPromise
}

export async function ensureSupabase() {
  const sb = await getSupabase()
  if (!sb) throw new Error('SUPABASE_NOT_CONFIGURED')
  return sb
}
