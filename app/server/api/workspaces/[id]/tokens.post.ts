import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')
  const workspace = db.prepare('SELECT id, owner_id FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  const body = await readBody(event)
  const { name } = body || {}
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw createError({ statusCode: 400, message: 'Token name is required' })
  }

  const id = uuidv4()
  const token = 'breel_' + randomBytes(24).toString('hex')
  const created_at = Date.now()

  db.prepare(
    'INSERT INTO api_tokens (id, workspace_id, user_id, name, token, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, workspaceId, user.id, name.trim(), token, created_at)

  // Return the token value only on creation — it won't be shown again
  return { id, name: name.trim(), token, created_at }
})
