import { createReadStream, statSync } from 'fs'
import { join } from 'path'
import { sendStream } from 'h3'
import { db, reelsDir } from '~/server/utils/db'
import { getS3Config, presignedGetUrl } from '~/server/utils/s3'

interface SharedReel {
  id: string
  filename: string
  original_name: string | null
  share_token: string
  share_expires_at: number | null
}

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')!

  const reel = db
    .prepare('SELECT id, filename, original_name, share_token, share_expires_at FROM reels WHERE share_token = ?')
    .get(token) as SharedReel | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Shared reel not found' })

  if (reel.share_expires_at && reel.share_expires_at < Date.now()) {
    throw createError({ statusCode: 410, message: 'Share link has expired' })
  }

  // S3 mode: redirect to presigned GET URL
  if (getS3Config()) {
    const url = await presignedGetUrl(reel.filename, 3600)
    return sendRedirect(event, url, 302)
  }

  // Local disk mode
  const filePath = join(reelsDir, reel.filename)

  let fileSize: number
  try {
    fileSize = statSync(filePath).size
  } catch {
    throw createError({ statusCode: 404, message: 'Reel file not found on disk' })
  }

  const safeName = (reel.original_name || reel.filename).replace(/["\\r\\n]/g, '')
  setResponseHeader(event, 'Content-Type', 'application/octet-stream')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${safeName}"`)
  setResponseHeader(event, 'Content-Length', String(fileSize))

  const stream = createReadStream(filePath)
  return sendStream(event, stream)
})
