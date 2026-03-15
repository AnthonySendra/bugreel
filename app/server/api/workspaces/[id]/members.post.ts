import { v4 as uuidv4 } from 'uuid'
import { db } from '~/server/utils/db'
import { sendWorkspaceInviteEmail } from '~/server/utils/email'

interface WorkspaceRow { id: string; owner_id: string; name: string }
interface UserRow { id: string; email: string }

export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const workspaceId = getRouterParam(event, 'id')
  const workspace = db.prepare('SELECT id, owner_id, name FROM workspaces WHERE id = ?').get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== user.id) throw createError({ statusCode: 403, message: 'Forbidden' })

  const body = await readBody(event)
  const email = body?.email?.toLowerCase?.()?.trim()
  if (!email) throw createError({ statusCode: 400, message: 'Email is required' })

  const target = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as UserRow | undefined
  if (!target) throw createError({ statusCode: 404, message: 'No user found with this email' })
  if (target.id === user.id) throw createError({ statusCode: 400, message: 'You are already the owner' })

  try {
    db.prepare('INSERT INTO workspace_members (id, workspace_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
      uuidv4(), workspaceId, target.id, Date.now()
    )
  } catch {
    throw createError({ statusCode: 409, message: 'This user is already a member' })
  }

  // Send invitation email (fire-and-forget)
  sendWorkspaceInviteEmail(target.email, workspace.name, user.email).catch(() => {})

  return { id: target.id, email: target.email }
})
