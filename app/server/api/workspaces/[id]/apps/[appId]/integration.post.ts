import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

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
  const provider = body?.provider

  if (!provider || (provider !== 'linear' && provider !== 'jira')) {
    throw createError({ statusCode: 400, message: 'provider must be "linear" or "jira"' })
  }

  const config = body?.config
  if (!config || typeof config !== 'object') {
    throw createError({ statusCode: 400, message: 'config is required' })
  }

  if (provider === 'linear') {
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      throw createError({ statusCode: 400, message: 'config.apiKey is required' })
    }

    try {
      const response = await $fetch<any>('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.apiKey,
        },
        body: {
          query: '{ teams { nodes { id name } } }',
        },
      })

      if (response.errors) {
        return { ok: false, error: response.errors[0]?.message || 'Linear API error' }
      }

      const teams = response.data?.teams?.nodes || []
      return { ok: true, teams }
    } catch (err: any) {
      const msg = err?.data?.errors?.[0]?.message || err?.data?.message || err?.message || 'Failed to connect to Linear'
      return { ok: false, error: msg }
    }
  }

  if (provider === 'jira') {
    if (!config.siteUrl || !config.email || !config.apiToken) {
      throw createError({ statusCode: 400, message: 'siteUrl, email, and apiToken are required' })
    }

    const siteUrl = config.siteUrl.replace(/\/+$/, '')
    const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')

    try {
      const projects = await $fetch<any>(`${siteUrl}/rest/api/3/project`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Accept': 'application/json',
        },
      })

      const projectList = Array.isArray(projects)
        ? projects.map((p: any) => ({ id: p.id, key: p.key, name: p.name }))
        : []

      // Fetch issue types via createmeta so we know which ones are valid
      let issueTypes: { id: string; name: string }[] = []
      if (config.projectKey) {
        try {
          const meta = await $fetch<any>(`${siteUrl}/rest/api/3/issue/createmeta/${config.projectKey}/issuetypes`, {
            headers: { 'Authorization': `Basic ${basicAuth}`, 'Accept': 'application/json' },
          })
          if (meta?.issueTypes || meta?.values) {
            issueTypes = (meta.issueTypes || meta.values).map((t: any) => ({ id: t.id, name: t.name }))
          }
        } catch {
          // Fallback: try older API
          try {
            const types = await $fetch<any>(`${siteUrl}/rest/api/3/issuetype`, {
              headers: { 'Authorization': `Basic ${basicAuth}`, 'Accept': 'application/json' },
            })
            if (Array.isArray(types)) {
              issueTypes = types.map((t: any) => ({ id: t.id, name: t.name }))
            }
          } catch { /* ignore */ }
        }
      }

      return { ok: true, projects: projectList, issueTypes }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Failed to connect to Jira' }
    }
  }
})
