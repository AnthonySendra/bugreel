import { readMultipartFormData } from 'h3'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { db, reelsDir } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string }
interface ApiTokenRow { id: string; app_id: string }

export default defineEventHandler(async (event) => {
  const workspaceId = getRouterParam(event, 'id')

  // Auth: accept either a JWT user (dashboard) or an app API token (extension)
  const user = event.context.user

  if (!user) {
    // Try resolving as an API token
    const authHeader = getHeader(event, 'authorization')
    const rawToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (getQuery(event).token as string | undefined)

    if (!rawToken) throw createError({ statusCode: 401, message: 'Unauthorized' })

    const apiToken = db
      .prepare('SELECT id, app_id FROM api_tokens WHERE token = ?')
      .get(rawToken) as ApiTokenRow | undefined

    if (!apiToken) {
      throw createError({ statusCode: 401, message: 'Invalid API token' })
    }

    // Verify the token's app belongs to this workspace
    const app = db.prepare('SELECT workspace_id FROM apps WHERE id = ?').get(apiToken.app_id) as { workspace_id: string } | undefined
    if (!app || app.workspace_id !== workspaceId) {
      throw createError({ statusCode: 403, message: 'Token does not belong to this workspace' })
    }
    // API token is valid — skip ownership check below
  } else {
    // JWT user: verify workspace ownership
    const workspace = db
      .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
      .get(workspaceId) as WorkspaceRow | undefined

    if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
    if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const parts = await readMultipartFormData(event)
  const filePart = parts?.find(p => p.name === 'file')

  if (!filePart || !filePart.data) {
    throw createError({ statusCode: 400, message: 'No file uploaded. Use multipart field name "file".' })
  }

  const id = uuidv4()
  const filename = `${id}.reel`
  const filePath = join(reelsDir, filename)
  const originalName = filePart.filename || null
  const size = filePart.data.length

  writeFileSync(filePath, filePart.data)

  const created_at = Date.now()

  db.prepare('INSERT INTO reels (id, workspace_id, filename, original_name, size, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    workspaceId,
    filename,
    originalName,
    size,
    created_at,
  )

  return { id, filename, original_name: originalName, size, created_at }
})
