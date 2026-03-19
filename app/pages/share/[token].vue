<script setup lang="ts">
import * as fflate from 'fflate'
import { sanitizeRrwebEvents } from '~/utils/sanitizeRrwebEvents'

definePageMeta({ layout: false, auth: false })

useHead({
  title: 'Shared Recording - bugreel',
  style: [`
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #111113; }
  `],
})

const route = useRoute()
const shareToken = route.params.token as string

// ── DOM refs ──────────────────────────────────────────────────────────────────
const playerWrap = ref<HTMLElement | null>(null)
const playerMount = ref<HTMLElement | null>(null)
const playBtnEl = ref<HTMLElement | null>(null)
const seekerEl = ref<HTMLInputElement | null>(null)
const progressFillEl = ref<HTMLElement | null>(null)
const timeDisplayEl = ref<HTMLElement | null>(null)
const consoleEntriesEl = ref<HTMLElement | null>(null)
const consolePanelEl = ref<HTMLElement | null>(null)
const networkBodyEl = ref<HTMLElement | null>(null)
const consoleCountEl = ref<HTMLElement | null>(null)
const networkCountEl = ref<HTMLElement | null>(null)

// ── State ─────────────────────────────────────────────────────────────────────
const activeTab = ref<'console' | 'network'>('console')
const loadError = ref('')
const loading = ref(true)
const reelName = ref('')
const reelId = ref('')
const expiresAt = ref<string | null>(null)

let recording: any = null
let replayer: any = null
let cachedRrwebEvents: any[] = []
let totalDuration = 0
let pageWidth = 1280
let pageHeight = 720

const clock = {
  playing: false,
  baseOffset: 0,
  playedAt: 0,
  get current() {
    if (!this.playing) return this.baseOffset
    return Math.min(this.baseOffset + (Date.now() - this.playedAt), totalDuration)
  },
  play(offset = this.baseOffset) {
    this.baseOffset = offset
    this.playedAt = Date.now()
    this.playing = true
  },
  pause() {
    this.baseOffset = this.current
    this.playing = false
  },
  seek(offset: number) {
    const wasPlaying = this.playing
    this.baseOffset = Math.max(0, Math.min(offset, totalDuration))
    if (wasPlaying) this.playedAt = Date.now()
    return wasPlaying
  },
}

// ── Load reel from public share API ───────────────────────────────────────────
async function loadReel() {
  try {
    await useRrweb()

    // Load share metadata
    const meta = await $fetch<any>(`/api/share/${shareToken}`)
    reelName.value = meta.name || 'Untitled recording'
    reelId.value = meta.reel_id || ''
    expiresAt.value = meta.expires_at || null

    // Load reel file
    const buffer = await $fetch<ArrayBuffer>(`/api/share/${shareToken}/file`, {
      responseType: 'arrayBuffer',
    })

    const bytes = new Uint8Array(buffer)
    let json: string
    try {
      json = new TextDecoder().decode(fflate.gunzipSync(bytes))
    } catch {
      json = new TextDecoder().decode(bytes)
    }

    recording = JSON.parse(json)
    loading.value = false
    await nextTick()
    initViewer()
  } catch (err: any) {
    loadError.value = err?.data?.message || err?.message || 'Failed to load shared recording'
    loading.value = false
  }
}

// ── Viewer init ───────────────────────────────────────────────────────────────
function initViewer() {
  const { consoleEvents = [], networkEvents = [], meta = {} } = recording

  if (consoleCountEl.value) consoleCountEl.value.textContent = fmtCount(consoleEvents.length)
  if (networkCountEl.value) networkCountEl.value.textContent = fmtCount(networkEvents.length)

  const rawEvents: any[] = recording.rrwebEvents || []
  cachedRrwebEvents = sanitizeRrwebEvents(rawEvents)
  const rrwebEvents = cachedRrwebEvents

  const metaEvent = rrwebEvents.find((e: any) => e.type === 4)
  pageWidth = metaEvent?.data?.width || 1280
  pageHeight = metaEvent?.data?.height || 720

  const firstTs = rawEvents[0]?.timestamp ?? 0
  const lastTs = rawEvents[rawEvents.length - 1]?.timestamp ?? 0
  totalDuration = Math.max(lastTs - firstTs, recording.meta?.duration ?? 0)

  if (playerMount.value) {
    playerMount.value.innerHTML = ''
    try {
      const rrweb = (window as any).rrweb
      replayer = new rrweb.Replayer(rrwebEvents, {
        root: playerMount.value,
        speed: 1,
        showWarning: false,
        showDebug: false,
        triggerFocus: false,
        UNSAFE_replayCanvas: false,
        pauseAnimation: true,
        useVirtualDom: false,
      })
    } catch (err) {
      console.error('[bugreel] Replayer init failed', err)
    }

    injectCapturedFonts()
  }

  applyScale()
  if (playerWrap.value) {
    new ResizeObserver(applyScale).observe(playerWrap.value)
  }

  if (seekerEl.value) {
    seekerEl.value.max = String(totalDuration)
    seekerEl.value.value = '0'
  }
  clock.playing = false
  clock.baseOffset = 0
  if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'

  renderNetworkTable()
  renderAllConsole()
  updateUI(0)
  scheduleTick()
}

