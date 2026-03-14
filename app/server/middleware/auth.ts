import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'bugreel-dev-secret'

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
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string }
    event.context.user = { id: payload.id, email: payload.email }
  } catch {
    // Invalid or expired token — leave context.user as null
  }
})
