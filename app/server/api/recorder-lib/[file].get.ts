import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

export default defineEventHandler((event) => {
  const file = getRouterParam(event, 'file')
  if (!file || !/^[\w.-]+\.js$/.test(file)) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  // Try multiple paths: dev (public/) and production (.output/public/)
  const candidates = [
    join(process.cwd(), 'public', 'recorder-lib', file),
    join(process.cwd(), '.output', 'public', 'recorder-lib', file),
  ]

  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8')
      setResponseHeaders(event, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      })
      return send(event, content, 'text/javascript; charset=utf-8')
    }
  }

  throw createError({ statusCode: 404, message: 'Not found' })
})
