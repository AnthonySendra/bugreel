/**
 * POST /api/ingest/reels?token=TOKEN&app=APP_ID
 *
 * Upload a reel file via multipart form. Auth via API token only (SDK use).
 */
import { readMultipartFormData } from 'h3'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { db, reelsDir } from '~/server/utils/db'
import { validateIngestAuth } from '~/server/utils/ingest-auth'
import { sendWebhook } from '~/server/utils/webhook'

export default defineEventHandler(async (event) => {
  const { apiToken, app } = validateIngestAuth(event)

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(p => p.name === 'file')

  if (!filePart || !filePart.data) {
    throw createError({ statusCode: 400, message: 'No file uploaded. Use multipart field name "file".' })
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024
  if (filePart.data.length > MAX_FILE_SIZE) {
    throw createError({ statusCode: 413, message: 'File too large. Maximum size is 50MB.' })
  }

  const reporterEmailPart = parts?.find(p => p.name === 'reporter_email')
  const reporterNamePart = parts?.find(p => p.name === 'reporter_name')
  const reporterEmail = reporterEmailPart?.data ? reporterEmailPart.data.toString('utf-8').trim() || null : null
  const reporterName = reporterNamePart?.data ? reporterNamePart.data.toString('utf-8').trim() || null : null

  const id = uuidv4()
  const filename = `${id}.reel`
  const filePath = join(reelsDir, filename)
  const originalName = filePart.filename || null
  const size = filePart.data.length

  try {
    writeFileSync(filePath, filePart.data)
  } catch {
    throw createError({ statusCode: 500, message: 'Failed to write file to disk' })
  }

  const created_at = Date.now()

  const isScreenshotPart = parts?.find(p => p.name === 'is_screenshot')
  const isScreenshot = isScreenshotPart?.data?.toString('utf-8').trim() === '1' ? 1 : 0

  db.prepare('INSERT INTO reels (id, workspace_id, filename, original_name, size, created_at, app_id, uploaded_by_user_id, reporter_email, reporter_name, is_screenshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    app.workspace_id,
    filename,
    originalName,
    size,
    created_at,
    app.id,
    apiToken.user_id,
    reporterEmail,
    reporterName,
    isScreenshot,
  )

  sendWebhook(app.id, 'new_reel', { reel: { id, name: originalName, url: `/api/reels/${id}/file` } }).catch(() => {})

  return { id, filename, original_name: originalName, size, created_at }
})
