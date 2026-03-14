import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'

const JWT_SECRET = process.env.JWT_SECRET || 'bugreel-dev-secret'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { email, password } = body || {}

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw createError({ statusCode: 400, message: 'Invalid input' })
  }

  if (password.length < 6) {
    throw createError({ statusCode: 400, message: 'Password must be at least 6 characters' })
  }

  // Check if email is already taken
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())
  if (existing) {
    throw createError({ statusCode: 409, message: 'Email already registered' })
  }

  const id = uuidv4()
  const password_hash = await bcrypt.hash(password, 10)
  const created_at = Date.now()

  db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    email.toLowerCase(),
    password_hash,
    created_at,
  )

  const token = jwt.sign({ id, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' })

  return {
    token,
    user: { id, email: email.toLowerCase() },
  }
})
