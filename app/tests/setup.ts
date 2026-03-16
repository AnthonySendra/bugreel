import { vi } from 'vitest'

// Simulate Nuxt/H3 auto-imports so server handler files can be imported in tests
globalThis.defineEventHandler = (fn: Function) => fn

globalThis.createError = ({ statusCode, message }: { statusCode: number; message: string }) => {
  const err = new Error(message) as any
  err.statusCode = statusCode
  err.data = { message }
  return err
}

globalThis.readBody = vi.fn()
globalThis.getHeader = vi.fn()
globalThis.getQuery = vi.fn(() => ({}))
globalThis.getRouterParam = vi.fn()
