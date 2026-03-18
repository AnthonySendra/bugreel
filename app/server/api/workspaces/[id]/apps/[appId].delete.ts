import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }
interface ReelRow { id: string; filename: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')!
  const appId = getRouterParam(event, 'appId')

  requireWorkspaceAccess(workspaceId, user.id)

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ? AND workspace_id = ?')
    .get(appId, workspaceId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  // 1. Delete comments for all reels of this app
  db.prepare(`
    DELETE FROM reel_comments WHERE reel_id IN (
      SELECT id FROM reels WHERE app_id = ?
    )
  `).run(appId)

  // 2. Delete reel files from disk
  const reels = db.prepare('SELECT id, filename FROM reels WHERE app_id = ?').all(appId) as ReelRow[]
  for (const reel of reels) {
    try {
      unlinkSync(join(reelsDir, reel.filename))
    } catch {
      // File may already be missing — continue
    }
  }

  // 3. Delete reels
  db.prepare('DELETE FROM reels WHERE app_id = ?').run(appId)

  // 4. Delete API tokens
  db.prepare('DELETE FROM api_tokens WHERE app_id = ?').run(appId)

  // 5. Delete the app
  db.prepare('DELETE FROM apps WHERE id = ?').run(appId)

  return { ok: true }
})
