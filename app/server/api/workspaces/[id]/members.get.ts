import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  const { workspace } = requireWorkspaceAccess(workspaceId, user.id)

  const owner = db.prepare('SELECT id, email FROM users WHERE id = ?').get(workspace.owner_id) as { id: string; email: string }

  const members = db.prepare(`
    SELECT u.id, u.email, wm.created_at
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    WHERE wm.workspace_id = ?
    ORDER BY wm.created_at ASC
  `).all(workspaceId)

  return { owner, members }
})
