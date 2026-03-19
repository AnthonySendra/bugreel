import { db } from './db'

interface AppWebhookConfig {
  webhook_url: string | null
  webhook_events: string | null
}

function formatText(event: string, payload: Record<string, any>): string {
  const reel = payload.reel as { id?: string; name?: string; ticketId?: string } | undefined
  const reelName = reel?.name || reel?.id || 'a recording'

  switch (event) {
    case 'new_reel':
      return `New recording: **${reelName}**`
    case 'new_comment': {
      const comment = payload.comment as { author?: string; content?: string } | undefined
      const author = comment?.author || 'Someone'
      const content = comment?.content || ''
      return `${author} commented on **${reelName}**: ${content}`
    }
    case 'reel_done':
      return `Recording marked as done: **${reelName}**`
    case 'test':
      return 'Webhook configured successfully for bugreel'
    default:
      return `bugreel event: ${event}`
  }
}

export async function sendWebhook(appId: string, event: string, payload: Record<string, any>) {
  const app = db
    .prepare('SELECT webhook_url, webhook_events FROM apps WHERE id = ?')
    .get(appId) as AppWebhookConfig | undefined

  if (!app?.webhook_url || !app?.webhook_events) return

  let events: string[]
  try { events = JSON.parse(app.webhook_events) } catch { return }
  if (!events.includes(event)) return

  try {
    const res = await fetch(app.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: formatText(event, payload),
        event,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    })
    if (!res.ok) {
      console.warn(`[webhook] ${event} to ${app.webhook_url} returned ${res.status}`)
    }
  } catch (err) {
    console.warn(`[webhook] Failed to send ${event} to ${app.webhook_url}:`, (err as any)?.message)
  }
}
