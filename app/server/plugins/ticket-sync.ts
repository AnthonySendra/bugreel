/**
 * Background job: every 5 minutes, check linked tickets on Linear/Jira.
 * If a ticket has been completed/closed, mark the reel as done.
 * If a ticket can't be found or the API errors persistently, set ticket_sync_skip
 * so we stop checking that reel (user will need to handle it manually).
 */
import { db } from '~/server/utils/db'

interface ReelToSync {
  id: string
  ticket_id: string
  ticket_url: string
  app_id: string
}

interface AppConfig {
  id: string
  ticket_provider: string
  ticket_config: string
}

const SYNC_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

async function checkLinearIssue(ticketId: string, apiKey: string): Promise<'done' | 'open' | 'error'> {
  try {
    const res = await $fetch<any>('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: {
        query: `query($id: String!) {
          issue(id: $id) {
            state { type }
          }
        }`,
        variables: { id: ticketId },
      },
    })

    if (res.errors?.length) return 'error'

    const stateType = res.data?.issue?.state?.type
    if (!stateType) return 'error' // issue not found

    // Linear state types: backlog, unstarted, started, completed, cancelled
    return (stateType === 'completed' || stateType === 'cancelled') ? 'done' : 'open'
  } catch {
    return 'error'
  }
}

async function checkJiraIssue(
  ticketId: string,
  config: { siteUrl: string; email: string; apiToken: string },
): Promise<'done' | 'open' | 'error'> {
  try {
    const siteUrl = config.siteUrl.replace(/\/+$/, '')
    const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')

    const issue = await $fetch<any>(`${siteUrl}/rest/api/3/issue/${ticketId}?fields=status`, {
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json',
      },
    })

    // Jira status categories: new, indeterminate, done
    const categoryKey = issue?.fields?.status?.statusCategory?.key
    if (!categoryKey) return 'error'

    return categoryKey === 'done' ? 'done' : 'open'
  } catch (err: any) {
    // 404 = ticket deleted or not found
    if (err?.statusCode === 404 || err?.status === 404) return 'error'
    return 'error'
  }
}

async function checkGitHubIssue(
  ticketId: string,
  config: { token: string; owner: string; repo: string },
): Promise<'done' | 'open' | 'error'> {
  try {
    const issueNumber = ticketId.replace('#', '')
    const issue = await $fetch<any>(
      `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )

    if (!issue?.state) return 'error'
    return issue.state === 'closed' ? 'done' : 'open'
  } catch (err: any) {
    if (err?.statusCode === 404 || err?.status === 404) return 'error'
    return 'error'
  }
}

async function syncTickets() {
  // Get all reels that have a linked ticket, are not done, and not skipped
  const reels = db
    .prepare(`
      SELECT r.id, r.ticket_id, r.ticket_url, r.app_id
      FROM reels r
      WHERE r.ticket_id IS NOT NULL
        AND (r.status IS NULL OR r.status != 'done')
        AND (r.ticket_sync_skip IS NULL OR r.ticket_sync_skip = 0)
        AND r.app_id IS NOT NULL
    `)
    .all() as ReelToSync[]

  if (reels.length === 0) {
    console.log('[ticket-sync] No reels to sync')
    return
  }

  console.log(`[ticket-sync] Checking ${reels.length} reel(s)…`)

  // Group reels by app to avoid re-fetching app config for each reel
  const byApp = new Map<string, ReelToSync[]>()
  for (const reel of reels) {
    const list = byApp.get(reel.app_id) || []
    list.push(reel)
    byApp.set(reel.app_id, list)
  }

  // Cache app configs
  const appConfigs = new Map<string, { provider: string; config: Record<string, any> } | null>()

  for (const [appId, appReels] of byApp) {
    // Get or cache app config
    if (!appConfigs.has(appId)) {
      const app = db
        .prepare('SELECT id, ticket_provider, ticket_config FROM apps WHERE id = ?')
        .get(appId) as AppConfig | undefined

      if (!app?.ticket_provider || !app?.ticket_config) {
        appConfigs.set(appId, null)
      } else {
        try {
          const parsed = JSON.parse(app.ticket_config)
          appConfigs.set(appId, { provider: app.ticket_provider, config: parsed })
        } catch {
          appConfigs.set(appId, null)
        }
      }
    }

    const appConfig = appConfigs.get(appId)
    if (!appConfig) {
      // No valid integration — skip these reels permanently
      for (const reel of appReels) {
        db.prepare('UPDATE reels SET ticket_sync_skip = 1 WHERE id = ?').run(reel.id)
      }
      continue
    }

    for (const reel of appReels) {
      let result: 'done' | 'open' | 'error'

      if (appConfig.provider === 'linear') {
        result = await checkLinearIssue(reel.ticket_id, appConfig.config.apiKey)
      } else if (appConfig.provider === 'jira') {
        result = await checkJiraIssue(reel.ticket_id, appConfig.config)
      } else if (appConfig.provider === 'github') {
        result = await checkGitHubIssue(reel.ticket_id, appConfig.config)
      } else {
        result = 'error'
      }

      if (result === 'done') {
        db.prepare("UPDATE reels SET status = 'done' WHERE id = ?").run(reel.id)
        console.log(`[ticket-sync] Reel ${reel.id} → done (ticket ${reel.ticket_id} closed)`)
      } else if (result === 'error') {
        db.prepare('UPDATE reels SET ticket_sync_skip = 1 WHERE id = ?').run(reel.id)
        console.warn(`[ticket-sync] Reel ${reel.id} → skipped (ticket ${reel.ticket_id} not found or API error)`)
      }
      // 'open' → do nothing, check again next cycle
    }
  }

  console.log('[ticket-sync] Sync complete')
}

export default defineNitroPlugin(() => {
  // Run first sync shortly after server start (10s delay to let everything initialize)
  const initialTimeout = setTimeout(() => {
    syncTickets().catch(() => {})
  }, 10_000)

  // Then every 5 minutes
  const interval = setInterval(() => {
    syncTickets().catch(() => {})
  }, SYNC_INTERVAL_MS)

  // Cleanup on server shutdown
  const nuxtApp = useNitroApp()
  nuxtApp.hooks.hook('close', () => {
    clearTimeout(initialTimeout)
    clearInterval(interval)
  })
})
