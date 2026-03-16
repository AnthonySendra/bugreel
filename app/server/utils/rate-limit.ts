import type { H3Event } from 'h3'

const store = new Map<string, { count: number; resetAt: number }>()
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  // Only cleanup every 60s
  if (now - lastCleanup < 60_000) return
  lastCleanup = now
  for (const [key, val] of store) {
    if (now > val.resetAt) store.delete(key)
  }
}

export function checkRateLimit(event: H3Event, opts: { windowMs: number; max: number }) {
  cleanup()

  const ip = getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim()
    || getRequestIP(event)
    || 'unknown'
  const key = `${ip}:${event.path}`
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + opts.windowMs })
    return
  }

  entry.count++
  if (entry.count > opts.max) {
    throw createError({ statusCode: 429, message: 'Too many requests. Please try again later.' })
  }
}
