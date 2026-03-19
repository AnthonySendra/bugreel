import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  requireReelAccess(reelId, user.id)

  db.prepare('UPDATE reels SET share_token = NULL, share_expires_at = NULL WHERE id = ?')
    .run(reelId)

  return { ok: true }
})