// ── Font injection ───────────────────────────────────────────────────────────
let _fontStyleId = '__bugreel_fonts__'
let _fontObserver: MutationObserver | null = null

function buildFontCss(): string {
  const fonts: any[] = recording?.fonts
  if (!fonts?.length) return ''
  let css = ''
  for (const f of fonts) {
    css += `@font-face {\n`
    css += `  font-family: '${f.family}';\n`
    css += `  font-weight: ${f.weight};\n`
    css += `  font-style: ${f.style};\n`
    css += `  src: url('${f.dataUri}') format('${f.format}');\n`
    css += `}\n`
  }
  return css
}

function injectFontsIntoIframe() {
  if (!playerMount.value) return
  const iframe = playerMount.value.querySelector('iframe') as HTMLIFrameElement | null
  const doc = iframe?.contentDocument
  if (!doc?.head) return
  if (doc.getElementById(_fontStyleId)) return
  const css = buildFontCss()
  if (!css) return
  const style = doc.createElement('style')
  style.id = _fontStyleId
  style.textContent = css
  doc.head.appendChild(style)
}

function injectCapturedFonts() {
  if (!recording?.fonts?.length) return
  injectFontsIntoIframe()
  if (_fontObserver) _fontObserver.disconnect()
  _fontObserver = new MutationObserver(() => {
    injectFontsIntoIframe()
  })
  if (playerMount.value) {
    _fontObserver.observe(playerMount.value, { childList: true, subtree: true })
  }
}

