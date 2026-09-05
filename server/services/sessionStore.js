import { createHash } from 'node:crypto'

const localSessions = new Map()
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function storageConfig() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) return { url, key }
  if (process.env.VERCEL) {
    throw Object.assign(new Error('Configure Supabase server credentials for Spotify sessions.'), {
      code: 'SESSION_STORE_NOT_CONFIGURED', status: 503,
    })
  }
  return null
}

function storageId(kind, id) {
  return `${kind}:${createHash('sha256').update(id).digest('hex')}`
}

async function request(config, query, options = {}) {
  const response = await fetch(`${config.url.replace(/\/$/, '')}/rest/v1/server_sessions${query}`, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    throw Object.assign(new Error('Session storage is unavailable. Check credentials and migrations.'), {
      code: 'SESSION_STORE_UNAVAILABLE', status: 503,
    })
  }
  return response
}

async function read(kind, id, consume = false) {
  if (!id || typeof id !== 'string' || id.length > 256) return null
  const config = storageConfig()
  const key = storageId(kind, id)
  if (!config) {
    const row = localSessions.get(key)
    if (consume || (row && row.expiresAt <= Date.now())) localSessions.delete(key)
    return row && row.expiresAt > Date.now() ? structuredClone(row.data) : null
  }
  const query = new URLSearchParams({ id: `eq.${key}`, expires_at: `gt.${new Date().toISOString()}`, select: 'data' })
  const response = await request(config, `?${query}`, consume ? {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  } : {})
  return (await response.json())[0]?.data || null
}

export const sessionStore = {
  get: (kind, id) => read(kind, id),
  // DELETE ... RETURNING consumes OAuth state once, even across function instances.
  take: (kind, id) => read(kind, id, true),
  async set(kind, id, data, ttl = SESSION_TTL_MS) {
    const config = storageConfig()
    const key = storageId(kind, id)
    const expiresAt = Date.now() + ttl
    if (!config) {
      for (const [storedKey, row] of localSessions) {
        if (row.expiresAt <= Date.now()) localSessions.delete(storedKey)
      }
      localSessions.set(key, { data: structuredClone(data), expiresAt })
      return
    }
    await request(config, '?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: key, data, expires_at: new Date(expiresAt).toISOString() }),
    })
  },
  async delete(kind, id) {
    if (!id) return
    const config = storageConfig()
    const key = storageId(kind, id)
    if (!config) { localSessions.delete(key); return }
    await request(config, `?${new URLSearchParams({ id: `eq.${key}` })}`, { method: 'DELETE' })
  },
}
