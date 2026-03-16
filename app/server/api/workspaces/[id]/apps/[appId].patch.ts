import { db } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }
interface AppRow { id: string; workspace_id: string; name: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')
  const appId = getRouterParam(event, 'appId')

  const workspace = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined
  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  const app = db.prepare('SELECT id, workspace_id, name FROM apps WHERE id = ? AND workspace_id = ?').get(appId, workspaceId) as AppRow | undefined
  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  const body = await readBody(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, message: 'App name is required' })
  if (name.length > 100) throw createError({ statusCode: 400, message: 'App name must be 100 characters or fewer' })

  db.prepare('UPDATE apps SET name = ? WHERE id = ?').run(name, appId)

  return { id: appId, name }
})
