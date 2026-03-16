/**
 * GET /api/ingest/storage?token=TOKEN&app=APP_ID
 *
 * Returns the storage backend. Auth via API token only (SDK use).
 * The token resolves to a workspace; the app must belong to that workspace.
 */
import { getS3Config } from '~/server/utils/s3'
import { validateIngestAuth } from '~/server/utils/ingest-auth'

export default defineEventHandler((event) => {
  validateIngestAuth(event)
  return { storage: getS3Config() ? 's3' : 'local' }
})
