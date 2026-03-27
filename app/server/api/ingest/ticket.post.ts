/**
 * POST /api/ingest/ticket?token=TOKEN
 *
 * Create a ticket in the configured provider for a given reel.
 * Auth via API token (SDK use).
 */
import { db } from '~/server/utils/db'
import { validateIngestAuth } from '~/server/utils/ingest-auth'

interface AppRow {
  id: string
  workspace_id: string
  ticket_provider: string | null
  ticket_config: string | null
}

interface ReelRow {
  id: string
  app_id: string | null
}

export default defineEventHandler(async (event) => {
  const { app: ingestApp } = validateIngestAuth(event)

  const body = await readBody(event)
  if (!body?.reelId || typeof body.reelId !== 'string') {
    throw createError({ statusCode: 400, message: 'reelId is required' })
  }
  if (!body?.title || typeof body.title !== 'string') {
    throw createError({ statusCode: 400, message: 'title is required' })
  }

  const reelId = body.reelId
  const title = body.title
  const description = body.description || ''

  // Verify reel exists and belongs to this app
  const reel = db
    .prepare('SELECT id, app_id FROM reels WHERE id = ?')
    .get(reelId) as ReelRow | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Reel not found' })
  if (reel.app_id !== ingestApp.id) {
    throw createError({ statusCode: 403, message: 'Reel does not belong to this app' })
  }

  // Get app integration config
  const app = db
    .prepare('SELECT id, workspace_id, ticket_provider, ticket_config FROM apps WHERE id = ?')
    .get(ingestApp.id) as AppRow | undefined

  if (!app || !app.ticket_provider || !app.ticket_config) {
    throw createError({ statusCode: 400, message: 'No ticket integration configured for this app' })
  }

  let config: Record<string, any>
  try {
    config = JSON.parse(app.ticket_config)
  } catch {
    throw createError({ statusCode: 500, message: 'Invalid integration config' })
  }

  const runtimeConfig = useRuntimeConfig()
  const publicBaseUrl = runtimeConfig.public?.baseUrl || 'http://localhost:7777'
  const reelUrl = `${publicBaseUrl}/reel/${reelId}`

  const fullDescription = description
    ? `${description}\n\nReel: ${reelUrl}`
    : `Reel: ${reelUrl}`

  let ticketId: string
  let ticketUrl: string

  if (app.ticket_provider === 'linear') {
    if (!config.apiKey || !config.teamId) {
      throw createError({ statusCode: 500, message: 'Linear integration is misconfigured' })
    }

    try {
      const response = await $fetch<any>('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.apiKey,
        },
        body: {
          query: `mutation IssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                url
              }
            }
          }`,
          variables: {
            input: {
              teamId: config.teamId,
              title,
              description: fullDescription,
            },
          },
        },
      })

      if (response.errors || !response.data?.issueCreate?.success) {
        const errMsg = response.errors?.[0]?.message || 'Failed to create Linear issue'
        throw createError({ statusCode: 502, message: errMsg })
      }

      const issue = response.data.issueCreate.issue
      ticketId = issue.identifier || issue.id
      ticketUrl = issue.url
    } catch (err: any) {
      if (err.statusCode) throw err
      throw createError({ statusCode: 502, message: err.message || 'Failed to create Linear issue' })
    }
  } else if (app.ticket_provider === 'jira') {
    if (!config.siteUrl || !config.email || !config.apiToken || !config.projectKey) {
      throw createError({ statusCode: 500, message: 'Jira integration is misconfigured' })
    }

    const siteUrl = config.siteUrl.replace(/\/+$/, '')
    const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
    const jiraHeaders = { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Resolve issue type: use configured ID, or auto-detect from project
    let issueTypeField: { id: string } | { name: string }
    if (config.issueTypeId) {
      issueTypeField = { id: config.issueTypeId }
    } else {
      // Try to find a valid issue type for the project
      try {
        const meta = await $fetch<any>(`${siteUrl}/rest/api/3/issue/createmeta/${config.projectKey}/issuetypes`, { headers: jiraHeaders })
        const types = meta?.issueTypes || meta?.values || []
        const bug = types.find((t: any) => t.name?.toLowerCase() === 'bug')
        const first = types[0]
        issueTypeField = bug ? { id: bug.id } : first ? { id: first.id } : { name: 'Task' }
      } catch {
        issueTypeField = { name: 'Task' }
      }
    }

    try {
      const response = await $fetch<any>(`${siteUrl}/rest/api/3/issue`, {
        method: 'POST',
        headers: jiraHeaders,
        body: {
          fields: {
            project: { key: config.projectKey },
            summary: title,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: fullDescription }],
                },
              ],
            },
            issuetype: issueTypeField,
          },
        },
      })

      ticketId = response.key || response.id
      ticketUrl = `${siteUrl}/browse/${response.key}`
    } catch (err: any) {
      if (err.statusCode) throw err
      throw createError({ statusCode: 502, message: err.message || 'Failed to create Jira issue' })
    }
  } else if (app.ticket_provider === 'github') {
    if (!config.token || !config.owner || !config.repo) {
      throw createError({ statusCode: 500, message: 'GitHub integration is misconfigured' })
    }

    try {
      const response = await $fetch<any>(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: {
          title,
          body: fullDescription,
        },
      })

      ticketId = `#${response.number}`
      ticketUrl = response.html_url
    } catch (err: any) {
      if (err.statusCode) throw err
      throw createError({ statusCode: 502, message: err.message || 'Failed to create GitHub issue' })
    }
  } else {
    throw createError({ statusCode: 400, message: `Unsupported provider: ${app.ticket_provider}` })
  }

  // Update reel with ticket info
  db.prepare('UPDATE reels SET ticket_id = ?, ticket_url = ?, original_name = ? WHERE id = ?').run(ticketId, ticketUrl, `${ticketId} - ${title}`, reelId)

  return { ticketId, ticketUrl }
})
