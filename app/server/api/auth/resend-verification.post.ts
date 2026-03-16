import { randomUUID, randomBytes } from 'crypto'
import { db } from '~/server/utils/db'
import { isEmailEnabled, sendVerificationEmail } from '~/server/utils/email'
import { checkRateLimit } from '~/server/utils/rate-limit'

interface UserRow {
  id: string
  email: string
  email_verified: number
}

export default defineEventHandler(async (event) => {
  checkRateLimit(event, { windowMs: 60_000, max: 3 })

  if (!isEmailEnabled()) {
    throw createError({ statusCode: 400, message: 'Email is not configured' })
  }

  const body = await readBody(event)
  const { email } = body || {}

  if (!email || typeof email !== 'string') {
    throw createError({ statusCode: 400, message: 'Email is required' })
  }

  const user = db.prepare('SELECT id, email, email_verified FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined

  // Always return success to avoid leaking whether the email exists
  if (!user || user.email_verified) {
    return { success: true, message: 'If this email is registered, a verification link has been sent.' }
  }

  const token = randomBytes(32).toString('hex')
  const expires_at = Date.now() + 24 * 60 * 60 * 1000

  db.prepare('INSERT INTO email_tokens (id, user_id, type, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(), user.id, 'verification', token, expires_at, Date.now(),
  )

  await sendVerificationEmail(user.email, token)

  return { success: true, message: 'If this email is registered, a verification link has been sent.' }
})
