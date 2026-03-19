import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'
import { getS3Config, deleteObject } from '~/server/utils/s3'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }
interface ReelRow { id: string; filename: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  requireWorkspaceAccess(app.workspace_id, user.id)

  // Find all done reels for this app
  const reels = db
    .prepare("SELECT id, filename FROM reels WHERE app_id = ? AND status = 'done'")
    .all(appId) as ReelRow[]

  const s3 = getS3Config()

  for (const reel of reels) {
    // Delete file from S3 if configured
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
    db.prepare('DELETE FROM reel_comments WHERE reel_id = ?').run(reel.id)
    db.prepare('DELETE FROM reels WHERE id = ?').run(reel.id)
  }

  return { ok: true, deleted: reels.length }
})
