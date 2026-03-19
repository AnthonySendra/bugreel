import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'
import { validatePublicUrl } from '~/server/utils/url-validator'

const VALID_EVENTS = ['new_reel', 'new_comment', 'reel_done']

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  requireWorkspaceAccess(workspaceId, user.id)

  const appId = getRouterParam(event, 'appId')!
  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as { id: string; workspace_id: string } | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })
  if (app.workspace_id !== workspaceId) throw createError({ statusCode: 403, message: 'Forbidden' })

  const body = await readBody(event) as { url?: string | null; events?: string[] }

  if (body.url === null || body.url === undefined) {
    // Clear webhook config
    db.prepare('UPDATE apps SET webhook_url = NULL, webhook_events = NULL WHERE id = ?')
      .run(appId)
    return { ok: true }
  }

  if (typeof body.url !== 'string' || (!body.url.startsWith('http://') && !body.url.startsWith('https://'))) {
    throw createError({ statusCode: 400, message: 'url must start with http:// or https://' })
  }

  try {
    await validatePublicUrl(body.url)
  } catch (e: any) {
    throw createError({ statusCode: 400, message: e.message || 'Invalid webhook URL' })
  }

  if (!Array.isArray(body.events)) {
    throw createError({ statusCode: 400, message: 'events must be an array' })
  }

  for (const ev of body.events) {
    if (!VALID_EVENTS.includes(ev)) {
      throw createError({ statusCode: 400, message: `Invalid event: ${ev}. Valid events: ${VALID_EVENTS.join(', ')}` })
    }
  }

  db.prepare('UPDATE apps SET webhook_url = ?, webhook_events = ? WHERE id = ?')
    .run(body.url, JSON.stringify(body.events), appId)

  return { ok: true }
})
