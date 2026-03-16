import jwt from 'jsonwebtoken'
import { getJwtSecret } from '~/server/utils/jwt'

export default defineEventHandler((event) => {
  // Initialize user context as null
  event.context.user = null

  // Try Authorization header first
  const authHeader = getHeader(event, 'authorization')
  let token: string | undefined

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    // Fall back to ?token query param for extension compatibility
    const query = getQuery(event)
    if (query.token && typeof query.token === 'string') {
      token = query.token
    }
  }

  if (!token) return

  try {
    const payload = jwt.verify(token, getJwtSecret(event)) as { id: string; email: string }
    event.context.user = { id: payload.id, email: payload.email }
  } catch {
    // Invalid or expired token — leave context.user as null
  }
})
