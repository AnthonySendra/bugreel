import jwt from 'jsonwebtoken'
import type { H3Event } from 'h3'

/**
 * Returns the JWT secret from runtimeConfig (NUXT_JWT_SECRET env var).
 * Throws HTTP 500 in production if the secret is not set.
 * Falls back to a dev-only default in development to avoid friction.
 */
export function getJwtSecret(event: H3Event): string {
  const secret = useRuntimeConfig(event).jwtSecret
  if (secret) return secret

  if (process.env.NODE_ENV === 'production') {
    throw createError({ statusCode: 500, message: 'Server misconfiguration: NUXT_JWT_SECRET is not set' })
  }

  return 'bugreel-dev-secret'
}

export function signUserToken(payload: { id: string; email: string }, event: H3Event): string {
  return jwt.sign(payload, getJwtSecret(event), { expiresIn: '30d' })
}
