import { db } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')
  const workspace = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  return db.prepare(`
    SELECT t.id, t.name, t.token, t.created_at, u.email AS created_by_email
    FROM api_tokens t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.workspace_id = ?
    ORDER BY t.created_at DESC
  `).all(workspaceId)
})
