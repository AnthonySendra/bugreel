import { randomUUID } from 'crypto'
import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  requireReelAccess(reelId, user.id)

  const shareToken = randomUUID()

  db.prepare('UPDATE reels SET share_token = ?, share_expires_at = NULL WHERE id = ?')
    .run(shareToken, reelId)

  const baseUrl = getRequestURL(event).origin

  return {
    shareToken,
    shareUrl: `${baseUrl}/share/${shareToken}`,
  }
})
