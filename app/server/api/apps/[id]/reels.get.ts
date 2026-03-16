import { db } from '~/server/utils/db'

interface AppRow { id: string; workspace_id: string }
interface WorkspaceRow { id: string; owner_id: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  const workspace = db
    .prepare('SELECT id, owner_id FROM workspaces WHERE id = ?')
    .get(app.workspace_id) as WorkspaceRow | undefined

  if (!workspace || workspace.owner_id !== user.id) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }

  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const before = query.before ? Number(query.before) : null

  const params: (string | number)[] = [appId]
  let whereClause = 'WHERE r.app_id = ?'

  if (before !== null) {
    whereClause += ' AND r.created_at < ?'
    params.push(before)
  }

  params.push(limit + 1)

  const reels = db
    .prepare(`
      SELECT r.id, r.filename, r.original_name, r.size, r.created_at,
             COALESCE(r.reporter_email, u.email) AS uploaded_by_email,
             r.reporter_name
      FROM reels r
      LEFT JOIN users u ON r.uploaded_by_user_id = u.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ?
    `)
    .all(...params) as any[]

  const hasMore = reels.length > limit
  const items = hasMore ? reels.slice(0, limit) : reels
  const nextBefore = hasMore ? items[items.length - 1].created_at : null

  return { items, hasMore, nextBefore }
})
