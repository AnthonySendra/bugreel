import { db } from '~/server/utils/db'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const row = db.prepare('SELECT id, email, email_verified FROM users WHERE id = ?').get(user.id) as {
    id: string
    email: string
    email_verified: number
  } | undefined

  if (!row) throw createError({ statusCode: 401, message: 'User not found' })

  return {
    id: row.id,
    email: row.email,
    email_verified: !!row.email_verified,
  }
})
