/**
 * Background job: once per day, delete reels with status 'done' that are
 * older than NUXT_PURGE_DONE_DAYS (default 7).
 *
 * For each expired reel the job deletes the file (S3 or local disk),
 * its comments, and the reel record itself.
 */
import { unlinkSync } from 'fs'
import { join } from 'path'
import { db, reelsDir } from '~/server/utils/db'
import { getS3Config, deleteObject } from '~/server/utils/s3'

interface DoneReel {
  id: string
  filename: string
}

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const INITIAL_DELAY_MS = 30_000 // 30 seconds after start

async function purgeDoneReels() {
  const config = useRuntimeConfig()
  const purgeDays = parseInt(String(config.purgeDoneDays), 10) || 7
  const cutoff = Date.now() - purgeDays * 86_400_000

  const reels = db
    .prepare(`
      SELECT id, filename
      FROM reels
      WHERE status = 'done'
        AND created_at < ?
    `)
    .all(cutoff) as DoneReel[]

  if (reels.length === 0) {
    console.log('[purge-done] No reels to purge')
    return
  }

  console.log(`[purge-done] Purging ${reels.length} reel(s) older than ${purgeDays} days…`)

  const s3 = getS3Config()

  for (const reel of reels) {
    try {
      // Delete file from S3 if configured
      if (s3) {
        try {
          await deleteObject(reel.filename)
        } catch {
          // S3 deletion failed — continue with local cleanup
        }
      }

      // Delete file from disk
      try {
        unlinkSync(join(reelsDir, reel.filename))
      } catch {
        // File may already be missing — continue
      }

      // Delete comments then the reel record
      db.prepare('DELETE FROM reel_comments WHERE reel_id = ?').run(reel.id)
      db.prepare('DELETE FROM reels WHERE id = ?').run(reel.id)

      console.log(`[purge-done] Deleted reel ${reel.id}`)
    } catch (err) {
      console.error(`[purge-done] Failed to delete reel ${reel.id}:`, err)
    }
  }
}

export default defineNitroPlugin(() => {
  // First run 30 seconds after server start
  const initialTimeout = setTimeout(() => {
    purgeDoneReels().catch(() => {})
  }, INITIAL_DELAY_MS)

  // Then once per day
  const interval = setInterval(() => {
    purgeDoneReels().catch(() => {})
  }, PURGE_INTERVAL_MS)

  // Cleanup on server shutdown
  const nuxtApp = useNitroApp()
  nuxtApp.hooks.hook('close', () => {
    clearTimeout(initialTimeout)
    clearInterval(interval)
  })
})
