import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'

interface ReelRow {
  id: string
  workspace_id: string
  app_id: string | null
  filename: string
  app_workspace_id: string | null
}

interface WorkspaceRow {
  id: string
  owner_id: string
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')

  const reel = db
    .prepare('SELECT r.*, a.workspace_id AS app_workspace_id FROM reels r LEFT JOIN apps a ON r.app_id = a.id WHERE r.id = ?')
    .get(reelId) as ReelRow | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Reel not found' })

  const workspaceId = reel.app_workspace_id || reel.workspace_id

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace || workspace.owner_id !== user.id) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  // Delete file from disk
  try {
    unlinkSync(join(reelsDir, reel.filename))
  } catch {
    // File may already be missing — continue
  }

  db.prepare('DELETE FROM reels WHERE id = ?').run(reelId)

  return { ok: true }
})
