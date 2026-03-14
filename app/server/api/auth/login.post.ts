import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '~/server/utils/db'

const JWT_SECRET = process.env.JWT_SECRET || 'bugreel-dev-secret'

interface UserRow {
  id: string
  email: string
  password_hash: string
  created_at: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { email, password } = body || {}

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email and password are required' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined

  if (!user) {
    throw createError({ statusCode: 401, message: 'Invalid email or password' })
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    throw createError({ statusCode: 401, message: 'Invalid email or password' })
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' })

  return {
    token,
    user: { id: user.id, email: user.email },
  }
})
