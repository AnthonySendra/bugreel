import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'
import { getS3Config, deleteObject } from '~/server/utils/s3'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

  // Delete file from S3 if configured
  const s3 = getS3Config()
  if (s3) {
    try {
      await deleteObject(reel.filename)
    } catch {
      // S3 deletion failed — continue with local cleanup
    }
  }

  // Delete file from disk
  try {
    unlinkSync(join(reelsDir, reel.filename))
  } catch {
    // File may already be missing — continue
  }

  // Delete comments before the reel itself
  db.prepare('DELETE FROM reel_comments WHERE reel_id = ?').run(reelId)
  db.prepare('DELETE FROM reels WHERE id = ?').run(reelId)

  return { ok: true }
})
