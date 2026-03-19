import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface MemberRow {
  id: string
  email: string
  role: 'owner' | 'member'
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  const { workspace } = requireWorkspaceAccess(workspaceId, user.id)

  const result: MemberRow[] = []

  const owner = db.prepare('SELECT id, email FROM users WHERE id = ?').get(workspace.owner_id) as { id: string; email: string } | undefined
  if (owner) {
    result.push({ id: owner.id, email: owner.email, role: 'owner' })
  }

  const members = db.prepare(`
    SELECT u.id, u.email
    FROM workspace_members wm
    JOIN users u ON wm.user_id = u.id
    WHERE wm.workspace_id = ?
    ORDER BY wm.created_at ASC
  `).all(workspaceId) as { id: string; email: string }[]

  for (const m of members) {
    result.push({ id: m.id, email: m.email, role: 'member' })
  }

  return result
})
