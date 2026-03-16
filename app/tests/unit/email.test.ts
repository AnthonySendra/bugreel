import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// email.ts reads env vars at module load time, so we reset modules between tests
// and re-import dynamically to test different configurations.

describe('isEmailEnabled', () => {
  const origEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...origEnv }
    vi.resetModules()
  })

  it('returns false when NUXT_EMAIL_PROVIDER is not set', async () => {
    delete process.env.NUXT_EMAIL_PROVIDER
    const { isEmailEnabled } = await import('~/server/utils/email')
    expect(isEmailEnabled()).toBe(false)
  })

  it('returns true when NUXT_EMAIL_PROVIDER is "console"', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'console'
    const { isEmailEnabled } = await import('~/server/utils/email')
    expect(isEmailEnabled()).toBe(true)
  })

  it('returns true when NUXT_EMAIL_PROVIDER is "resend"', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'resend'
    const { isEmailEnabled } = await import('~/server/utils/email')
    expect(isEmailEnabled()).toBe(true)
  })
})

describe('sendEmail', () => {
  afterEach(() => {
    delete process.env.NUXT_EMAIL_PROVIDER
    vi.resetModules()
  })

  it('is a no-op and does not throw when no provider is configured', async () => {
    delete process.env.NUXT_EMAIL_PROVIDER
    const { sendEmail } = await import('~/server/utils/email')
    await expect(sendEmail({ to: 'a@b.com', subject: 'test', html: '<p>hi</p>' })).resolves.toBeUndefined()
  })

  it('calls the console provider when configured', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'console'
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendEmail } = await import('~/server/utils/email')
    await sendEmail({ to: 'a@b.com', subject: 'Hello', html: '<p>World</p>' })
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('a@b.com'))
    consoleSpy.mockRestore()
  })
})

describe('email template helpers', () => {
  afterEach(() => {
    delete process.env.NUXT_EMAIL_PROVIDER
    vi.resetModules()
  })

  it('sendVerificationEmail calls sendEmail with a verification link', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'console'
    process.env.NUXT_PUBLIC_BASE_URL = 'https://app.example.com'
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendVerificationEmail } = await import('~/server/utils/email')
    await sendVerificationEmail('user@example.com', 'my-token-abc')
    const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(calls).toContain('verify-email?token=my-token-abc')
    expect(calls).toContain('app.example.com')
    consoleSpy.mockRestore()
  })

  it('sendPasswordResetEmail calls sendEmail with a reset link', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'console'
    process.env.NUXT_PUBLIC_BASE_URL = 'https://app.example.com'
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendPasswordResetEmail } = await import('~/server/utils/email')
    await sendPasswordResetEmail('user@example.com', 'reset-token-xyz')
    const calls = consoleSpy.mock.calls.map(c => c[0]).join('\n')
    expect(calls).toContain('reset-password?token=reset-token-xyz')
    consoleSpy.mockRestore()
  })
})
