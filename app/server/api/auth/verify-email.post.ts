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
  const { token } = body || {}

  if (!token || typeof token !== 'string') {
    throw createError({ statusCode: 400, message: 'Token is required' })
  }

  const row = db.prepare(
    'SELECT * FROM email_tokens WHERE token = ? AND type = ?',
  ).get(token, 'verification') as TokenRow | undefined

  if (!row) {
    throw createError({ statusCode: 400, message: 'Invalid verification token' })
  }

  if (row.used) {
    throw createError({ statusCode: 400, message: 'Token has already been used' })
  }

  if (Date.now() > row.expires_at) {
    throw createError({ statusCode: 400, message: 'Token has expired' })
  }

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id)
  db.prepare('UPDATE email_tokens SET used = 1 WHERE id = ?').run(row.id)

  return { success: true, message: 'Email verified successfully' }
})