// ── Scaling ───────────────────────────────────────────────────────────────────
function applyScale() {
  if (!replayer || !playerWrap.value || !playerMount.value) return
  const availW = playerWrap.value.clientWidth
  const availH = playerWrap.value.clientHeight
  const scale = Math.min(availW / pageWidth, availH / pageHeight)
  const scaledW = pageWidth * scale
  const scaledH = pageHeight * scale
  Object.assign(playerMount.value.style, {
    width: `${pageWidth}px`,
    height: `${pageHeight}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    position: 'absolute',
    left: `${(availW - scaledW) / 2}px`,
    top: `${(availH - scaledH) / 2}px`,
  })
}

// ── Playback controls ─────────────────────────────────────────────────────────
function togglePlay() {
  if (!replayer) return
  if (clock.playing) {
    replayer.pause()
    clock.pause()
    if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'
  } else {
    const offset = clock.baseOffset >= totalDuration ? 0 : clock.baseOffset
    replayer.play(offset)
    clock.play(offset)
    if (playBtnEl.value) playBtnEl.value.textContent = '\u23F8'
    scheduleTick()
  }
}

let seekingFrom: boolean | null = null

function onSeekerMousedown() {
  seekingFrom = clock.playing
  if (clock.playing) {
    replayer?.pause()
    clock.pause()
  }
}

function onSeekerInput() {
  const offset = Number(seekerEl.value?.value ?? 0)
  clock.baseOffset = offset
  updateUI(offset)
}

function onSeekerMouseup() {
  const offset = Number(seekerEl.value?.value ?? 0)
  clock.baseOffset = offset
  if (seekingFrom) {
    replayer?.play(offset)
    clock.play(offset)
    if (playBtnEl.value) playBtnEl.value.textContent = '\u23F8'
    scheduleTick()
  } else {
    replayer?.pause(offset)
    updateUI(offset)
  }
  seekingFrom = null
}

// ── RAF loop ──────────────────────────────────────────────────────────────────
let rafId: number | null = null

function scheduleTick() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(tick)
}

function tick() {
  rafId = null
  if (!replayer) return
  const t = clock.current
  if (seekingFrom === null) {
    if (seekerEl.value) seekerEl.value.value = String(t)
    updateUI(t)
  }
  if (clock.playing) {
    if (t >= totalDuration) {
      replayer.pause()
      clock.pause()
      if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'
    } else {
      scheduleTick()
    }
  }
}

// ── UI sync ───────────────────────────────────────────────────────────────────
function updateUI(t: number) {
  const pct = totalDuration > 0 ? (t / totalDuration) * 100 : 0
  if (progressFillEl.value) progressFillEl.value.style.width = `${pct}%`
  if (timeDisplayEl.value) timeDisplayEl.value.textContent = `${fmtTime(t)} / ${fmtTime(totalDuration)}`
  updateConsole(t)
  updateNetwork(t)
}

// ── Console ───────────────────────────────────────────────────────────────────
let consoleRows: HTMLElement[] = []

function renderAllConsole() {
  if (!recording || !consoleEntriesEl.value) return
  consoleEntriesEl.value.innerHTML = ''
  const events = recording.consoleEvents || []
  consoleRows = []
  for (const ev of events) {
    const row = buildConsoleEntry(ev)
    row.classList.add('future')
    row.dataset.time = String(ev.time)
    consoleEntriesEl.value.appendChild(row)
    consoleRows.push(row)
  }
}

function updateConsole(t: number) {
  let lastPastIdx = -1
  for (let i = 0; i < consoleRows.length; i++) {
    const row = consoleRows[i]
    if (Number(row.dataset.time) <= t) {
      row.classList.remove('future')
      lastPastIdx = i
    } else {
      row.classList.add('future')
    }
  }
  if (lastPastIdx >= 0 && clock.playing && consolePanelEl.value) {
    consoleRows[lastPastIdx].scrollIntoView({ block: 'nearest' })
  }
}

function buildConsoleEntry(ev: any) {
  const row = document.createElement('div')
  row.className = `c-row c-${ev.level}`
  const ts = document.createElement('span')
  ts.className = 'c-ts'
  ts.textContent = fmtTime(ev.time)
  const badge = document.createElement('span')
  badge.className = 'c-badge'
  badge.textContent = ev.level.toUpperCase()
  const msg = document.createElement('span')
  msg.className = 'c-msg'
  msg.textContent = ev.args.map((a: any) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  row.append(ts, badge, msg)
  return row
}

// ── Network ───────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  XHR: '#4c8dff', JS: '#f5c542', CSS: '#c084fc', Img: '#3ecf8e',
  Font: '#f4844a', Media: '#f16370', Doc: '#60a5fa', Other: '#6b6b76',
}

function guessType(ev: any): string {
  const t = (ev.type || '').toLowerCase()
  if (t === 'fetch' || t === 'xmlhttprequest' || t === 'xhr') return 'XHR'
  if (t === 'script') return 'JS'
  if (t === 'link' || t === 'css') return 'CSS'
  if (t === 'img') return 'Img'
  if (t === 'font') return 'Font'
  if (t === 'media' || t === 'video' || t === 'audio') return 'Media'
  const url = (ev.url || '').split('?')[0].toLowerCase()
  if (url.match(/\.(js|mjs|cjs)$/)) return 'JS'
  if (url.match(/\.(css)$/)) return 'CSS'
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/)) return 'Img'
  if (url.match(/\.(woff2?|ttf|otf|eot)$/)) return 'Font'
  if (url.match(/\.(mp4|webm|ogg|mp3|wav)$/)) return 'Media'
  if (url.match(/\.(html?)$/)) return 'Doc'
  if (ev.method && ev.method !== 'GET') return 'XHR'
  return 'Other'
}

function renderNetworkTable() {
  if (!recording || !networkBodyEl.value) return
  const events = recording.networkEvents || []
  networkBodyEl.value.innerHTML = ''
  events.forEach((ev: any, i: number) => {
    const row = document.createElement('tr')
    const rtype = guessType(ev)
    const color = TYPE_COLORS[rtype] || TYPE_COLORS.Other
    row.className = 'net-row net-pending'
    row.dataset.idx = String(i)
    row.innerHTML = `
      <td class="col-method">${escHtml(ev.method || 'GET')}</td>
      <td class="col-status">\u00B7</td>
      <td class="col-type"><span class="net-type-badge" style="color:${color};border-color:${color}">${rtype}</span></td>
      <td class="col-url" title="${escHtml(ev.url)}">${escHtml(fmtUrl(ev.url))}</td>
      <td class="col-dur">\u00B7</td>`
    networkBodyEl.value!.appendChild(row)
  })
}

function updateNetwork(t: number) {
  if (!recording || !networkBodyEl.value) return
  const events = recording.networkEvents || []
  const rows = networkBodyEl.value.querySelectorAll<HTMLTableRowElement>('tr.net-row')
  rows.forEach((row) => {
    const ev = events[Number(row.dataset.idx)]
    const statusEl = row.children[1] as HTMLElement
    const durEl = row.children[4] as HTMLElement
    const endTime = ev.endTime ?? (ev.duration != null ? ev.time + ev.duration : 0)
    let stateClass: string
    if (t < ev.time) {
      stateClass = 'net-pending'
      statusEl.textContent = '\u00B7'
      durEl.textContent = '\u00B7'
    } else if (endTime && t < endTime) {
      stateClass = 'net-active'
      statusEl.textContent = '\u2026'
      durEl.textContent = '\u2026'
    } else if (ev.error) {
      stateClass = 'net-err'
      statusEl.textContent = 'ERR'
      durEl.textContent = ev.duration != null ? `${ev.duration}ms` : '\u00B7'
    } else {
      const s = ev.status || 0
      stateClass = s >= 500 ? 'net-5xx' : s >= 400 ? 'net-4xx' : s >= 300 ? 'net-3xx' : 'net-ok'
      statusEl.textContent = String(s || '\u00B7')
      durEl.textContent = ev.duration != null ? `${ev.duration}ms` : '\u00B7'
    }
    row.className = `net-row ${stateClass}`
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCount(n: number): string { return n > 99 ? '99+' : String(n) }

function fmtTime(ms: number) {
  if (!ms || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const tenths = Math.floor((ms % 1000) / 100)
  return `${m}:${String(s % 60).padStart(2, '0')}.${tenths}`
}

function fmtUrl(url: string) {
  try {
    const u = new URL(url)
    return (u.pathname + u.search).slice(0, 60) || '/'
  } catch {
    return url.slice(0, 60)
  }
}

function escHtml(s: any) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatExpiry(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  if (diff <= 0) return 'expired'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `in ${days}d ${hours}h`
  if (hours > 0) return `in ${hours}h`
  const mins = Math.floor(diff / (1000 * 60))
  return `in ${mins}m`
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  loadReel()
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  replayer?.pause?.()
  if (_fontObserver) { _fontObserver.disconnect(); _fontObserver = null }
})
</script>

<template>
  <div class="share-root">
    <!-- Loading state -->
    <div v-if="loading" class="center-screen">
      <div class="loading-text">Loading shared recording...</div>
    </div>

    <!-- Error state -->
    <div v-else-if="loadError" class="center-screen">
      <div class="error-box">
        <div class="error-title">Failed to load recording</div>
        <div class="error-msg">{{ loadError }}</div>
      </div>
    </div>

    <!-- Viewer -->
    <template v-else>
      <!-- Header bar -->
      <div id="share-header">
        <div class="share-brand">
          <div class="share-dot" />
          <span class="share-brand-text">bugreel</span>
        </div>
        <div class="share-meta">
          <span class="share-badge">Shared recording</span>
          <span class="share-name">{{ reelName }}</span>
          <span v-if="expiresAt" class="share-expires">Expires {{ formatExpiry(expiresAt) }}</span>
        </div>
        <div class="share-actions">
          <a v-if="reelId" :href="`/reel/${reelId}`" class="share-view-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            <span>View on bugreel</span>
          </a>
        </div>
      </div>

      <!-- Main area -->
      <div id="main">
        <!-- Player -->
        <div ref="playerWrap" id="player-wrap">
          <div ref="playerMount" id="player-mount" />
        </div>

        <!-- Side panel -->
        <div id="side-panel">
          <div id="tab-bar">
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'console' }"
              @click="activeTab = 'console'"
            >
              Console
              <span ref="consoleCountEl" class="tab-count">0</span>
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'network' }"
              @click="activeTab = 'network'"
            >
              Network
              <span ref="networkCountEl" class="tab-count">0</span>
            </button>
          </div>

          <!-- Console panel -->
          <div
            ref="consolePanelEl"
            class="panel"
            :class="{ active: activeTab === 'console' }"
            id="console-panel"
          >
            <div ref="consoleEntriesEl" id="console-entries" />
          </div>

          <!-- Network panel -->
          <div
            class="panel"
            :class="{ active: activeTab === 'network' }"
            id="network-panel"
          >
            <div class="net-table-wrap">
              <table class="net-table">
                <thead>
                  <tr>
                    <th class="col-method">Method</th>
                    <th class="col-status">Status</th>
                    <th class="col-type">Type</th>
                    <th class="col-url">URL</th>
                    <th class="col-dur">Time</th>
                  </tr>
                </thead>
                <tbody ref="networkBodyEl" id="network-body" />
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div id="controls">
        <button ref="playBtnEl" id="play-btn" @click="togglePlay">&#x25B6;</button>
        <div id="timeline">
          <div ref="progressFillEl" id="progress-fill" />
          <input
            ref="seekerEl"
            id="seeker"
            type="range"
            min="0"
            step="1"
            @mousedown="onSeekerMousedown"
            @input="onSeekerInput"
            @mouseup="onSeekerMouseup"
          />
        </div>
        <span ref="timeDisplayEl" id="time-display">0:00.0 / 0:00.0</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.share-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #111113;
  color: #e2e2e6;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 12px;
  overflow: hidden;
}

/* ── Loading / Error ─────────────────────────────────────────────────────── */
.center-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

.loading-text {
  color: #6b6b76;
  font-size: 14px;
}

.error-box {
  text-align: center;
}

.error-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #f16370;
}

.error-msg {
  font-size: 12px;
  color: #6b6b76;
}

/* ── Share header ────────────────────────────────────────────────────────── */
#share-header {
  height: 40px;
  flex-shrink: 0;
  background: #1c1c1f;
  border-bottom: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
}

.share-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.share-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff4070;
}

.share-brand-text {
  font-weight: 700;
  font-size: 13px;
  color: #e2e2e6;
  letter-spacing: -0.3px;
}

.share-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.share-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  background: rgba(76, 141, 255, 0.12);
  color: #93bbfd;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  flex-shrink: 0;
}

.share-name {
  color: #a0a0ab;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-expires {
  color: #6b6b76;
  font-size: 10px;
  flex-shrink: 0;
}

.share-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  margin-left: auto;
}

.share-view-link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px 3px 8px;
  border-radius: 5px;
  border: 1px solid rgba(76, 141, 255, 0.20);
  background: rgba(76, 141, 255, 0.08);
  color: #93bbfd;
  font-size: 10.5px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.15s;
  white-space: nowrap;
}

.share-view-link:hover {
  background: rgba(76, 141, 255, 0.15);
  border-color: rgba(76, 141, 255, 0.40);
  color: #bdd4fe;
}

/* ── Main ────────────────────────────────────────────────────────────────── */
#main {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

/* ── Player ──────────────────────────────────────────────────────────────── */
#player-wrap {
  flex: 1;
  position: relative;
  background: #0a0a0b;
  overflow: hidden;
  min-width: 0;
}

#player-mount :deep(.replayer-wrapper) {
  pointer-events: none;
}

/* ── Side panel ──────────────────────────────────────────────────────────── */
#side-panel {
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid #2e2e33;
  display: flex;
  flex-direction: column;
  background: #1c1c1f;
  min-height: 0;
}

#tab-bar {
  display: flex;
  border-bottom: 1px solid #2e2e33;
  flex-shrink: 0;
  background: #1c1c1f;
}

.tab-btn {
  flex: 1;
  padding: 9px 6px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #6b6b76;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: color 0.15s;
  white-space: nowrap;
}

.tab-btn:hover { color: #e2e2e6; }

.tab-btn.active {
  color: #e2e2e6;
  border-bottom-color: #4c8dff;
}

.tab-count {
  background: #242428;
  color: #6b6b76;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
  min-width: 18px;
  text-align: center;
  flex-shrink: 0;
}

.tab-btn.active .tab-count {
  background: rgba(76, 141, 255, 0.15);
  color: #4c8dff;
}

.panel {
  display: none;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.panel.active { display: block; }
#network-panel.active {
  display: flex;
  flex-direction: column;
  overflow-y: hidden;
}
#network-panel .net-table-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

/* ── Console ─────────────────────────────────────────────────────────────── */
#console-entries { padding: 2px 0; }
:deep(.c-row.future) { opacity: 0.3; }

:deep(.c-row) {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 3px 10px 3px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  border-left: 2px solid transparent;
}

:deep(.c-row:hover) { background: rgba(255,255,255,0.03); }
:deep(.c-warn)  { border-left-color: #f5c542; background: rgba(245, 197, 66, 0.04); }
:deep(.c-error) { border-left-color: #f16370; background: rgba(241, 99, 112, 0.05); }
:deep(.c-info)  { border-left-color: #4c8dff; }

:deep(.c-ts) {
  color: #6b6b76;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 46px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

:deep(.c-badge) {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
}

:deep(.c-log .c-badge)   { background: #2a2a2e; color: #77777d; }
:deep(.c-debug .c-badge) { background: #1f1f30; color: #8080c0; }
:deep(.c-info .c-badge)  { background: rgba(76,141,255,0.15); color: #4c8dff; }
:deep(.c-warn .c-badge)  { background: rgba(245,197,66,0.15); color: #f5c542; }
:deep(.c-error .c-badge) { background: rgba(241,99,112,0.15); color: #f16370; }

:deep(.c-msg) {
  color: #e2e2e6;
  word-break: break-all;
  white-space: pre-wrap;
  flex: 1;
  min-width: 0;
}

:deep(.c-warn .c-msg)  { color: #f5c542; }
:deep(.c-error .c-msg) { color: #f16370; }

/* ── rrweb cursor ────────────────────────────────────────────────────────── */
:deep(.replayer-mouse) {
  filter: invert(1) drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9)) !important;
}
:deep(.replayer-mouse::after) { display: none !important; }
:deep(.replayer-mouse-tail)   { display: none !important; }

/* ── Network panel ───────────────────────────────────────────────────────── */
.net-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.net-table :deep(thead th) {
  position: sticky;
  top: 0;
  background: #1c1c1f;
  padding: 7px 8px;
  text-align: left;
  color: #6b6b76;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #2e2e33;
  z-index: 1;
}

.net-table :deep(tbody tr.net-row) {
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: opacity 0.2s;
}

.net-table :deep(tbody tr.net-row:hover) { background: rgba(255,255,255,0.06); }

.net-table :deep(td) {
  padding: 4px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.net-table :deep(.col-method) { width: 56px; }
.net-table :deep(.col-status) { width: 48px; }
.net-table :deep(.col-type)   { width: 52px; }
.net-table :deep(.col-dur)    { width: 60px; text-align: right; }

.net-table :deep(.net-type-badge) {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3px;
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 16px;
  opacity: 0.85;
}

.net-table :deep(.net-pending) { opacity: 0.25; }

.net-table :deep(.net-active .col-status) {
  color: #4c8dff;
  animation: blink 1.1s ease-in-out infinite;
}

.net-table :deep(.net-ok .col-status)  { color: #3ecf8e; font-weight: 600; }
.net-table :deep(.net-3xx .col-status) { color: #f4844a; font-weight: 600; }
.net-table :deep(.net-4xx .col-status) { color: #f5c542; font-weight: 600; }
.net-table :deep(.net-5xx .col-status) { color: #f16370; font-weight: 600; }
.net-table :deep(.net-err .col-status) { color: #f16370; font-weight: 600; }

.net-table :deep(.col-dur) { color: #6b6b76; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

/* ── Controls ────────────────────────────────────────────────────────────── */
#controls {
  height: 44px;
  flex-shrink: 0;
  background: #1c1c1f;
  border-top: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}

#play-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #4c8dff;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s, transform 0.1s;
}

#play-btn:hover { background: #3a7de8; }
#play-btn:active { transform: scale(0.93); }

#timeline {
  flex: 1;
  position: relative;
  height: 4px;
  background: #2e2e33;
  border-radius: 2px;
  cursor: pointer;
}

#progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #4c8dff;
  border-radius: 2px;
  pointer-events: none;
  will-change: width;
}

#seeker {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  margin: 0;
  top: -10px;
  height: calc(100% + 20px);
}

#time-display {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  color: #6b6b76;
  flex-shrink: 0;
  min-width: 100px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
