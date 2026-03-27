import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'
import { validatePublicUrl } from '~/server/utils/url-validator'

interface AppRow {
  id: string
  workspace_id: string
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  const appId = getRouterParam(event, 'appId')!

  requireWorkspaceAccess(workspaceId, user.id)

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ? AND workspace_id = ?')
    .get(appId, workspaceId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  const body = await readBody(event)
  const provider = body?.provider ?? null

  // Clear integration
  if (provider === null) {
    db.prepare('UPDATE apps SET ticket_provider = NULL, ticket_config = NULL WHERE id = ?').run(appId)
    return { provider: null, config: null }
  }

  if (provider !== 'linear' && provider !== 'jira' && provider !== 'github') {
    throw createError({ statusCode: 400, message: 'Provider must be "linear", "jira", "github", or null' })
  }

  const config = body?.config
  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, message: 'config is required' })
  }

  // Validate required fields per provider
  if (provider === 'linear') {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw createError({ statusCode: 400, message: 'config.apiKey is required for Linear' })
    }
    if (!config.teamId || typeof config.teamId !== 'string') {
      throw createError({ statusCode: 400, message: 'config.teamId is required for Linear' })
    }
  }

  if (provider === 'jira') {
    if (!config.siteUrl || typeof config.siteUrl !== 'string') {
      throw createError({ statusCode: 400, message: 'config.siteUrl is required for Jira' })
    }
    try {
      await validatePublicUrl(config.siteUrl)
    } catch (e: any) {
      throw createError({ statusCode: 400, message: e.message || 'Invalid Jira site URL' })
    }
    if (!config.email || typeof config.email !== 'string') {
      throw createError({ statusCode: 400, message: 'config.email is required for Jira' })
    }
    if (!config.apiToken || typeof config.apiToken !== 'string') {
      throw createError({ statusCode: 400, message: 'config.apiToken is required for Jira' })
    }
    if (!config.projectKey || typeof config.projectKey !== 'string') {
      throw createError({ statusCode: 400, message: 'config.projectKey is required for Jira' })
    }
  }

  if (provider === 'github') {
    if (!config.token || typeof config.token !== 'string') {
      throw createError({ statusCode: 400, message: 'config.token is required for GitHub' })
    }
    if (!config.owner || typeof config.owner !== 'string') {
      throw createError({ statusCode: 400, message: 'config.owner is required for GitHub' })
    }
    if (!config.repo || typeof config.repo !== 'string') {
      throw createError({ statusCode: 400, message: 'config.repo is required for GitHub' })
    }
  }

  const configJson = JSON.stringify(config)

  db.prepare('UPDATE apps SET ticket_provider = ?, ticket_config = ? WHERE id = ?').run(provider, configJson, appId)

  return { provider }
})
