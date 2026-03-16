import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
  },
}))

import jwt from 'jsonwebtoken'
import middleware from '~/server/middleware/auth'

function createEvent(authHeader?: string, query: Record<string, string> = {}) {
  const event = { context: {} as any }
  ;(getHeader as ReturnType<typeof vi.fn>).mockImplementation((_: unknown, name: string) =>
    name === 'authorization' ? authHeader ?? null : null,
  )
  ;(getQuery as ReturnType<typeof vi.fn>).mockReturnValue(query)
  return event
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets user to null when no token is provided', () => {
    const event = createEvent()
    ;(middleware as Function)(event)
    expect(event.context.user).toBeNull()
  })

  it('sets user from a valid Bearer token', () => {
    ;(jwt.verify as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'user-1', email: 'a@b.com' })
    const event = createEvent('Bearer valid-token')
    ;(middleware as Function)(event)
    expect(event.context.user).toEqual({ id: 'user-1', email: 'a@b.com' })
  })

  it('sets user to null when the token is invalid', () => {
    ;(jwt.verify as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('invalid') })
    const event = createEvent('Bearer bad-token')
    ;(middleware as Function)(event)
    expect(event.context.user).toBeNull()
  })

  it('ignores a malformed Authorization header (no Bearer prefix)', () => {
    const event = createEvent('Token abc')
    ;(middleware as Function)(event)
    expect(event.context.user).toBeNull()
    expect(jwt.verify).not.toHaveBeenCalled()
  })

  it('sets user from a valid query-string token', () => {
    ;(jwt.verify as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'user-2', email: 'b@b.com' })
    const event = createEvent(undefined, { token: 'query-token' })
    ;(middleware as Function)(event)
    expect(event.context.user).toEqual({ id: 'user-2', email: 'b@b.com' })
  })
})
