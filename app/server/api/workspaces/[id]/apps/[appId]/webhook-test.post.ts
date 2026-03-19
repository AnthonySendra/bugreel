import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  requireWorkspaceAccess(workspaceId, user.id)

  const appId = getRouterParam(event, 'appId')!
  const app = db
    .prepare('SELECT id, workspace_id, webhook_url FROM apps WHERE id = ?')
    .get(appId) as { id: string; workspace_id: string; webhook_url: string | null } | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })
  if (app.workspace_id !== workspaceId) throw createError({ statusCode: 403, message: 'Forbidden' })
  if (!app.webhook_url) throw createError({ statusCode: 400, message: 'No webhook URL configured' })

  try {
    const res = await fetch(app.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Webhook configured successfully for bugreel',
        event: 'test',
        timestamp: new Date().toISOString(),
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw createError({ statusCode: 502, message: `Webhook returned ${res.status}: ${text.slice(0, 200)}` })
    }
    return { ok: true }
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 502, message: `Failed to reach webhook: ${err.message}` })
  }
})
