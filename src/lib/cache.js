// Small cache: memory first, then localStorage, with a time limit per entry.
// Same-key calls made while one is still running share that one request.

const PREFIX = 'gasnet-cache:'
const MAX_STORED = 30 // oldest localStorage entries are removed past this

const memory = new Map() // key -> { value, expires, savedAt }
const pending = new Map() // key -> Promise

function readStored(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStored(key, entry) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry))
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
    if (keys.length > MAX_STORED) {
      keys
        .map((k) => ({ k, savedAt: JSON.parse(localStorage.getItem(k))?.savedAt ?? 0 }))
        .sort((a, b) => a.savedAt - b.savedAt)
        .slice(0, keys.length - MAX_STORED)
        .forEach(({ k }) => localStorage.removeItem(k))
    }
  } catch {
    // storage full or blocked: the memory cache still works
  }
}

// Returns { value, savedAt } for a fresh entry, or null
export function getCached(key) {
  const now = Date.now()
  let entry = memory.get(key)
  if (!entry) {
    entry = readStored(key)
    if (entry) memory.set(key, entry)
  }
  if (!entry) return null
  if (entry.expires <= now) {
    memory.delete(key)
    try {
      localStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
    return null
  }
  return { value: entry.value, savedAt: entry.savedAt }
}

export function setCached(key, value, ttlMs) {
  const entry = { value, savedAt: Date.now(), expires: Date.now() + ttlMs }
  memory.set(key, entry)
  writeStored(key, entry)
}

// Returns { value, savedAt, fromCache }; loader runs only on a miss (or when force is true)
export async function cached(key, ttlMs, loader, { force = false } = {}) {
  if (!force) {
    const hit = getCached(key)
    if (hit) return { ...hit, fromCache: true }
  }
  if (pending.has(key)) return pending.get(key)

  const run = (async () => {
    try {
      const value = await loader()
      setCached(key, value, ttlMs)
      return { value, savedAt: Date.now(), fromCache: false }
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, run)
  return run
}

// Stable short key for any JSON-able data
export async function hashKey(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}
