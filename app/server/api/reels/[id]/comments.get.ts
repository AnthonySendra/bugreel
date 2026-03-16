import { db } from '~/server/utils/db'

interface ReelRow { id: string; workspace_id: string; app_id: string | null }
interface WorkspaceRow { id: string; owner_id: string }
interface CommentRow {
  id: string
  reel_id: string
  parent_id: string | null
  user_id: string
  timestamp_ms: number
  content: string
  element_info: string | null
  created_at: number
  author_email: string
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')

  const reel = db.prepare('SELECT id, workspace_id, app_id FROM reels WHERE id = ?').get(reelId) as ReelRow | undefined
  if (!reel) throw createError({ statusCode: 404, message: 'Reel not found' })

  const workspaceId = reel.workspace_id
  const workspace = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
  if (!workspace || workspace.owner_id !== user.id) {
    // also allow workspace members
    const member = db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, user.id)
    if (!member) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const comments = db.prepare(`
    SELECT c.*, u.email AS author_email
    FROM reel_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.reel_id = ?
    ORDER BY c.created_at ASC
    LIMIT 500
  `).all(reelId) as CommentRow[]

  return comments.map(c => ({
    id: c.id,
    reel_id: c.reel_id,
    parent_id: c.parent_id,
    user_id: c.user_id,
    author_email: c.author_email,
    timestamp_ms: c.timestamp_ms,
    content: c.content,
    element_info: c.element_info ? JSON.parse(c.element_info) : null,
    created_at: c.created_at,
  }))
})
