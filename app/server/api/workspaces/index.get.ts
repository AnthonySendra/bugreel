import { db } from '~/server/utils/db'

interface WorkspaceRow {
  id: string
  owner_id: string
  name: string
  created_at: number
  role: string
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaces = db
    .prepare(`
      SELECT id, name, created_at, 'owner' as role FROM workspaces WHERE owner_id = ?
      UNION ALL
      SELECT w.id, w.name, w.created_at, 'member' as role FROM workspaces w
      INNER JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id = ?
      ORDER BY created_at DESC
    `)
    .all(user.id, user.id) as WorkspaceRow[]

  return workspaces
})
