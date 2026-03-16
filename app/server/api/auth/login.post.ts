import bcrypt from 'bcryptjs'
import { db } from '~/server/utils/db'
import { isEmailEnabled } from '~/server/utils/email'
import { signUserToken } from '~/server/utils/jwt'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { isValidEmail } from '~/server/utils/validate'

interface UserRow {
  id: string
  email: string
  password_hash: string
  email_verified: number
  created_at: number
}

export default defineEventHandler(async (event) => {
  checkRateLimit(event, { windowMs: 60_000, max: 10 })

  const body = await readBody(event)
  const { email, password } = body || {}

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  if (typeof email !== 'string' || !isValidEmail(email)) {
    throw createError({ statusCode: 400, message: 'Invalid email address' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined

  if (!user) {
    throw createError({ statusCode: 401, message: 'Invalid email or password' })
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    throw createError({ statusCode: 401, message: 'Invalid email or password' })
  }

  // Block login if email verification is required and not verified
  if (isEmailEnabled() && !user.email_verified) {
    throw createError({ statusCode: 403, message: 'Please verify your email before logging in.' })
  }

  const token = signUserToken({ id: user.id, email: user.email }, event)

  return {
    token,
    user: { id: user.id, email: user.email, email_verified: !!user.email_verified },
  }
})
