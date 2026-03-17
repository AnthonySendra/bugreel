import { readFileSync } from 'fs'
import { join } from 'path'

export default defineEventHandler((event) => {
  const file = getRouterParam(event, 'file')
  if (!file || !/^[\w.-]+\.js$/.test(file)) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }

  const filePath = join(process.cwd(), 'public', 'recorder-lib', file)
  try {
    const content = readFileSync(filePath, 'utf-8')
    setResponseHeaders(event, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    })
    return send(event, content, 'text/javascript; charset=utf-8')
  } catch {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
})
