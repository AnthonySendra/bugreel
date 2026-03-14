import { db } from '~/server/utils/db'

interface WorkspaceRow {
  id: string
  owner_id: string
}

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

  const workspaceId = getRouterParam(event, 'id')

  // Verify workspace belongs to the current user
  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) {
    throw createError({ statusCode: 404, message: 'Workspace not found' })
  }
  if (workspace.owner_id !== user.id) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const reels = db
    .prepare('SELECT id, filename, original_name, size, created_at FROM reels WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as ReelRow[]

  return reels
})
