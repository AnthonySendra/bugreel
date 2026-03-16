import { db } from '~/server/utils/db'

interface AppRow { id: string; workspace_id: string }
interface WorkspaceRow { id: string; owner_id: string }
interface TokenRow { id: string; app_id: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')
  const tokenId = getRouterParam(event, 'tokenId')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(app.workspace_id) as WorkspaceRow | undefined

  if (!workspace || workspace.owner_id !== user.id) {
    const member = db.prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(app.workspace_id, user.id)
    if (!member) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const apiToken = db.prepare('SELECT id, app_id FROM api_tokens WHERE id = ? AND app_id = ?').get(tokenId, appId) as TokenRow | undefined
  if (!apiToken) {
    throw createError({ statusCode: 404, message: 'Token not found' })
  }

  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(tokenId)
  return { success: true }
})
