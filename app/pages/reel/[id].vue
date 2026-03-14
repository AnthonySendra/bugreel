<script setup lang="ts">
import * as fflate from 'fflate'

definePageMeta({ layout: false })

useHead({
  style: [`
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #111113; }
  `],
})

const route = useRoute()
const { token } = useAuth()
const reelId = route.params.id as string

// ── DOM refs ──────────────────────────────────────────────────────────────────
const playerWrap = ref<HTMLElement | null>(null)
const playerMount = ref<HTMLElement | null>(null)
const playBtnEl = ref<HTMLElement | null>(null)
const seekerEl = ref<HTMLInputElement | null>(null)
const progressFillEl = ref<HTMLElement | null>(null)
const timeDisplayEl = ref<HTMLElement | null>(null)
const metaUrlEl = ref<HTMLElement | null>(null)
const metaDateEl = ref<HTMLElement | null>(null)
const consoleEntriesEl = ref<HTMLElement | null>(null)
const consolePanelEl = ref<HTMLElement | null>(null)
const networkBodyEl = ref<HTMLElement | null>(null)
const consoleCountEl = ref<HTMLElement | null>(null)
const networkCountEl = ref<HTMLElement | null>(null)
const commentsCountEl = ref<HTMLElement | null>(null)

// ── State ─────────────────────────────────────────────────────────────────────
const activeTab = ref<'console' | 'network' | 'comments'>('console')
const comments = ref<any[]>([])
const newCommentContent = ref('')
const openReplyId = ref<string | null>(null)
const replyContent = ref('')
const submitting = ref(false)
const currentTimeDisplay = ref('0:00.0')

const commentThreads = computed(() => {
  const roots = comments.value.filter(c => !c.parent_id)
  return roots.map(root => ({
    ...root,
    replies: comments.value.filter(c => c.parent_id === root.id),
  }))
})
const loadError = ref('')
const loading = ref(true)

let recording: any = null
let replayer: any = null
let totalDuration = 0
let pageWidth = 1280
let pageHeight = 720
let urlChanges: { offset: number; url: string }[] = []

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

