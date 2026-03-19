/**
 * POST /api/reels/[id]/done
 *
 * Mark a reel as done and optionally close its linked ticket.
 * Auth via JWT (dashboard use).
 */
import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'
import { sendWebhook } from '~/server/utils/webhook'

interface AppRow {
  id: string
  workspace_id: string
  ticket_provider: string | null
  ticket_config: string | null
}

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

  // Update reel status to done
  db.prepare('UPDATE reels SET status = \'done\' WHERE id = ?').run(reelId)

  let ticketClosed = false

  // If the reel has a linked ticket, try to close it on the provider
  if (reel.ticket_id && reel.ticket_url && reel.app_id) {
    const app = db
      .prepare('SELECT id, workspace_id, ticket_provider, ticket_config FROM apps WHERE id = ?')
      .get(reel.app_id) as AppRow | undefined

    if (app?.ticket_provider && app?.ticket_config) {
      let config: Record<string, any>
      try {
        config = JSON.parse(app.ticket_config)
      } catch {
        // Invalid config, skip ticket closing
        return { ok: true, ticketClosed }
      }

      try {
        if (app.ticket_provider === 'linear') {
          const linearHeaders = {
            'Content-Type': 'application/json',
            'Authorization': config.apiKey,
          }

          // Linear's issue() query accepts both UUID and identifier (e.g. "ENG-123")
          const issueRes = await $fetch<any>('https://api.linear.app/graphql', {
            method: 'POST',
            headers: linearHeaders,
            body: {
              query: `query($id: String!) {
                issue(id: $id) {
                  id
                  team {
                    states {
                      nodes { id name type }
                    }
                  }
                }
              }`,
              variables: { id: reel.ticket_id },
            },
          })

          const issue = issueRes.data?.issue
          if (issue) {
            // Find a "completed" type state (Linear marks Done states as type "completed")
            const doneState = issue.team.states.nodes.find((s: any) => s.type === 'completed')
            if (doneState) {
              await $fetch<any>('https://api.linear.app/graphql', {
                method: 'POST',
                headers: linearHeaders,
                body: {
                  query: `mutation($id: String!, $input: IssueUpdateInput!) {
                    issueUpdate(id: $id, input: $input) { success }
                  }`,
                  variables: { id: issue.id, input: { stateId: doneState.id } },
                },
              })
              ticketClosed = true
            }
          }
        } else if (app.ticket_provider === 'jira') {
          const siteUrl = config.siteUrl.replace(/\/+$/, '')
          const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
          const jiraHeaders = {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }

          // Get available transitions
          const transitions = await $fetch<any>(
            `${siteUrl}/rest/api/3/issue/${reel.ticket_id}/transitions`,
            { headers: jiraHeaders },
          )
          const doneTransition = transitions.transitions?.find((t: any) =>
            t.name?.toLowerCase() === 'done'
            || t.name?.toLowerCase() === 'closed'
            || t.name?.toLowerCase() === 'resolved',
          )
          if (doneTransition) {
            await $fetch<any>(
              `${siteUrl}/rest/api/3/issue/${reel.ticket_id}/transitions`,
              {
                method: 'POST',
                headers: jiraHeaders,
                body: { transition: { id: doneTransition.id } },
              },
            )
            ticketClosed = true
          }
        }
      } catch {
        // Best-effort: don't fail the request if ticket closing fails
      }
    }
  }

  // Webhook (fire-and-forget)
  if (reel.app_id) {
    sendWebhook(reel.app_id, 'reel_done', {
      reel: { id: reelId, name: reel.original_name, ticketId: reel.ticket_id },
    }).catch(() => {})
  }

  return { ok: true, ticketClosed }
})
