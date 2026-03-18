import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  requireWorkspaceAccess(workspaceId, user.id)

  const apps = db
    .prepare('SELECT id, name, created_at FROM apps WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId)

  return apps
})
