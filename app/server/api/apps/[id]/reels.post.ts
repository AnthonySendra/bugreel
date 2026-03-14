import { readMultipartFormData } from 'h3'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import jwt from 'jsonwebtoken'
import { db, reelsDir } from '~/server/utils/db'

interface AppRow { id: string; workspace_id: string }
interface WorkspaceRow { id: string; owner_id: string }
interface ApiTokenRow { id: string; workspace_id: string; user_id: string | null }

const JWT_SECRET = process.env.JWT_SECRET || 'bugreel-dev-secret'

export default defineEventHandler(async (event) => {
  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  // Auth: accept either a JWT user or an API token
  let uploadedByUserId: string | null = null
  const user = event.context.user

  if (user) {
    // JWT user: verify workspace ownership
    const workspace = db
      .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
      .get(app.workspace_id) as WorkspaceRow | undefined

    if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
    if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })
    uploadedByUserId = user.id
  } else {
    // Try API token
    const authHeader = getHeader(event, 'authorization')
    const rawToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : (getQuery(event).token as string | undefined)

    if (rawToken) {
      // First try JWT
      try {
        const payload = jwt.verify(rawToken, JWT_SECRET) as { id: string; email: string }
        const workspace = db
          .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
          .get(app.workspace_id) as WorkspaceRow | undefined
        if (workspace && workspace.owner_id === payload.id) uploadedByUserId = payload.id
      } catch {
        // Not a JWT, try api_tokens table
        const apiToken = db
          .prepare('SELECT id, workspace_id, user_id FROM api_tokens WHERE token = ?')
          .get(rawToken) as ApiTokenRow | undefined

        if (apiToken && apiToken.workspace_id === app.workspace_id) {
          uploadedByUserId = apiToken.user_id
        }
      }
    }
  }

  if (!uploadedByUserId) throw createError({ statusCode: 401, message: 'Unauthorized' })

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

  db.prepare('INSERT INTO reels (id, workspace_id, filename, original_name, size, created_at, app_id, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id,
    app.workspace_id,
    filename,
    originalName,
    size,
    created_at,
    appId,
    uploadedByUserId,
  )

  return { id, filename, original_name: originalName, size, created_at }
})
