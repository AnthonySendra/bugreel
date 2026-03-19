/**
 * GET /api/ingest/integration?token=TOKEN
 *
 * Returns whether a ticket integration is configured for the app.
 * Auth via API token (SDK use).
 */
import { db } from '~/server/utils/db'
import { validateIngestAuth } from '~/server/utils/ingest-auth'

interface AppRow {
  id: string
  ticket_provider: string | null
}

export default defineEventHandler(async (event) => {
  const { app: ingestApp } = validateIngestAuth(event)

  const app = db
    .prepare('SELECT id, ticket_provider FROM apps WHERE id = ?')
    .get(ingestApp.id) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  return { provider: app.ticket_provider || null }
})
