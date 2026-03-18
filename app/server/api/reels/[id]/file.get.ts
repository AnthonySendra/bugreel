import { createReadStream, statSync } from 'fs'
import { join } from 'path'
import { sendStream } from 'h3'
import { db, reelsDir } from '~/server/utils/db'
import { getS3Config, presignedGetUrl } from '~/server/utils/s3'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

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

  setResponseHeader(event, 'Content-Type', 'application/octet-stream')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${reel.original_name || reel.filename}"`)
  setResponseHeader(event, 'Content-Length', String(fileSize))

  const stream = createReadStream(filePath)
  return sendStream(event, stream)
})