// ── Load reel from API ────────────────────────────────────────────────────────
async function loadReel() {
  try {
    await useRrweb()

    const headers: Record<string, string> = token.value
      ? { Authorization: `Bearer ${token.value}` }
      : {}

    const buffer = await $fetch<ArrayBuffer>(`/api/reels/${reelId}/file`, {
      responseType: 'arrayBuffer',
      headers,
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
    loadError.value = err?.data?.message || err?.message || 'Failed to load reel'
    loading.value = false
  }
}

// ── Viewer init ───────────────────────────────────────────────────────────────
function initViewer() {
  const { consoleEvents = [], networkEvents = [], meta = {} } = recording

  if (metaDateEl.value) metaDateEl.value.textContent = meta.recordedAt ? new Date(meta.recordedAt).toLocaleString() : ''
  if (consoleCountEl.value) consoleCountEl.value.textContent = String(consoleEvents.length)
  if (networkCountEl.value) networkCountEl.value.textContent = String(networkEvents.length)

  // Raw events: used for duration (includes bugreel-end marker)
  const rawEvents: any[] = recording.rrwebEvents || []
  // Sanitized events: passed to Replayer (bugreel-end filtered out, CORS links stripped)
  const rrwebEvents = sanitizeRrwebEvents(rawEvents)

  const metaEvent = rrwebEvents.find((e: any) => e.type === 4)
  pageWidth = metaEvent?.data?.width || 1280
  pageHeight = metaEvent?.data?.height || 720

  // Debug — remove once diagnosed
  const typeCounts = rawEvents.reduce((acc: any, e: any) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc }, {})
  const srcCounts = rawEvents.filter((e: any) => e.type === 3).reduce((acc: any, e: any) => { acc[e.data?.source] = (acc[e.data?.source] || 0) + 1; return acc }, {})
  console.log('[bugreel] raw events:', rawEvents.length, 'by type:', typeCounts, '| type-3 sources:', srcCounts)
  console.log('[bugreel] replayer events (sanitized):', rrwebEvents.length)

  const firstTs = rawEvents[0]?.timestamp ?? 0
  const lastTs = rawEvents[rawEvents.length - 1]?.timestamp ?? 0
  // Use the larger of: rrweb event span (including end marker) or meta.duration (wall-clock).
  // This handles static pages where rrweb emits no incremental events.
  totalDuration = Math.max(lastTs - firstTs, recording.meta?.duration ?? 0)

  // Build URL change timeline: initial URL + navigation events (type 3, source 4)
  urlChanges = []
  if (metaEvent?.data?.href) {
    urlChanges.push({ offset: 0, url: metaEvent.data.href })
  } else if (meta.url) {
    urlChanges.push({ offset: 0, url: meta.url })
  }
  for (const e of rrwebEvents) {
    if (e.type === 3 && e.data?.source === 4 && e.data?.href) {
      urlChanges.push({ offset: e.timestamp - firstTs, url: e.data.href })
    }
  }

  if (metaUrlEl.value) metaUrlEl.value.textContent = urlChanges[0]?.url || meta.url || ''

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
  if (playBtnEl.value) playBtnEl.value.textContent = '▶'

  renderNetworkTable()
  resetConsole()
  updateUI(0)
  scheduleTick()
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
    if (playBtnEl.value) playBtnEl.value.textContent = '▶'
  } else {
    const offset = clock.baseOffset >= totalDuration ? 0 : clock.baseOffset
    replayer.play(offset)
    clock.play(offset)
    if (playBtnEl.value) playBtnEl.value.textContent = '⏸'
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
    if (playBtnEl.value) playBtnEl.value.textContent = '⏸'
    scheduleTick()
  } else {
    replayer?.pause(offset)
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
      if (playBtnEl.value) playBtnEl.value.textContent = '▶'
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
  currentTimeDisplay.value = fmtTime(t)
  // Update URL to reflect navigation at time t
  if (metaUrlEl.value && urlChanges.length) {
    let url = urlChanges[0].url
    for (const change of urlChanges) {
      if (change.offset <= t) url = change.url
      else break
    }
    metaUrlEl.value.textContent = url
  }
  updateConsole(t)
  updateNetwork(t)
}

// ── Console ───────────────────────────────────────────────────────────────────
let lastConsoleIdx = 0

function resetConsole() {
  if (consoleEntriesEl.value) consoleEntriesEl.value.innerHTML = ''
  lastConsoleIdx = 0
}

function updateConsole(t: number) {
  if (!recording || !consoleEntriesEl.value) return
  const events = recording.consoleEvents || []
  if (lastConsoleIdx > 0 && events[lastConsoleIdx - 1]?.time > t) {
    consoleEntriesEl.value.innerHTML = ''
    lastConsoleIdx = 0
  }
  let appended = false
  while (lastConsoleIdx < events.length && events[lastConsoleIdx].time <= t) {
    consoleEntriesEl.value.appendChild(buildConsoleEntry(events[lastConsoleIdx]))
    lastConsoleIdx++
    appended = true
  }
  if (appended && clock.playing && consolePanelEl.value) {
    consolePanelEl.value.scrollTop = consolePanelEl.value.scrollHeight
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
let expandedNetIdx: number | null = null

function renderNetworkTable() {
  if (!recording || !networkBodyEl.value) return
  const events = recording.networkEvents || []
  networkBodyEl.value.innerHTML = ''
  events.forEach((ev: any, i: number) => {
    const row = document.createElement('tr')
    row.className = 'net-row net-pending'
    row.dataset.idx = String(i)
    row.innerHTML = `
      <td class="col-method">${escHtml(ev.method || '?')}</td>
      <td class="col-status">·</td>
      <td class="col-url" title="${escHtml(ev.url)}">${escHtml(fmtUrl(ev.url))}</td>
      <td class="col-dur">·</td>`
    row.addEventListener('click', () => toggleNetworkDetail(i))
    networkBodyEl.value!.appendChild(row)
  })
}

function toggleNetworkDetail(idx: number) {
  if (!networkBodyEl.value) return
  const existing = networkBodyEl.value.querySelector('.net-detail-row')
  const wasThisOne = expandedNetIdx === idx
  if (existing) {
    existing.remove()
    networkBodyEl.value.querySelector(`tr[data-idx="${expandedNetIdx}"]`)?.classList.remove('expanded')
    expandedNetIdx = null
  }
  if (wasThisOne) return
  const ev = recording.networkEvents[idx]
  const mainRow = networkBodyEl.value.querySelector(`tr[data-idx="${idx}"]`) as HTMLTableRowElement | null
  if (!mainRow) return
  mainRow.classList.add('expanded')
  expandedNetIdx = idx
  const detailRow = document.createElement('tr')
  detailRow.className = 'net-detail-row'
  const td = document.createElement('td')
  td.colSpan = 4
  td.innerHTML = buildDetailHTML(ev)
  detailRow.appendChild(td)
  mainRow.after(detailRow)
  td.querySelectorAll('.net-detail-tab').forEach((btn: any) => {
    btn.addEventListener('click', () => {
      td.querySelectorAll('.net-detail-tab').forEach((b: any) => b.classList.remove('active'))
      td.querySelectorAll('.net-detail-pane').forEach((p: any) => p.classList.remove('active'))
      btn.classList.add('active')
      td.querySelector(`.net-detail-pane[data-pane="${btn.dataset.pane}"]`)?.classList.add('active')
    })
  })
}

function buildDetailHTML(ev: any) {
  const reqHeaders = ev.requestHeaders?.length
    ? ev.requestHeaders.map((h: any) => `<span class="net-hdr-name">${escHtml(h.name)}:</span><span class="net-hdr-value">${escHtml(h.value)}</span>`).join('')
    : `<span class="net-empty">No headers captured</span>`
  const resHeaders = ev.responseHeaders?.length
    ? ev.responseHeaders.map((h: any) => `<span class="net-hdr-name">${escHtml(h.name)}:</span><span class="net-hdr-value">${escHtml(h.value)}</span>`).join('')
    : `<span class="net-empty">No headers captured</span>`
  let reqBody = ''
  if (ev.requestBody) {
    const raw = typeof ev.requestBody === 'object' ? JSON.stringify(ev.requestBody, null, 2) : ev.requestBody
    reqBody = `<div class="net-detail-section"><div class="net-detail-label">Body</div><pre class="net-detail-body">${escHtml(raw)}</pre></div>`
  }
  const statusLine = ev.statusLine
    ? `<div class="net-detail-section"><div class="net-detail-label">Status</div><div class="net-hdr-value">${escHtml(ev.statusLine)}</div></div>`
    : ''
  return `
    <div class="net-detail">
      <div class="net-detail-tabs">
        <button class="net-detail-tab active" data-pane="request">Request</button>
        <button class="net-detail-tab" data-pane="response">Response</button>
      </div>
      <div class="net-detail-pane active" data-pane="request">
        <div class="net-detail-section">
          <div class="net-detail-label">URL</div>
          <div class="net-hdr-value" style="word-break:break-all">${escHtml(ev.url)}</div>
        </div>
        <div class="net-detail-section">
          <div class="net-detail-label">Headers</div>
          <div class="net-detail-headers">${reqHeaders}</div>
        </div>
        ${reqBody}
      </div>
      <div class="net-detail-pane" data-pane="response">
        ${statusLine}
        <div class="net-detail-section">
          <div class="net-detail-label">Headers</div>
          <div class="net-detail-headers">${resHeaders}</div>
        </div>
      </div>
    </div>`
}

function updateNetwork(t: number) {
  if (!recording || !networkBodyEl.value) return
  const events = recording.networkEvents || []
  const rows = networkBodyEl.value.querySelectorAll<HTMLTableRowElement>('tr.net-row')
  rows.forEach((row) => {
    const ev = events[Number(row.dataset.idx)]
    const statusEl = row.children[1] as HTMLElement
    const durEl = row.children[3] as HTMLElement
    const isExpanded = row.classList.contains('expanded')
    let stateClass: string
    if (t < ev.time) {
      stateClass = 'net-pending'
      statusEl.textContent = '·'
      durEl.textContent = '·'
    } else if (ev.endTime && t < ev.endTime) {
      stateClass = 'net-active'
      statusEl.textContent = '…'
      durEl.textContent = '…'
    } else if (ev.error) {
      stateClass = 'net-err'
      statusEl.textContent = 'ERR'
      durEl.textContent = ev.duration != null ? `${ev.duration}ms` : '·'
    } else {
      const s = ev.status || 0
      stateClass = s >= 500 ? 'net-5xx' : s >= 400 ? 'net-4xx' : s >= 300 ? 'net-3xx' : 'net-ok'
      statusEl.textContent = String(s || '·')
      durEl.textContent = ev.duration != null ? `${ev.duration}ms` : '·'
    }
    row.className = `net-row ${stateClass}${isExpanded ? ' expanded' : ''}`
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Comments ──────────────────────────────────────────────────────────────────
async function loadComments() {
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    const data = await $fetch<any[]>(`/api/reels/${reelId}/comments`, { headers })
    comments.value = data
    if (commentsCountEl.value) commentsCountEl.value.textContent = String(data.length)
  } catch {}
}

async function submitComment() {
  if (!newCommentContent.value.trim() || submitting.value) return
  submitting.value = true
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    await $fetch(`/api/reels/${reelId}/comments`, {
      method: 'POST',
      headers,
      body: { content: newCommentContent.value.trim(), timestamp_ms: Math.round(clock.current) },
    })
    newCommentContent.value = ''
    await loadComments()
  } finally {
    submitting.value = false
  }
}

async function submitReply(parentId: string) {
  if (!replyContent.value.trim() || submitting.value) return
  submitting.value = true
  try {
    const parent = comments.value.find(c => c.id === parentId)
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    await $fetch(`/api/reels/${reelId}/comments`, {
      method: 'POST',
      headers,
      body: { content: replyContent.value.trim(), timestamp_ms: parent?.timestamp_ms ?? Math.round(clock.current), parent_id: parentId },
    })
    replyContent.value = ''
    openReplyId.value = null
    await loadComments()
  } finally {
    submitting.value = false
  }
}

function jumpToComment(timestampMs: number) {
  const wasPlaying = clock.playing
  clock.seek(timestampMs)
  if (seekerEl.value) seekerEl.value.value = String(timestampMs)
  if (wasPlaying) {
    replayer?.play(timestampMs)
    clock.play(timestampMs)
    scheduleTick()
  } else {
    replayer?.pause(timestampMs)
    updateUI(timestampMs)
  }
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  loadReel()
  loadComments()
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  replayer?.pause?.()
})
</script>

<template>
  <div class="viewer-root">
    <!-- Loading / Error states -->
    <div v-if="loading" class="center-screen">
      <div class="loading-text">Loading reel…</div>
    </div>
    <div v-else-if="loadError" class="center-screen">
      <div class="error-box">
        <div class="error-title">Failed to load reel</div>
        <div class="error-msg">{{ loadError }}</div>
      </div>
    </div>

    <!-- Viewer screen -->
    <template v-else>
      <!-- Meta bar -->
      <div id="meta-bar">
        <span class="meta-label">URL</span>
        <span ref="metaUrlEl" class="meta-value" />
        <span class="meta-sep">·</span>
        <span class="meta-label">Recorded</span>
        <span ref="metaDateEl" class="meta-value" />
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
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'comments' }"
              @click="activeTab = 'comments'"
            >
              Comments
              <span ref="commentsCountEl" class="tab-count">0</span>
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
            <table class="net-table">
              <thead>
                <tr>
                  <th class="col-method">Method</th>
                  <th class="col-status">Status</th>
                  <th class="col-url">URL</th>
                  <th class="col-dur">Time</th>
                </tr>
              </thead>
              <tbody ref="networkBodyEl" id="network-body" />
            </table>
          </div>

          <!-- Comments panel -->
          <div
            class="panel panel-comments"
            :class="{ active: activeTab === 'comments' }"
            id="comments-panel"
          >
            <!-- New comment form -->
            <div class="cm-compose">
              <textarea
                v-model="newCommentContent"
                class="cm-textarea"
                placeholder="Add a comment at current time…"
                rows="2"
                @keydown.ctrl.enter.prevent="submitComment"
                @keydown.meta.enter.prevent="submitComment"
              />
              <button class="cm-send-btn" :disabled="submitting || !newCommentContent.trim()" @click="submitComment">
                Comment at {{ currentTimeDisplay }}
              </button>
            </div>

            <!-- Thread list -->
            <div v-if="commentThreads.length === 0" class="cm-empty">No comments yet</div>
            <div v-for="thread in commentThreads" :key="thread.id" class="cm-thread">
              <!-- Root comment -->
              <div class="cm-msg cm-msg-root">
                <div class="cm-header">
                  <button class="cm-ts-btn" @click="jumpToComment(thread.timestamp_ms); activeTab = 'comments'">
                    {{ fmtTime(thread.timestamp_ms) }}
                  </button>
                  <span class="cm-author">{{ thread.author_email }}</span>
                  <span class="cm-date">{{ fmtDate(thread.created_at) }}</span>
                </div>
                <div class="cm-content">{{ thread.content }}</div>
                <button class="cm-reply-toggle" @click="openReplyId = openReplyId === thread.id ? null : thread.id; replyContent = ''">
                  Reply
                </button>
              </div>

              <!-- Replies -->
              <div v-for="reply in thread.replies" :key="reply.id" class="cm-msg cm-msg-reply">
                <div class="cm-header">
                  <span class="cm-author">{{ reply.author_email }}</span>
                  <span class="cm-date">{{ fmtDate(reply.created_at) }}</span>
                </div>
                <div class="cm-content">{{ reply.content }}</div>
              </div>

              <!-- Reply form -->
              <div v-if="openReplyId === thread.id" class="cm-reply-form">
                <textarea
                  v-model="replyContent"
                  class="cm-textarea"
                  placeholder="Write a reply…"
                  rows="2"
                  @keydown.ctrl.enter.prevent="submitReply(thread.id)"
                  @keydown.meta.enter.prevent="submitReply(thread.id)"
                />
                <div class="cm-reply-actions">
                  <button class="cm-cancel-btn" @click="openReplyId = null; replyContent = ''">Cancel</button>
                  <button class="cm-send-btn cm-send-sm" :disabled="submitting || !replyContent.trim()" @click="submitReply(thread.id)">Reply</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div id="controls">
        <button ref="playBtnEl" id="play-btn" @click="togglePlay">▶</button>
        <div id="timeline">
          <div ref="progressFillEl" id="progress-fill" />
          <!-- Comment bubbles -->
          <button
            v-for="thread in commentThreads"
            :key="thread.id"
            class="cm-bubble"
            :style="{ left: `${totalDuration > 0 ? (thread.timestamp_ms / totalDuration) * 100 : 0}%` }"
            :title="thread.author_email + ': ' + thread.content"
            @click.stop="jumpToComment(thread.timestamp_ms); activeTab = 'comments'"
          />
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
:root {
  --bg:        #111113;
  --surface:   #1c1c1f;
  --surface2:  #242428;
  --border:    #2e2e33;
  --text:      #e2e2e6;
  --dim:       #6b6b76;
  --accent:    #4c8dff;
  --green:     #3ecf8e;
  --yellow:    #f5c542;
  --orange:    #f4844a;
  --red:       #f16370;
  --blue:      #4c8dff;
  --controls-h: 44px;
  --meta-h:     30px;
  --side-w:     380px;
}

.viewer-root {
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

/* ── Meta bar ────────────────────────────────────────────────────────────── */
#meta-bar {
  height: 30px;
  flex-shrink: 0;
  background: #1c1c1f;
  border-bottom: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
}

.meta-label {
  color: #6b6b76;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  font-size: 10px;
}

.meta-value {
  color: #e2e2e6;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta-sep { color: #2e2e33; }

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
  width: 380px;
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
  padding: 9px 12px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #6b6b76;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: color 0.15s;
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
  padding: 1px 6px;
  border-radius: 10px;
  font-variant-numeric: tabular-nums;
  min-width: 22px;
  text-align: center;
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

/* ── Console ─────────────────────────────────────────────────────────────── */
#console-entries { padding: 2px 0; }

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
  flex-shrink: 0;
  min-width: 46px;
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
  cursor: pointer;
}

.net-table :deep(tbody tr.net-row:hover) { background: rgba(255,255,255,0.06); }
.net-table :deep(tbody tr.net-row.expanded) { background: rgba(76,141,255,0.06); }

.net-table :deep(td) {
  padding: 4px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.net-table :deep(.col-method) { width: 56px; }
.net-table :deep(.col-status) { width: 52px; }
.net-table :deep(.col-dur)    { width: 64px; text-align: right; }

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

.net-table :deep(.net-4xx .col-method),
.net-table :deep(.net-5xx .col-method),
.net-table :deep(.net-err .col-method) { color: #f16370; }

.net-table :deep(.col-dur) { color: #6b6b76; }

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
}

/* ── Network detail ──────────────────────────────────────────────────────── */
.net-table :deep(.net-detail-row td) {
  padding: 0 !important;
  background: #16161a;
  border-bottom: 1px solid #2e2e33 !important;
}

.net-table :deep(.net-detail) {
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
}

.net-table :deep(.net-detail-tabs) {
  display: flex;
  border-bottom: 1px solid #2e2e33;
  background: #1a1a1f;
}

.net-table :deep(.net-detail-tab) {
  padding: 6px 12px;
  cursor: pointer;
  color: #6b6b76;
  font-size: 11px;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  font-family: inherit;
  transition: color 0.1s;
}

.net-table :deep(.net-detail-tab:hover) { color: #e2e2e6; }
.net-table :deep(.net-detail-tab.active) {
  color: #e2e2e6;
  border-bottom-color: #4c8dff;
}

.net-table :deep(.net-detail-pane) {
  display: none;
  padding: 10px 12px;
  max-height: 280px;
  overflow-y: auto;
}

.net-table :deep(.net-detail-pane.active) { display: block; }

.net-table :deep(.net-detail-section) { margin-bottom: 12px; }
.net-table :deep(.net-detail-section:last-child) { margin-bottom: 0; }

.net-table :deep(.net-detail-label) {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #6b6b76;
  margin-bottom: 5px;
}

.net-table :deep(.net-detail-headers) {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 0;
}

.net-table :deep(.net-hdr-name) {
  color: #6b6b76;
  padding: 2px 10px 2px 0;
  white-space: nowrap;
}

.net-table :deep(.net-hdr-value) {
  color: #e2e2e6;
  padding: 2px 0;
  word-break: break-all;
  white-space: pre-wrap;
}

.net-table :deep(.net-detail-body) {
  background: #242428;
  border-radius: 4px;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #e2e2e6;
  max-height: 180px;
  overflow-y: auto;
  line-height: 1.5;
}

.net-table :deep(.net-empty) { color: #6b6b76; font-style: italic; }

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

/* ── Comment bubbles on timeline ─────────────────────────────────────────── */
.cm-bubble {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f5c542;
  border: 2px solid #111113;
  cursor: pointer;
  padding: 0;
  z-index: 2;
  transition: transform 0.1s, background 0.1s;
}

.cm-bubble:hover {
  background: #ffd966;
  transform: translate(-50%, -50%) scale(1.3);
}

/* ── Comments panel ──────────────────────────────────────────────────────── */
.panel-comments {
  display: none;
  flex-direction: column;
}

.panel-comments.active {
  display: flex;
}

.cm-compose {
  padding: 10px;
  border-bottom: 1px solid #2e2e33;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cm-textarea {
  background: #242428;
  border: 1px solid #2e2e33;
  border-radius: 5px;
  color: #e2e2e6;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  padding: 7px 9px;
  resize: none;
  width: 100%;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}

.cm-textarea:focus { border-color: #4c8dff; }
.cm-textarea::placeholder { color: #6b6b76; }

.cm-send-btn {
  align-self: flex-end;
  background: #4c8dff;
  border: none;
  border-radius: 5px;
  color: #fff;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 12px;
  transition: background 0.15s;
}

.cm-send-btn:hover:not(:disabled) { background: #3a7de8; }
.cm-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cm-send-sm { font-size: 11px; padding: 4px 10px; }

.cm-empty {
  padding: 20px;
  text-align: center;
  color: #6b6b76;
  font-size: 12px;
}

.cm-thread {
  border-bottom: 1px solid #2e2e33;
  padding: 0;
}

.cm-msg {
  padding: 9px 10px 6px;
}

.cm-msg-reply {
  background: rgba(255,255,255,0.02);
  padding-left: 22px;
  border-top: 1px solid rgba(255,255,255,0.04);
}

.cm-header {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.cm-ts-btn {
  background: rgba(245, 197, 66, 0.15);
  border: none;
  border-radius: 3px;
  color: #f5c542;
  cursor: pointer;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  transition: background 0.15s;
}

.cm-ts-btn:hover { background: rgba(245, 197, 66, 0.25); }

.cm-author {
  color: #e2e2e6;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.cm-date {
  color: #6b6b76;
  font-size: 10px;
  white-space: nowrap;
}

.cm-content {
  color: #c8c8ce;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.cm-reply-toggle {
  background: none;
  border: none;
  color: #6b6b76;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  margin-top: 4px;
  padding: 2px 0;
  transition: color 0.15s;
}

.cm-reply-toggle:hover { color: #4c8dff; }

.cm-reply-form {
  background: rgba(255,255,255,0.02);
  border-top: 1px solid rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px 8px 22px;
}

.cm-reply-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cm-cancel-btn {
  background: none;
  border: 1px solid #2e2e33;
  border-radius: 5px;
  color: #6b6b76;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  padding: 4px 10px;
  transition: color 0.15s, border-color 0.15s;
}

.cm-cancel-btn:hover { color: #e2e2e6; border-color: #6b6b76; }
</style>
