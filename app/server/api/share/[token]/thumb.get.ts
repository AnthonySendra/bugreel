import { readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { db, reelsDir } from '~/server/utils/db'

interface SharedReel {
  id: string
  filename: string
  share_token: string
  share_expires_at: number | null
}

export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')!

  const reel = db
    .prepare('SELECT id, filename, share_token, share_expires_at FROM reels WHERE share_token = ?')
    .get(token) as SharedReel | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Shared reel not found' })

  if (reel.share_expires_at && reel.share_expires_at < Date.now()) {
    throw createError({ statusCode: 410, message: 'Share link has expired' })
  }

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
