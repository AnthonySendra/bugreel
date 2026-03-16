import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/server/utils/db', () => ({
  db: { prepare: vi.fn() },
  reelsDir: '/tmp/test-reels',
}))

vi.mock('~/server/utils/email', () => ({
  isEmailEnabled: vi.fn(() => false),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(() => Promise.resolve('hashed')),
  },
}))

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-jwt-token'),
    verify: vi.fn(),
  },
}))

import { db } from '~/server/utils/db'
import { isEmailEnabled } from '~/server/utils/email'
import bcrypt from 'bcryptjs'
import handler from '~/server/api/auth/login.post'

function createEvent(body: unknown) {
  const event = { context: {} }
  ;(readBody as ReturnType<typeof vi.fn>).mockResolvedValue(body)
  return event
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws 400 when email is missing', async () => {
    const event = createEvent({ password: 'secret' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when password is missing', async () => {
    const event = createEvent({ email: 'a@b.com' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 401 when user is not found', async () => {
    ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({ get: vi.fn(() => undefined) })
    const event = createEvent({ email: 'unknown@b.com', password: 'pass' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 401 when password is incorrect', async () => {
    ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => ({ id: '1', email: 'a@b.com', password_hash: 'hash', email_verified: 1, created_at: 0 })),
    })
    ;(bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const event = createEvent({ email: 'a@b.com', password: 'wrong' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('throws 403 when email is not verified and email is enabled', async () => {
    ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => ({ id: '1', email: 'a@b.com', password_hash: 'hash', email_verified: 0, created_at: 0 })),
    })
    ;(bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(isEmailEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const event = createEvent({ email: 'a@b.com', password: 'correct' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns token and user on success', async () => {
    ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn(() => ({ id: 'user-1', email: 'a@b.com', password_hash: 'hash', email_verified: 1, created_at: 0 })),
    })
    ;(bcrypt.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(isEmailEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const event = createEvent({ email: 'a@b.com', password: 'correct' })
    const result = await (handler as Function)(event)
    expect(result.token).toBe('mock-jwt-token')
    expect(result.user).toMatchObject({ id: 'user-1', email: 'a@b.com', email_verified: true })
  })

  it('normalises email to lowercase', async () => {
    const mockGet = vi.fn(() => undefined)
    ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({ get: mockGet })
    const event = createEvent({ email: 'A@B.COM', password: 'pass' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(mockGet).toHaveBeenCalledWith('a@b.com')
  })
})
