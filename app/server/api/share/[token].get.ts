import { db } from '~/server/utils/db'

interface SharedReel {
  id: string
  original_name: string | null
  created_at: number
  size: number | null
  share_token: string
  share_expires_at: number | null
}

export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')!

  const reel = db
    .prepare('SELECT id, original_name, created_at, size, share_token, share_expires_at FROM reels WHERE share_token = ?')
    .get(token) as SharedReel | undefined

  if (!reel) throw createError({ statusCode: 404, message: 'Shared reel not found' })

  if (reel.share_expires_at && reel.share_expires_at < Date.now()) {
    throw createError({ statusCode: 410, message: 'Share link has expired' })
  }

  return {
    id: reel.id,
    original_name: reel.original_name,
    created_at: reel.created_at,
    size: reel.size,
  }
})
