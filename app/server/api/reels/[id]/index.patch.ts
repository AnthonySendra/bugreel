import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  requireReelAccess(reelId, user.id)

  const body = await readBody(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, message: 'name is required' })

  db.prepare('UPDATE reels SET original_name = ? WHERE id = ?').run(name, reelId)

  return { ok: true }
})
