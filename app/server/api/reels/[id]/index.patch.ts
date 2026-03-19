import { db } from '~/server/utils/db'
import { requireReelAccess, requireWorkspaceAccess } from '~/server/utils/workspace-access'

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel, workspaceId } = requireReelAccess(reelId, user.id)

  const body = await readBody(event)

  const updates: string[] = []
  const values: any[] = []

  // Name
  if (body.name !== undefined) {
    const name = body.name?.trim()
    if (!name) throw createError({ statusCode: 400, message: 'name cannot be empty' })
    updates.push('original_name = ?')
    values.push(name)
  }

  // Assignee
  if (body.assignedTo !== undefined) {
    if (body.assignedTo === null) {
      updates.push('assigned_user_id = ?')
      values.push(null)
    } else {
      const assigneeId = body.assignedTo as string
      // Validate user exists
      const assignee = db.prepare('SELECT id FROM users WHERE id = ?').get(assigneeId) as { id: string } | undefined
      if (!assignee) throw createError({ statusCode: 400, message: 'Assigned user not found' })
      // Validate user has workspace access
      try {
        requireWorkspaceAccess(workspaceId, assigneeId)
      } catch {
        throw createError({ statusCode: 400, message: 'Assigned user does not have access to this workspace' })
      }
      updates.push('assigned_user_id = ?')
      values.push(assigneeId)
    }
  }

  // Tags
  if (body.tags !== undefined) {
    if (body.tags === null) {
      updates.push('tags = ?')
      values.push(null)
    } else {
      if (!Array.isArray(body.tags)) throw createError({ statusCode: 400, message: 'tags must be an array' })
      if (body.tags.length > 10) throw createError({ statusCode: 400, message: 'Maximum 10 tags allowed' })
      for (const tag of body.tags) {
        if (typeof tag !== 'string') throw createError({ statusCode: 400, message: 'Each tag must be a string' })
        if (tag.length > 30) throw createError({ statusCode: 400, message: 'Each tag must be 30 characters or fewer' })
      }
      updates.push('tags = ?')
      values.push(JSON.stringify(body.tags))
    }
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, message: 'No valid fields to update' })
  }

  values.push(reelId)
  db.prepare(`UPDATE reels SET ${updates.join(', ')} WHERE id = ?`).run(...values)

  return { ok: true }
})
