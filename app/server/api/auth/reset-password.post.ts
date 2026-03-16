import bcrypt from 'bcryptjs'
import { db } from '~/server/utils/db'

interface TokenRow {
  id: string
  user_id: string
  type: string
  token: string
  expires_at: number
  used: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { token, password } = body || {}

  if (!token || typeof token !== 'string') {
    throw createError({ statusCode: 400, message: 'Token is required' })
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  const row = db.prepare(
    'SELECT * FROM email_tokens WHERE token = ? AND type = ?',
  ).get(token, 'password_reset') as TokenRow | undefined

  if (!row) {
    throw createError({ statusCode: 400, message: 'Invalid reset token' })
  }

  if (row.used) {
    throw createError({ statusCode: 400, message: 'Token has already been used' })
  }

  if (Date.now() > row.expires_at) {
    throw createError({ statusCode: 400, message: 'Token has expired' })
  }

  const password_hash = await bcrypt.hash(password, 10)

  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(password_hash, row.user_id)
  db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').run(row.id)

  return { success: true, message: 'Password has been reset successfully' }
})
