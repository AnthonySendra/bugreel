import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  const body = await readBody(event)
  const name = body?.name?.trim()
  if (!name) throw createError({ statusCode: 400, message: 'App name is required' })
  if (name.length > 100) throw createError({ statusCode: 400, message: 'App name must be 100 characters or fewer' })

  const id = uuidv4()
  const created_at = Date.now()

  db.prepare('INSERT INTO apps (id, workspace_id, name, created_at) VALUES (?, ?, ?, ?)').run(
    id, workspaceId, name, created_at,
  )

  return { id, name, created_at }
})
