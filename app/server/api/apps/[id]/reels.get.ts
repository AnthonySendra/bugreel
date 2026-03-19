import { db } from '~/server/utils/db'
import { requireWorkspaceAccess } from '~/server/utils/workspace-access'

interface AppRow { id: string; workspace_id: string }

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const appId = getRouterParam(event, 'id')

  const app = db
    .prepare('SELECT id, workspace_id FROM apps WHERE id = ?')
    .get(appId) as AppRow | undefined

  if (!app) throw createError({ statusCode: 404, message: 'App not found' })

  requireWorkspaceAccess(app.workspace_id, user.id)

  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200)
  const before = query.before ? Number(query.before) : null
  const from = query.from ? Number(query.from) : null
  const to = query.to ? Number(query.to) : null

  const status = (query.status as string) || 'open'
  const assignee = query.assignee as string | undefined
  const tag = query.tag as string | undefined

  const params: (string | number)[] = [appId]
  let whereClause = 'WHERE r.app_id = ?'

  if (status === 'open') {
    whereClause += ' AND (r.status = \'open\' OR r.status IS NULL)'
  } else if (status === 'done') {
    whereClause += ' AND r.status = \'done\''
  }
  // status === 'all' => no filter

  if (before !== null) {
    whereClause += ' AND r.created_at < ?'
    params.push(before)
  }

  if (from !== null && !isNaN(from)) {
    whereClause += ' AND r.created_at >= ?'
    params.push(from)
  }

  if (to !== null && !isNaN(to)) {
    whereClause += ' AND r.created_at <= ?'
    params.push(to)
  }

  if (assignee) {
    whereClause += ' AND r.assigned_user_id = ?'
    params.push(assignee)
  }

  if (tag) {
    const escapedTag = tag.replace(/%/g, '\\%').replace(/_/g, '\\_')
    whereClause += " AND r.tags LIKE ? ESCAPE '\\'"
    params.push(`%"${escapedTag}"%`)
  }

  params.push(limit + 1)

  const reels = db
    .prepare(`
      SELECT r.id, r.filename, r.original_name, r.size, r.created_at,
             COALESCE(r.reporter_email, u.email) AS uploaded_by_email,
             r.reporter_name, r.status, r.ticket_id, r.ticket_url,
             r.assigned_user_id, r.tags, r.share_token, r.is_screenshot,
             assigned.email AS assigned_user_email
      FROM reels r
      LEFT JOIN users u ON r.uploaded_by_user_id = u.id
      LEFT JOIN users assigned ON r.assigned_user_id = assigned.id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ?
    `)
    .all(...params) as any[]

  // Parse tags JSON string into arrays
  for (const r of reels) {
    if (r.tags) {
      try { r.tags = JSON.parse(r.tags) } catch { r.tags = null }
    }
  }

  const hasMore = reels.length > limit
  const items = hasMore ? reels.slice(0, limit) : reels
  const nextBefore = hasMore ? items[items.length - 1].created_at : null

  // Total count of all reels (regardless of status filter) — used by frontend to know if any reels exist
  const totalCount = (db
    .prepare('SELECT COUNT(*) AS cnt FROM reels WHERE app_id = ?')
    .get(appId) as any).cnt

  return { items, hasMore, nextBefore, totalCount }
})
