import { db } from '~/server/utils/db'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')
  const body = await readBody(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, message: 'name is required' })

  const reel = db
    .prepare('SELECT r.*, a.workspace_id AS app_workspace_id FROM reels r LEFT JOIN apps a ON r.app_id = a.id WHERE r.id = ?')
    .get(reelId) as { id: string; workspace_id: string; app_workspace_id: string | null } | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Reel not found' })

  const workspaceId = reel.app_workspace_id || reel.workspace_id
  const workspace = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as { owner_id: string } | undefined
  if (!workspace || workspace.owner_id !== user.id) {
    const member = db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, user.id)
    if (!member) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  db.prepare('UPDATE reels SET original_name = ? WHERE id = ?').run(name, reelId)

  return { ok: true }
})
