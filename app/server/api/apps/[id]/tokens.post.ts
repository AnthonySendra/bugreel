import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  requireWorkspaceAccess(app.workspace_id, user.id)

  const body = await readBody(event)
  const { name } = body || {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, message: 'Token name is required' })
  }

  if (name.trim().length > 100) {
    throw createError({ statusCode: 400, message: 'Token name must be 100 characters or fewer' })
  }

  const id = randomUUID()
  const token = 'breel_' + randomBytes(24).toString('hex')
  const created_at = Date.now()

  db.prepare(
    'INSERT INTO api_tokens (id, app_id, user_id, name, token, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, appId, user.id, name.trim(), token, created_at)

  // Return the token value only on creation — it won't be shown again
  return { id, name: name.trim(), token, created_at }
})
