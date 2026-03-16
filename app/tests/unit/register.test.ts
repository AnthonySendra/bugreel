import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('~/server/utils/db', () => ({
  db: { prepare: vi.fn() },
  reelsDir: '/tmp/test-reels',
}))

vi.mock('~/server/utils/email', () => ({
  isEmailEnabled: vi.fn(() => false),
  sendVerificationEmail: vi.fn(() => Promise.resolve()),
}))

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => Promise.resolve('hashed-password')),
  },
}))

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(() => 'mock-jwt-token'),
  },
}))

import { db } from '~/server/utils/db'
import { isEmailEnabled, sendVerificationEmail } from '~/server/utils/email'
import handler from '~/server/api/auth/register.post'

function createEvent(body: unknown) {
  const event = { context: {} }
  ;(readBody as ReturnType<typeof vi.fn>).mockResolvedValue(body)
  return event
}

function setupDb(existingUser: unknown = null) {
  const mockRun = vi.fn()
  const mockGet = vi.fn(() => existingUser)
  ;(db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({ get: mockGet, run: mockRun })
  return { mockGet, mockRun }
}

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws 400 when email is missing', async () => {
    const event = createEvent({ password: 'secret123' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when password is missing', async () => {
    const event = createEvent({ email: 'a@b.com' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 400 when password is shorter than 6 characters', async () => {
    const event = createEvent({ email: 'a@b.com', password: '12345' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 409 when email is already registered', async () => {
    setupDb({ id: 'existing-user' })
    const event = createEvent({ email: 'taken@b.com', password: 'secret123' })
    await expect((handler as Function)(event)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('returns token and user on success (email disabled)', async () => {
    setupDb(null)
    ;(isEmailEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const event = createEvent({ email: 'new@b.com', password: 'secret123' })
    const result = await (handler as Function)(event)
    expect(result.token).toBe('mock-jwt-token')
    expect(result.user.email).toBe('new@b.com')
    expect(result.user.email_verified).toBe(true)
    expect(result.message).toBeUndefined()
  })

  it('returns a message and sends verification email when email is enabled', async () => {
    setupDb(null)
    ;(isEmailEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const event = createEvent({ email: 'new@b.com', password: 'secret123' })
    const result = await (handler as Function)(event)
    expect(result.message).toContain('verify')
    expect(sendVerificationEmail).toHaveBeenCalledWith('new@b.com', expect.any(String))
  })

  it('normalises email to lowercase', async () => {
    const { mockGet } = setupDb(null)
    ;(isEmailEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const event = createEvent({ email: 'UPPER@B.COM', password: 'secret123' })
    await (handler as Function)(event)
    expect(mockGet).toHaveBeenCalledWith('upper@b.com')
  })
})
