import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

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

  const reelId = getRouterParam(event, 'id')!
  requireReelAccess(reelId, user.id)

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
