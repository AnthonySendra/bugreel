import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface ReelRow {
  id: string
  workspace_id: string
  filename: string
  original_name: string | null
  size: number | null
  created_at: number
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  requireWorkspaceAccess(workspaceId, user.id)

  const reels = db
    .prepare('SELECT id, filename, original_name, size, created_at FROM reels WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as ReelRow[]

  return reels
})
