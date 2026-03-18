import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  requireWorkspaceAccess(app.workspace_id, user.id)

  return db.prepare(`
    SELECT t.id, t.name, t.created_at, u.email AS created_by_email
    FROM api_tokens t
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.app_id = ?
    ORDER BY t.created_at DESC
  `).all(appId)
})
