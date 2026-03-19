import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

  let tags: string[] | null = null
  if (reel.tags) {
    try { tags = JSON.parse(reel.tags) } catch { /* ignore */ }
  }

  return {
    id: reel.id,
    workspace_id: reel.workspace_id,
    app_id: reel.app_id,
    filename: reel.filename,
    original_name: reel.original_name,
    size: reel.size,
    created_at: reel.created_at,
    status: reel.status,
    is_screenshot: reel.is_screenshot,
    assigned_user_id: reel.assigned_user_id,
    tags,
  }
})
