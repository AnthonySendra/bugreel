import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }
interface ReelRow { id: string; filename: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  // 1. Delete comments for all reels in this workspace
  db.prepare(`
    DELETE FROM reel_comments WHERE reel_id IN (
      SELECT id FROM reels WHERE workspace_id = ?
    )
  `).run(workspaceId)

  // 2. Delete reel files from disk
  const reels = db.prepare('SELECT id, filename FROM reels WHERE workspace_id = ?').all(workspaceId) as ReelRow[]
  for (const reel of reels) {
    try {
      unlinkSync(join(reelsDir, reel.filename))
    } catch {
      // File may already be missing — continue
    }
  }

  // 3. Delete reels
  db.prepare('DELETE FROM reels WHERE workspace_id = ?').run(workspaceId)

  // 4. Delete API tokens (must run before deleting apps)
  db.prepare('DELETE FROM api_tokens WHERE app_id IN (SELECT id FROM apps WHERE workspace_id = ?)').run(workspaceId)

  // 5. Delete apps
  db.prepare('DELETE FROM apps WHERE workspace_id = ?').run(workspaceId)

  // 6. Delete workspace members
  db.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').run(workspaceId)

  // 7. Delete the workspace itself
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)

  return { ok: true }
})
