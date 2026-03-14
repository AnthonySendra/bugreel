import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const body = await readBody(event)
  const { name } = body || {}

  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, message: 'Workspace name is required' })
  }

  const id = uuidv4()
  const created_at = Date.now()

  db.prepare('INSERT INTO workspaces (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    user.id,
    name.trim(),
    created_at,
  )

  return { id, name: name.trim(), created_at }
})
