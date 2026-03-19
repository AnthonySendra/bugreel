import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow {
  id: string
  workspace_id: string
  webhook_url: string | null
  webhook_events: string | null
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  requireWorkspaceAccess(workspaceId, user.id)

  const appId = getRouterParam(event, 'appId')!
  const app = db
    .prepare('SELECT id, workspace_id, webhook_url, webhook_events FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })
  if (app.workspace_id !== workspaceId) throw createError({ statusCode: 403, message: 'Forbidden' })

  let webhookEvents: string[] = []
  if (app.webhook_events) {
    try { webhookEvents = JSON.parse(app.webhook_events) } catch {}
  }

  return {
    webhookUrl: app.webhook_url,
    webhookEvents,
  }
})
