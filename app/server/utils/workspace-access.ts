import { db } from '~/server/utils/db'

interface WorkspaceRow { id: string; owner_id: string; name: string }

/**
 * Check if a user has access to a workspace (as owner or member).
 * Throws 404 if workspace doesn't exist, 403 if no access.
 * Returns the workspace row and the user's role.
 */
export function requireWorkspaceAccess(workspaceId: string, userId: string): { workspace: WorkspaceRow; role: 'owner' | 'member' } {
  const workspace = db
    .prepare('SELECT id, owner_id, name FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })

  if (workspace.owner_id === userId) {
    return { workspace, role: 'owner' }
  }

  const member = db
    .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId)

  if (!member) throw createError({ statusCode: 403, message: 'Forbidden' })

  return { workspace, role: 'member' }
}

/**
 * Check if a user is the owner of a workspace.
 * Throws 404 if workspace doesn't exist, 403 if not owner.
 */
export function requireWorkspaceOwner(workspaceId: string, userId: string): WorkspaceRow {
  const workspace = db
    .prepare('SELECT id, owner_id, name FROM workspaces WHERE id = ?')
    .get(workspaceId) as WorkspaceRow | undefined

  if (!workspace) throw createError({ statusCode: 404, message: 'Workspace not found' })
  if (workspace.owner_id !== userId) throw createError({ statusCode: 403, message: 'Forbidden' })

  return workspace
}
