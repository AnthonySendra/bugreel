import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow {
  id: string
  workspace_id: string
  ticket_provider: string | null
  ticket_config: string | null
}

function maskSecrets(config: Record<string, any>, provider: string): Record<string, any> {
  const masked = { ...config }
  if (provider === 'linear' && masked.apiKey) {
    masked.apiKey = masked.apiKey.length > 4
      ? '****' + masked.apiKey.slice(-4)
      : '****'
  }
  if (provider === 'jira' && masked.apiToken) {
    masked.apiToken = masked.apiToken.length > 4
      ? '****' + masked.apiToken.slice(-4)
      : '****'
  }
  if (provider === 'github' && masked.token) {
    masked.token = masked.token.length > 4
      ? '****' + masked.token.slice(-4)
      : '****'
  }
  return masked
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  const appId = getRouterParam(event, 'appId')!

  requireWorkspaceAccess(workspaceId, user.id)

  const app = db
    .prepare('SELECT id, workspace_id, ticket_provider, ticket_config FROM apps WHERE id = ? AND workspace_id = ?')
    .get(appId, workspaceId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  let config: Record<string, any> | null = null
  if (app.ticket_config) {
    try {
      config = JSON.parse(app.ticket_config)
    } catch {
      config = null
    }
  }

  return {
    provider: app.ticket_provider || null,
    config: config && app.ticket_provider ? maskSecrets(config, app.ticket_provider) : null,
  }
})
