import type { H3Event } from 'h3'
import { db } from '~/server/utils/db'

interface ApiTokenRow { id: string; app_id: string; user_id: string | null }
interface AppRow { id: string; workspace_id: string }

export interface IngestAuth {
  apiToken: ApiTokenRow
  app: AppRow
}

/**
 * Validate ingest auth from query params: ?token=TOKEN
 * Resolves the app from the token's app_id.
 * Throws appropriate HTTP errors on failure.
 */
export function validateIngestAuth(event: H3Event): IngestAuth {
  const query = getQuery(event)
  const token = query.token as string | undefined

  if (!token) throw createError({ statusCode: 400, message: 'token is required' })

  const apiToken = db.prepare('SELECT id, app_id, user_id FROM api_tokens WHERE token = ?').get(token) as ApiTokenRow | undefined
  if (!apiToken) throw createError({ statusCode: 401, message: 'Invalid token' })

  const app = db.prepare('SELECT id, workspace_id FROM apps WHERE id = ?').get(apiToken.app_id) as AppRow | undefined
  if (!app) throw createError({ statusCode: 404, message: 'App not found for this token' })

  return { apiToken, app }
}
