/**
 * POST /api/ingest/upload-url?token=TOKEN&app=APP_ID
 *
 * Returns a presigned S3 PUT URL. Auth via API token only (SDK use).
 */
import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'
import { getS3Config, presignedPutUrl } from '~/server/utils/s3'
import { validateIngestAuth } from '~/server/utils/ingest-auth'
import { sendWebhook } from '~/server/utils/webhook'

export default defineEventHandler(async (event) => {
  const s3 = getS3Config()
  if (!s3) throw createError({ statusCode: 501, message: 'S3 storage is not configured on this server' })

  const { apiToken, app } = validateIngestAuth(event)

  const body = await readBody(event).catch(() => ({})) as { originalName?: string; reporter_email?: string; reporter_name?: string; is_screenshot?: boolean }

  const id = uuidv4()
  const filename = `${id}.reel`
  const now = Date.now()

  db.prepare(`
    INSERT INTO reels (id, workspace_id, filename, original_name, size, created_at, app_id, uploaded_by_user_id, reporter_email, reporter_name, is_screenshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, app.workspace_id, filename, body.originalName ?? null, null, now, app.id, apiToken.user_id, body.reporter_email?.trim() || null, body.reporter_name?.trim() || null, body.is_screenshot ? 1 : 0)

  const uploadUrl = await presignedPutUrl(filename, 3600)

  sendWebhook(app.id, 'new_reel', { reel: { id, name: body.originalName ?? null, url: `/api/reels/${id}/file` } }).catch(() => {})

  return { id, uploadUrl, key: filename, expiresIn: 3600 }
})
