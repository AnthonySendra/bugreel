import { db } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

interface AppRow {
  id: string
  ticket_provider: string | null
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

  let ticketProvider: string | null = null
  if (reel.app_id) {
    const app = db
      .prepare('SELECT id, ticket_provider FROM apps WHERE id = ?')
      .get(reel.app_id) as AppRow | undefined
    ticketProvider = app?.ticket_provider || null
  }

  return {
    ticket_id: reel.ticket_id || null,
    ticket_url: reel.ticket_url || null,
    ticket_provider: ticketProvider,
  }
})
