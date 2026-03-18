import jwt from 'jsonwebtoken'
import { getJwtSecret } from '~/server/utils/jwt'
import { db } from '~/server/utils/db'
import { isEmailEnabled } from '~/server/utils/email'

export default defineEventHandler((event) => {
  // Initialize user context as null
  event.context.user = null

  // Try Authorization header first
  const authHeader = getHeader(event, 'authorization')
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // Fall back to ?token query param for extension compatibility
    const query = getQuery(event)
    if (query.token && typeof query.token === 'string') {
      token = query.token
    }
  }

  if (!token) return

  try {
    const payload = jwt.verify(token, getJwtSecret(event)) as { id: string; email: string }
    event.context.user = { id: payload.id, email: payload.email }
  } catch {
    // Invalid or expired token — leave context.user as null
    return
  }

  // Enforce email verification on protected API routes
  const path = getRequestURL(event).pathname
  if (!isEmailEnabled()) return
  if (!event.context.user) return
  // Allow auth routes (login, register, verify, resend, me) and ingest routes
  if (path.startsWith('/api/auth/') || path.startsWith('/api/ingest/') || path.startsWith('/api/recorder-lib/')) return

  // Only guard /api/* routes
  if (!path.startsWith('/api/')) return

  const row = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(event.context.user.id) as { email_verified: number } | undefined
  if (!row || !row.email_verified) {
    throw createError({ statusCode: 403, statusMessage: 'email_not_verified', message: 'Please verify your email before continuing.' })
  }
})
