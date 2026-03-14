import { readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { db, reelsDir } from '~/server/utils/db'

interface ReelRow {
  id: string
  workspace_id: string
  app_id: string | null
  filename: string
  app_workspace_id: string | null
}

interface WorkspaceRow {
  id: string
  owner_id: string
}

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')

  const reel = db
    .prepare('SELECT r.*, a.workspace_id AS app_workspace_id FROM reels r LEFT JOIN apps a ON r.app_id = a.id WHERE r.id = ?')
    .get(reelId) as ReelRow | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Reel not found' })

  const workspaceId = reel.app_workspace_id || reel.workspace_id

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace || workspace.owner_id !== user.id) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const filePath = join(reelsDir, reel.filename)
  let buffer: Buffer
  try {
    buffer = readFileSync(filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'Reel file not found on disk' })
  }

  let json: string
  try {
    json = gunzipSync(buffer).toString('utf-8')
  } catch {
    json = buffer.toString('utf-8')
  }

  const data = JSON.parse(json)
  const rrwebEvents: any[] = data.rrwebEvents || []

  // Return only Meta (type 4) + FullSnapshot (type 2) — the minimum needed to render the first frame
  const thumbEvents = rrwebEvents.filter((e: any) => e.type === 4 || e.type === 2)

  return { events: thumbEvents }
})
