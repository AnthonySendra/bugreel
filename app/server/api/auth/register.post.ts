import bcrypt from 'bcryptjs'
import { randomUUID, randomBytes } from 'crypto'
import { db } from '~/server/utils/db'
import { isEmailEnabled, sendVerificationEmail } from '~/server/utils/email'
import { signUserToken } from '~/server/utils/jwt'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { isValidEmail } from '~/server/utils/validate'

export default defineEventHandler(async (event) => {
  checkRateLimit(event, { windowMs: 60_000, max: 5 })

  const body = await readBody(event)
  const { email, password } = body || {}

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid input' })
  }

  if (!isValidEmail(email)) {
    throw createError({ statusCode: 400, message: 'Invalid email address' })
  }

  // Check allowed email domains
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  if (allowedDomains.length > 0) {
    const emailDomain = email.toLowerCase().split('@')[1]
    if (!emailDomain || !allowedDomains.some(d => emailDomain === d || emailDomain.endsWith('.' + d))) {
      throw createError({ statusCode: 403, message: 'Registration is restricted to authorized email domains' })
    }
  }

  if (password.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  if (password.length > 128) {
    throw createError({ statusCode: 400, message: 'Password must be 128 characters or fewer' })
  }

  // Check if email is already taken
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())
  if (existing) {
    throw createError({ statusCode: 409, message: 'Email already registered' })
  }

  const id = randomUUID()
  const password_hash = await bcrypt.hash(password, 10)
  const created_at = Date.now()
  const emailEnabled = isEmailEnabled()
  const email_verified = emailEnabled ? 0 : 1 // auto-verify when email is not configured

  db.prepare('INSERT INTO users (id, email, password_hash, email_verified, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    email.toLowerCase(),
    password_hash,
    email_verified,
    created_at,
  )

  // Send verification email if email is configured
  if (emailEnabled) {
    const token = randomBytes(32).toString('hex')
    const expires_at = Date.now() + 24 * 60 * 60 * 1000 // 24 hours

    db.prepare('INSERT INTO email_tokens (id, user_id, type, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      randomUUID(), id, 'verification', token, expires_at, Date.now(),
    )

    await sendVerificationEmail(email.toLowerCase(), token)
  }

  const jwtToken = signUserToken({ id, email: email.toLowerCase() }, event)

  return {
    token: jwtToken,
    user: { id, email: email.toLowerCase(), email_verified: !!email_verified },
    message: emailEnabled ? 'Please check your email to verify your account.' : undefined,
  }
})
