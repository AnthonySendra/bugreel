import { db } from '~/server/utils/db'
import { randomUUID } from 'crypto'
import { sendCommentReplyEmail, sendNewCommentOnReelEmail } from '~/server/utils/email'
import { requireReelAccess } from '~/server/utils/workspace-access'

interface UserRow { id: string; email: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const body = await readBody(event) as { content?: string; timestamp_ms?: number; parent_id?: string; element_info?: string }

  if (!body.content?.trim()) throw createError({ statusCode: 400, message: 'content is required' })
  if (body.content.length > 5000) throw createError({ statusCode: 400, message: 'Comment content must be 5000 characters or fewer' })
  if (body.timestamp_ms == null) throw createError({ statusCode: 400, message: 'timestamp_ms is required' })

  const { reel } = requireReelAccess(reelId, user.id)

  const id = randomUUID()
  const now = Date.now()

  db.prepare(`
    INSERT INTO reel_comments (id, reel_id, parent_id, user_id, timestamp_ms, content, element_info, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, reelId, body.parent_id ?? null, user.id, body.timestamp_ms, body.content.trim(), body.element_info ?? null, now)

  const comment = db.prepare(`
    SELECT c.*, u.email AS author_email
    FROM reel_comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(id) as any

  // ── Notifications (fire-and-forget) ──────────────────────────────────────

  const contentTrimmed = body.content.trim()

  if (body.parent_id) {
    // Reply in a thread → notify all thread participants (except the commenter)
    const threadParticipants = db.prepare(`
      SELECT DISTINCT u.id, u.email
      FROM reel_comments c
      JOIN users u ON c.user_id = u.id
      WHERE (c.id = ? OR c.parent_id = ?)
        AND u.id != ?
    `).all(body.parent_id, body.parent_id, user.id) as UserRow[]

    for (const participant of threadParticipants) {
      sendCommentReplyEmail(participant.email, reelId!, user.email, contentTrimmed).catch(() => {})
    }
  }

  // New comment (reply or top-level) on a reel → notify the reel creator
  if (reel.uploaded_by_user_id && reel.uploaded_by_user_id !== user.id) {
    // Don't double-notify if the reel creator is already in the thread participants
    const alreadyNotified = body.parent_id
      ? db.prepare(`
          SELECT 1 FROM reel_comments
          WHERE (id = ? OR parent_id = ?) AND user_id = ?
        `).get(body.parent_id, body.parent_id, reel.uploaded_by_user_id)
      : null

    if (!alreadyNotified) {
      const reelCreator = db.prepare('SELECT id, email FROM users WHERE id = ?').get(reel.uploaded_by_user_id) as UserRow | undefined
      if (reelCreator) {
        sendNewCommentOnReelEmail(reelCreator.email, reelId!, user.email, contentTrimmed).catch(() => {})
      }
    }
  }

  return comment
})
