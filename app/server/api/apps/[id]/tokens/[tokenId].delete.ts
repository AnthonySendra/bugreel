import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }
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

  requireWorkspaceAccess(app.workspace_id, user.id)

  const apiToken = db.prepare('SELECT id, app_id FROM api_tokens WHERE id = ? AND app_id = ?').get(tokenId, appId) as TokenRow | undefined
  if (!apiToken) {
    throw createError({ statusCode: 404, message: 'Token not found' })
  }

  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(tokenId)
  return { success: true }
})
