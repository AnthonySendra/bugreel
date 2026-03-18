import { readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { db, reelsDir } from '~/server/utils/db'
import { requireReelAccess } from '~/server/utils/workspace-access'

export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ statusCode: 401, message: 'Unauthorized' })

  const reelId = getRouterParam(event, 'id')!
  const { reel } = requireReelAccess(reelId, user.id)

  const filePath = join(reelsDir, reel.filename)
  let buffer: Buffer
  try {
    buffer = readFileSync(filePath)
  } catch {
    throw createError({ statusCode: 404, message: 'Reel file not found on disk' })
  }

  let json: string
  try {
    json = gunzipSync(buffer).toString('utf-8')
  } catch {
    json = buffer.toString('utf-8')
  }

  const data = JSON.parse(json)
  const rrwebEvents: any[] = data.rrwebEvents || []

  // Return only Meta (type 4) + FullSnapshot (type 2) — the minimum needed to render the first frame
  const thumbEvents = rrwebEvents.filter((e: any) => e.type === 4 || e.type === 2)

  return { events: thumbEvents }
})
