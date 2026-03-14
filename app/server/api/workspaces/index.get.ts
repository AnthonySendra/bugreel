import { db } from '~/server/utils/db'

interface WorkspaceRow {
  id: string
  owner_id: string
  name: string
  created_at: number
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaces = db
    .prepare('SELECT id, name, created_at FROM workspaces WHERE owner_id = ? ORDER BY created_at DESC')
    .all(user.id) as WorkspaceRow[]

  return workspaces
})
