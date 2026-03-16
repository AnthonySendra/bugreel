import { db } from '~/server/utils/db'

interface ReelRow {
  id: string
  workspace_id: string
  app_id: string | null
  filename: string
  original_name: string | null
  size: number | null
  created_at: number
  // joined
  app_workspace_id: string | null
}

interface WorkspaceRow {
  id: string
  owner_id: string
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')

  const reel = db
    .prepare('SELECT r.*, a.workspace_id AS app_workspace_id FROM reels r LEFT JOIN apps a ON r.app_id = a.id WHERE r.id = ?')
    .get(reelId) as ReelRow | undefined

  if (!reel) {
    throw createError({ statusCode: 404, message: 'Reel not found' })
  }

  // Use the workspace_id from the app join if available, otherwise fall back to reel.workspace_id (legacy)
  const workspaceId = reel.app_workspace_id || reel.workspace_id

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace || workspace.owner_id !== user.id) {
    const member = db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, user.id)
    if (!member) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  return {
    id: reel.id,
    workspace_id: reel.workspace_id,
    app_id: reel.app_id,
    filename: reel.filename,
    original_name: reel.original_name,
    size: reel.size,
    created_at: reel.created_at,
  }
})
