import { randomUUID, randomBytes } from 'crypto'
import { db } from '~/server/utils/db'
import { isEmailEnabled, sendPasswordResetEmail } from '~/server/utils/email'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { isValidEmail } from '~/server/utils/validate'

interface UserRow {
  id: string
  email: string
}

export default defineEventHandler(async (event) => {
  checkRateLimit(event, { windowMs: 60_000, max: 3 })

  if (!isEmailEnabled()) {
    throw createError({ statusCode: 400, message: 'Email is not configured. Password reset is unavailable.' })
  }

  const body = await readBody(event)
  const { email } = body || {}

  if (!email || typeof email !== 'string') {
    throw createError({ statusCode: 400, message: 'Email is required' })
  }

  if (!isValidEmail(email)) {
    throw createError({ statusCode: 400, message: 'Invalid email address' })
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined

  // Always return success to avoid leaking whether the email exists
  if (!user) {
    return { success: true, message: 'If this email is registered, a password reset link has been sent.' }
  }

  // Invalidate previous reset tokens for this user
  db.prepare('UPDATE email_tokens SET used = 1 WHERE user_id = ? AND type = ? AND used = 0').run(user.id, 'password_reset')

  const token = randomBytes(32).toString('hex')
  const expires_at = Date.now() + 60 * 60 * 1000 // 1 hour

  db.prepare('INSERT INTO email_tokens (id, user_id, type, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    randomUUID(), user.id, 'password_reset', token, expires_at, Date.now(),
  )

  await sendPasswordResetEmail(user.email, token)

  return { success: true, message: 'If this email is registered, a password reset link has been sent.' }
})
