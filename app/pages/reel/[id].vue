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
const metaDateEl = ref<HTMLElement | null>(null)
const consoleEntriesEl = ref<HTMLElement | null>(null)
const consolePanelEl = ref<HTMLElement | null>(null)
const networkBodyEl = ref<HTMLElement | null>(null)
const consoleCountEl = ref<HTMLElement | null>(null)
const networkCountEl = ref<HTMLElement | null>(null)
const interactionsCountEl = ref<HTMLElement | null>(null)
const interactionsPanelEl = ref<HTMLElement | null>(null)
const interactionsListEl = ref<HTMLElement | null>(null)

// ── State ─────────────────────────────────────────────────────────────────────
const activeTab = ref<'console' | 'network' | 'interactions' | 'comments'>('console')
const comments = ref<any[]>([])
const newCommentContent = ref('')
const openReplyId = ref<string | null>(null)
const replyContent = ref('')
const submitting = ref(false)
const currentTimeDisplay = ref('0:00.0')
const currentTimeMs = ref(0)
const currentUrl = ref('')

// ── Ticket integration ──────────────────────────────────────────────────────
const ticketId = ref<string | null>(null)
const ticketUrl = ref<string | null>(null)
const ticketProvider = ref<string | null>(null)
const ticketModalOpen = ref(false)
const ticketTitle = ref('')
const ticketDescription = ref('')
const ticketCreating = ref(false)
const ticketError = ref('')

// ── Reel actions (rename, delete, mark as done) ──────────────────────────────
const reelMeta = ref<any>(null)
const reelStatus = ref('open')
const isScreenshot = ref(false)

const canvasWidth = ref(1280)
const canvasHeight = ref(720)

// ── Element pick mode (for linking comments to DOM elements) ──────────────────
const pickModeActive = ref(false)
const pinnedElement = ref<{
  tag: string
  id: string
  classes: string
  cssPath: string
  displayLabel: string
} | null>(null)

let pickHighlightEl: HTMLDivElement | null = null
let pickTooltipEl: HTMLDivElement | null = null
let currentPickEl: Element | null = null
let hoverHighlightEl: HTMLDivElement | null = null

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
let cachedRrwebEvents: any[] = []
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
  const { consoleEvents = [], networkEvents = [], interactionEvents = [], meta = {} } = recording

  // Detect screenshot from recording metadata (fallback for reels without DB flag)
  if (meta.isScreenshot) isScreenshot.value = true

  if (metaDateEl.value) metaDateEl.value.textContent = meta.recordedAt ? new Date(meta.recordedAt).toLocaleString() : ''
  if (consoleCountEl.value) consoleCountEl.value.textContent = fmtCount(consoleEvents.length)
  if (networkCountEl.value) networkCountEl.value.textContent = fmtCount(networkEvents.length)
  if (interactionsCountEl.value) interactionsCountEl.value.textContent = fmtCount(interactionEvents.length)

  // Raw events: used for duration (includes bugreel-end marker)
  const rawEvents: any[] = recording.rrwebEvents || []
  // Sanitized events: passed to Replayer (bugreel-end filtered out, CORS links stripped)
  cachedRrwebEvents = sanitizeRrwebEvents(rawEvents)
  const rrwebEvents = cachedRrwebEvents

  const metaEvent = rrwebEvents.find((e: any) => e.type === 4)
  pageWidth = metaEvent?.data?.width || 1280
  pageHeight = metaEvent?.data?.height || 720
  canvasWidth.value = pageWidth
  canvasHeight.value = pageHeight


  const firstTs = rawEvents[0]?.timestamp ?? 0
  const lastTs = rawEvents[rawEvents.length - 1]?.timestamp ?? 0
  // Use the larger of: rrweb event span (including end marker) or meta.duration (wall-clock).
  // This handles static pages where rrweb emits no incremental events.
  totalDuration = Math.max(lastTs - firstTs, recording.meta?.duration ?? 0)

  // Build URL change timeline from multiple sources:
  // 1. Initial URL from rrweb MetaEvent or recording meta
  // 2. Navigate events from interactionEvents (pushState/replaceState + popstate/hashchange)
  // 3. Additional rrweb MetaEvents from checkouts (fires every 200 events with current URL)
  urlChanges = []
  const initialUrl = metaEvent?.data?.href || meta.url || ''
  if (initialUrl) urlChanges.push({ offset: 0, url: initialUrl })

  // rrweb checkout MetaEvents (type 4) after the first one — may reflect post-navigation URL
  for (const e of rrwebEvents) {
    if (e.type === 4 && e.timestamp > firstTs && e.data?.href && e.data.href !== initialUrl) {
      urlChanges.push({ offset: e.timestamp - firstTs, url: e.data.href })
    }
  }

  // interactionEvents: navigate events from our custom capture (most reliable for SPAs)
  for (const e of (recording.interactionEvents || [])) {
    if (e.type === 'navigate') {
      urlChanges.push({ offset: e.time, url: e.url })
    }
  }

  urlChanges.sort((a, b) => a.offset - b.offset)

  currentUrl.value = urlChanges[0]?.url || meta.url || ''

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

    // Inject captured fonts into the replay iframe
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
  if (playBtnEl.value) playBtnEl.value.textContent = '▶'

  renderNetworkTable()
  renderAllConsole()
  renderAllInteractions()
  updateUI(0)
  scheduleTick()
}

// ── Font injection ───────────────────────────────────────────────────────────
let _fontStyleId = '__bugreel_fonts__'
let _fontObserver: MutationObserver | null = null
let _lastIframeDoc: Document | null = null

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
  // Avoid duplicate injection in the same document
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
  // Inject immediately
  injectFontsIntoIframe()
  // Watch for iframe DOM rebuilds (rrweb rebuilds on play/pause/seek)
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
  currentTimeMs.value = t
  // Update URL to reflect navigation at time t
  if (urlChanges.length) {
    let url = urlChanges[0].url
    for (const change of urlChanges) {
      if (change.offset <= t) url = change.url
      else break
    }
    currentUrl.value = url
  }
  updateConsole(t)
  updateNetwork(t)
  updateInteractions(t)
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
  const ts = document.createElement('button')
  ts.className = 'c-ts'
  ts.textContent = fmtTime(ev.time)
  ts.addEventListener('click', () => jumpToComment(ev.time))
  const badge = document.createElement('span')
  badge.className = 'c-badge'
  badge.textContent = ev.level.toUpperCase()
  const msg = document.createElement('span')
  msg.className = 'c-msg'
  msg.textContent = ev.args.map((a: any) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
  row.append(ts, badge, msg)
  return row
}

// ── Interactions ──────────────────────────────────────────────────────────────
let interactionRows: HTMLElement[] = []

function renderAllInteractions() {
  if (!recording || !interactionsListEl.value) return
  interactionsListEl.value.innerHTML = ''
  const events = recording.interactionEvents || []
  interactionRows = []
  for (const ev of events) {
    const row = buildInteractionEntry(ev)
    row.classList.add('future')
    row.dataset.time = String(ev.time)
    interactionsListEl.value.appendChild(row)
    interactionRows.push(row)
  }
}

function updateInteractions(t: number) {
  let lastPastIdx = -1
  for (let i = 0; i < interactionRows.length; i++) {
    const row = interactionRows[i]
    if (Number(row.dataset.time) <= t) {
      row.classList.remove('future')
      lastPastIdx = i
    } else {
      row.classList.add('future')
    }
  }
  if (lastPastIdx >= 0 && clock.playing && interactionsPanelEl.value) {
    interactionRows[lastPastIdx].scrollIntoView({ block: 'nearest' })
  }
}

function buildInteractionEntry(ev: any) {
  const row = document.createElement('div')
  row.className = `ix-row ix-${ev.type}`

  const ts = document.createElement('button')
  ts.className = 'ix-ts'
  ts.textContent = fmtTime(ev.time)
  ts.addEventListener('click', () => jumpToComment(ev.time))

  const icon = document.createElement('span')
  icon.className = 'ix-icon'
  icon.textContent = ev.type === 'navigate' ? '↗' : ev.type === 'input' ? '✎' : '↖'

  const body = document.createElement('span')
  body.className = 'ix-body'

  if (ev.type === 'navigate') {
    body.textContent = ev.url
  } else if (ev.type === 'input') {
    const lbl = ev.label ? `${ev.label}: ` : ''
    body.textContent = `${lbl}"${ev.value}"`
  } else {
    // click (regular or link)
    if (ev.href) {
      // Link click: show label + destination URL
      if (ev.label) {
        body.textContent = ev.label
        const hrefSpan = document.createElement('span')
        hrefSpan.className = 'ix-tag'
        hrefSpan.textContent = ` → ${ev.href}`
        body.appendChild(hrefSpan)
      } else {
        body.textContent = ev.href
      }
    } else {
      body.textContent = ev.label || `<${ev.target || '?'}>`
      if (ev.label && ev.target) {
        const tagSpan = document.createElement('span')
        tagSpan.className = 'ix-tag'
        tagSpan.textContent = ` <${ev.target}>`
        body.appendChild(tagSpan)
      }
    }
  }

  row.append(ts, icon, body)
  return row
}

// ── Network ───────────────────────────────────────────────────────────────────
let expandedNetIdx: number | null = null
const netFilterType = ref('all')
const netFilterMethod = ref('all')
const netFilterStatus = ref('all')

function guessType(ev: any): string {
  const t = (ev.type || '').toLowerCase()
  if (t === 'fetch' || t === 'xmlhttprequest' || t === 'xhr') return 'XHR'
  if (t === 'script') return 'JS'
  if (t === 'link' || t === 'css') return 'CSS'
  if (t === 'img') return 'Img'
  if (t === 'font') return 'Font'
  if (t === 'media' || t === 'video' || t === 'audio') return 'Media'
  // Guess from URL extension
  const url = (ev.url || '').split('?')[0].toLowerCase()
  if (url.match(/\.(js|mjs|cjs)$/)) return 'JS'
  if (url.match(/\.(css)$/)) return 'CSS'
  if (url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|avif)$/)) return 'Img'
  if (url.match(/\.(woff2?|ttf|otf|eot)$/)) return 'Font'
  if (url.match(/\.(mp4|webm|ogg|mp3|wav)$/)) return 'Media'
  if (url.match(/\.(html?)$/)) return 'Doc'
  if (t === 'fetch' || t === 'xmlhttprequest') return 'XHR'
  if (ev.method && ev.method !== 'GET') return 'XHR'
  return 'Other'
}

function statusCategory(ev: any): string {
  const s = ev.status || 0
  if (ev.error) return 'Error'
  if (s >= 500) return '5xx'
  if (s >= 400) return '4xx'
  if (s >= 300) return '3xx'
  if (s >= 200) return '2xx'
  return 'Other'
}

const TYPE_COLORS: Record<string, string> = {
  XHR: '#4c8dff', JS: '#f5c542', CSS: '#c084fc', Img: '#3ecf8e',
  Font: '#f4844a', Media: '#f16370', Doc: '#60a5fa', Other: '#6b6b76',
}

function matchesNetFilters(ev: any): boolean {
  if (netFilterType.value !== 'all' && guessType(ev) !== netFilterType.value) return false
  if (netFilterMethod.value !== 'all') {
    const m = (ev.method || '').toUpperCase() || 'GET'
    if (m !== netFilterMethod.value) return false
  }
  if (netFilterStatus.value !== 'all' && statusCategory(ev) !== netFilterStatus.value) return false
  return true
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
    if (!matchesNetFilters(ev)) row.style.display = 'none'
    row.innerHTML = `
      <td class="col-method">${escHtml(ev.method || 'GET')}</td>
      <td class="col-status">·</td>
      <td class="col-type"><span class="net-type-badge" style="color:${color};border-color:${color}">${rtype}</span></td>
      <td class="col-url" title="${escHtml(ev.url)}">${escHtml(fmtUrl(ev.url))}</td>
      <td class="col-dur">·</td>`
    row.addEventListener('click', () => toggleNetworkDetail(i))
    networkBodyEl.value!.appendChild(row)
  })
}

watch([netFilterType, netFilterMethod, netFilterStatus], () => {
  if (!recording || !networkBodyEl.value) return
  const events = recording.networkEvents || []
  const rows = networkBodyEl.value.querySelectorAll<HTMLTableRowElement>('tr.net-row')
  let visible = 0
  rows.forEach((row) => {
    const ev = events[Number(row.dataset.idx)]
    if (matchesNetFilters(ev)) { row.style.display = ''; visible++ }
    else row.style.display = 'none'
  })
  if (networkCountEl.value) networkCountEl.value.textContent = fmtCount(visible)
})

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
  td.colSpan = 5
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
  let resBody = ''
  if (ev.responseBody) {
    let formatted = ev.responseBody
    try {
      const parsed = JSON.parse(ev.responseBody)
      formatted = JSON.stringify(parsed, null, 2)
    } catch (_) {}
    resBody = `<div class="net-detail-section"><div class="net-detail-label">Body</div><pre class="net-detail-body">${escHtml(formatted)}</pre></div>`
  }
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
        ${resBody}
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
    const durEl = row.children[4] as HTMLElement
    const isExpanded = row.classList.contains('expanded')
    let stateClass: string
    const endTime = ev.endTime ?? (ev.duration != null ? ev.time + ev.duration : 0)
    if (t < ev.time) {
      stateClass = 'net-pending'
      statusEl.textContent = '·'
      durEl.textContent = '·'
    } else if (endTime && t < endTime) {
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
    if (!matchesNetFilters(ev)) row.style.display = 'none'
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

// ── Comments ──────────────────────────────────────────────────────────────────
async function loadComments() {
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    const data = await $fetch<any[]>(`/api/reels/${reelId}/comments`, { headers })
    comments.value = data
  } catch {}
}

async function submitComment() {
  if (!newCommentContent.value.trim() || submitting.value) return
  submitting.value = true
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    const body: any = { content: newCommentContent.value.trim(), timestamp_ms: Math.round(clock.current) }
    if (pinnedElement.value) {
      body.element_info = JSON.stringify(pinnedElement.value)
    }
    await $fetch(`/api/reels/${reelId}/comments`, {
      method: 'POST',
      headers,
      body,
    })
    newCommentContent.value = ''
    pinnedElement.value = null
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

function recreateReplayer() {
  if (!playerMount.value || !cachedRrwebEvents.length) return
  replayer?.destroy?.()
  playerMount.value.innerHTML = ''
  try {
    const rrweb = (window as any).rrweb
    replayer = new rrweb.Replayer(cachedRrwebEvents, {
      root: playerMount.value,
      speed: 1,
      showWarning: false,
      showDebug: false,
      triggerFocus: false,
      UNSAFE_replayCanvas: false,
      pauseAnimation: true,
      useVirtualDom: false,
    })
    injectCapturedFonts()
    applyScale()
  } catch (err) {
    console.error('[bugreel] Replayer recreate failed', err)
  }
}

function jumpToComment(timestampMs: number) {
  const wasPlaying = clock.playing
  clock.seek(timestampMs)
  if (seekerEl.value) seekerEl.value.value = String(timestampMs)

  // Always recreate the replayer to avoid rrweb DocumentType bug on backward seek.
  // After recreating, play from 0 first to let rrweb build the initial snapshot,
  // then pause at the target offset after a frame.
  recreateReplayer()
  replayer?.play(0)
  requestAnimationFrame(() => {
    if (wasPlaying) {
      replayer?.play(timestampMs)
      clock.play(timestampMs)
      scheduleTick()
    } else {
      replayer?.pause(timestampMs)
      updateUI(timestampMs)
    }
  })
}

function fmtDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Playwright export ──────────────────────────────────────────────────────────

function clickAction(ev: any): string {
  const j = (s: string) => JSON.stringify(s)
  const { target, label, href } = ev
  if (target === 'a' || href) {
    if (label) return `page.getByRole('link', { name: ${j(label)} }).click()`
    if (href)  return `page.goto(${j(href)})`
  }
  if (target === 'button' && label) return `page.getByRole('button', { name: ${j(label)} }).click()`
  if (label) return `page.getByText(${j(label)}, { exact: true }).click()`
  return `page.locator(${j(target || '*')}).first().click() // TODO: refine selector`
}

function fillAction(ev: any): string {
  const j = (s: string) => JSON.stringify(s)
  const { label, value } = ev
  if (label) return `page.getByLabel(${j(label)}).fill(${j(value ?? '')})`
  return `page.locator('input').first().fill(${j(value ?? '')}) // TODO: refine selector`
}

function generatePlaywrightScript(): string {
  const events: any[] = recording?.interactionEvents || []
  const meta: any = recording?.meta || {}
  const startUrl: string = meta.url || 'https://your-app.com'
  const recordedAt: string = meta.recordedAt
    ? new Date(meta.recordedAt).toLocaleString()
    : 'unknown'
  const j = (s: string) => JSON.stringify(s)

  const lines: string[] = []

  lines.push(`import { test, expect } from '@playwright/test'`)
  lines.push(``)
  lines.push(`/**`)
  lines.push(` * Bug reproduction — generated by Bugreel`)
  lines.push(` * Recorded : ${recordedAt}`)
  lines.push(` * URL      : ${startUrl}`)
  lines.push(` *`)
  lines.push(` * Selectors marked TODO may need adjusting to match your DOM.`)
  lines.push(` */`)
  lines.push(`test('bug reproduction', async ({ page }) => {`)
  lines.push(`  await page.goto(${j(startUrl)})`)
  lines.push(``)

  let lastUrl = startUrl
  let lastTime = 0

  for (const ev of events) {
    // Flag significant pauses so the developer knows there was a wait
    const gap = ev.time - lastTime
    if (gap > 3000 && lastTime > 0) {
      lines.push(`  // — ${Math.round(gap / 1000)}s pause —`)
    }
    lastTime = ev.time

    if (ev.type === 'navigate') {
      if (ev.url === lastUrl) continue
      lines.push(`  await page.waitForURL(${j(ev.url)})`)
      lastUrl = ev.url
      lines.push(``)
    }
    else if (ev.type === 'click') {
      const comment = ev.href
        ? `click: ${ev.label || ev.target} → ${ev.href}`
        : `click: ${ev.label || ev.target}`
      lines.push(`  // ${comment}`)
      lines.push(`  await ${clickAction(ev)}`)
      lines.push(``)
    }
    else if (ev.type === 'input') {
      lines.push(`  // fill: ${ev.label || 'input'}`)
      lines.push(`  await ${fillAction(ev)}`)
      lines.push(``)
    }
  }

  lines.push(`  // TODO: add assertions to verify the expected behaviour`)
  lines.push(`  // e.g. await expect(page.getByText('Error')).toBeVisible()`)
  lines.push(`})`)

  return lines.join('\n')
}

function downloadPlaywright() {
  const script = generatePlaywrightScript()
  const blob = new Blob([script], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `bugreel-repro-${reelId.slice(0, 8)}.spec.ts`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ── DOM Inspector ─────────────────────────────────────────────────────────────
const inspectActive = ref(false)
const inspectInfo = ref<{
  tag: string
  id: string
  classes: string
  dimensions: string
  path: string
  attributes: { name: string; value: string }[]
  styles: { prop: string; value: string }[]
} | null>(null)

let inspectHighlightEl: HTMLDivElement | null = null
let inspectTooltipEl: HTMLDivElement | null = null
let currentInspectEl: Element | null = null

function getReplayIframe(): HTMLIFrameElement | null {
  return playerMount.value?.querySelector('iframe') ?? null
}

function toggleInspect() {
  inspectActive.value ? deactivateInspect() : activateInspect()
}

function activateInspect() {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return

  // Pause playback
  if (clock.playing) {
    replayer?.pause()
    clock.pause()
    if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'
  }

  inspectActive.value = true
  inspectInfo.value = null

  // Allow pointer events on the replay via CSS class
  if (playerMount.value) playerMount.value.classList.add('inspect-mode')

  const doc = iframe.contentDocument
  doc.body.style.cursor = 'crosshair'

  // Highlight overlay inside iframe
  inspectHighlightEl = doc.createElement('div')
  inspectHighlightEl.id = '__bugreel_highlight__'
  Object.assign(inspectHighlightEl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #4c8dff', background: 'rgba(76, 141, 255, 0.08)',
    borderRadius: '2px', transition: 'all 0.05s ease-out', display: 'none',
  })
  doc.body.appendChild(inspectHighlightEl)

  // Tooltip inside iframe
  inspectTooltipEl = doc.createElement('div')
  inspectTooltipEl.id = '__bugreel_tooltip__'
  Object.assign(inspectTooltipEl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    background: '#1c1c1f', color: '#e2e2e6', padding: '4px 8px',
    borderRadius: '4px', fontSize: '11px',
    fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace",
    whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
    border: '1px solid #2e2e33', display: 'none',
  })
  doc.body.appendChild(inspectTooltipEl)

  doc.addEventListener('mousemove', onInspectMove)
  doc.addEventListener('click', onInspectClick, true)
  window.addEventListener('keydown', onInspectKeydown)
}

function deactivateInspect() {
  inspectActive.value = false
  inspectInfo.value = null
  currentInspectEl = null

  const iframe = getReplayIframe()
  const doc = iframe?.contentDocument
  if (doc) {
    doc.removeEventListener('mousemove', onInspectMove)
    doc.removeEventListener('click', onInspectClick, true)
    doc.body.style.cursor = ''
    inspectHighlightEl?.remove()
    inspectTooltipEl?.remove()
  }

  if (playerMount.value) playerMount.value.classList.remove('inspect-mode')

  inspectHighlightEl = null
  inspectTooltipEl = null
  window.removeEventListener('keydown', onInspectKeydown)
}

function onInspectKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') deactivateInspect()
}

function onInspectMove(e: MouseEvent) {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return

  const el = iframe.contentDocument.elementFromPoint(e.clientX, e.clientY)
  if (!el || el.id === '__bugreel_highlight__' || el.id === '__bugreel_tooltip__') return

  currentInspectEl = el
  const rect = el.getBoundingClientRect()

  if (inspectHighlightEl) {
    Object.assign(inspectHighlightEl.style, {
      display: 'block',
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    })
  }

  if (inspectTooltipEl) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : ''
    const dims = `${Math.round(rect.width)}\u00d7${Math.round(rect.height)}`

    inspectTooltipEl.innerHTML = ''
    const tagSpan = document.createElement('span')
    tagSpan.style.color = '#f4844a'
    tagSpan.textContent = tag
    inspectTooltipEl.appendChild(tagSpan)
    if (id) {
      const idSpan = document.createElement('span')
      idSpan.style.color = '#4c8dff'
      idSpan.textContent = id
      inspectTooltipEl.appendChild(idSpan)
    }
    if (cls) {
      const clsSpan = document.createElement('span')
      clsSpan.style.color = '#3ecf8e'
      clsSpan.textContent = cls
      inspectTooltipEl.appendChild(clsSpan)
    }
    const dimSpan = document.createElement('span')
    dimSpan.style.cssText = 'color:#6b6b76;margin-left:8px'
    dimSpan.textContent = dims
    inspectTooltipEl.appendChild(dimSpan)

    inspectTooltipEl.style.display = 'block'
    let top = rect.top - 28
    if (top < 4) top = rect.bottom + 4
    inspectTooltipEl.style.left = `${Math.max(4, rect.left)}px`
    inspectTooltipEl.style.top = `${top}px`
  }
}

function onInspectClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (!currentInspectEl) return
  const el = currentInspectEl
  const rect = el.getBoundingClientRect()

  // DOM path
  const pathParts: string[] = []
  let node: Element | null = el
  while (node && node.tagName?.toLowerCase() !== 'html') {
    const tag = node.tagName.toLowerCase()
    const nid = node.id ? `#${node.id}` : ''
    const cls = node.className && typeof node.className === 'string'
      ? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
      : ''
    pathParts.unshift(`${tag}${nid}${cls}`)
    node = node.parentElement
  }

  // Attributes
  const attributes: { name: string; value: string }[] = []
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'style' && attr.value.length > 100) continue
    attributes.push({
      name: attr.name,
      value: attr.value.length > 120 ? attr.value.slice(0, 120) + '\u2026' : attr.value,
    })
  }

  // Computed styles
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el)
  const keys = [
    'display', 'position', 'color', 'background-color', 'font-size',
    'font-family', 'margin', 'padding', 'border', 'width', 'height',
    'z-index', 'opacity', 'overflow', 'flex', 'grid-template-columns',
  ]
  const skipValues = new Set([
    'none', 'normal', '0px', 'rgba(0, 0, 0, 0)', 'auto', '1',
    'visible', 'block', 'static', '0', 'inherit', 'start',
  ])
  const styles: { prop: string; value: string }[] = []
  if (computed) {
    for (const prop of keys) {
      let val = computed.getPropertyValue(prop)
      if (!val || skipValues.has(val)) continue
      if (prop === 'font-family' && val.length > 50) val = val.slice(0, 50) + '\u2026'
      styles.push({ prop, value: val })
    }
  }

  inspectInfo.value = {
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: el.className && typeof el.className === 'string' ? el.className.trim() : '',
    dimensions: `${Math.round(rect.width)} \u00d7 ${Math.round(rect.height)}`,
    path: pathParts.join(' > '),
    attributes,
    styles,
  }
}

function openDomInNewTab() {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return

  const clone = iframe.contentDocument.documentElement.cloneNode(true) as HTMLElement
  clone.querySelector('#__bugreel_highlight__')?.remove()
  clone.querySelector('#__bugreel_tooltip__')?.remove()

  const html = '<!DOCTYPE html>\n' + clone.outerHTML
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ── Element Pick Mode ─────────────────────────────────────────────────────────
function escapeCssClass(cls: string): string {
  // Escape characters that are special in CSS selectors: [ ] : ( ) . / @
  return cls.replace(/([[\]:()./\\@!#$%^&*+~'",<>{}|`])/g, '\\$1')
}

function buildCssPath(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node.tagName?.toLowerCase() !== 'html') {
    const tag = node.tagName.toLowerCase()
    if (node.id) {
      parts.unshift(`${tag}#${escapeCssClass(node.id)}`)
      break
    }
    let cls = ''
    if (node.className && typeof node.className === 'string') {
      // Filter out classes with special chars that are hard to escape reliably (Tailwind arbitrary values)
      const safe = node.className.trim().split(/\s+/)
        .filter(c => !/[[\]():]/.test(c))
        .slice(0, 2)
      if (safe.length) cls = '.' + safe.map(escapeCssClass).join('.')
    }
    let nth = ''
    if (node.parentElement) {
      const siblings = Array.from(node.parentElement.children).filter(c => c.tagName === node!.tagName)
      if (siblings.length > 1) {
        nth = `:nth-child(${Array.from(node.parentElement.children).indexOf(node) + 1})`
      }
    }
    parts.unshift(`${tag}${cls}${nth}`)
    node = node.parentElement
  }
  return parts.join(' > ')
}

function buildDisplayLabel(tag: string, id: string, classes: string): string {
  let label = `<${tag}`
  if (id) label += `#${id}`
  else if (classes) label += `.${classes.split(' ')[0]}`
  label += '>'
  return label
}

function activatePickMode() {
  if (inspectActive.value) deactivateInspect()

  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return

  if (clock.playing) {
    replayer?.pause()
    clock.pause()
    if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'
  }

  pickModeActive.value = true

  if (playerMount.value) playerMount.value.classList.add('inspect-mode')

  const doc = iframe.contentDocument
  doc.body.style.cursor = 'crosshair'

  pickHighlightEl = doc.createElement('div')
  pickHighlightEl.id = '__bugreel_pick_highlight__'
  Object.assign(pickHighlightEl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #4c8dff', background: 'rgba(76, 141, 255, 0.10)',
    borderRadius: '2px', transition: 'all 0.05s ease-out', display: 'none',
  })
  doc.body.appendChild(pickHighlightEl)

  pickTooltipEl = doc.createElement('div')
  pickTooltipEl.id = '__bugreel_pick_tooltip__'
  Object.assign(pickTooltipEl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    background: '#1c1c1f', color: '#e2e2e6', padding: '4px 8px',
    borderRadius: '4px', fontSize: '11px',
    fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace",
    whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
    border: '1px solid #4c8dff', display: 'none',
  })
  doc.body.appendChild(pickTooltipEl)

  doc.addEventListener('mousemove', onPickMove)
  doc.addEventListener('click', onPickClick, true)
  window.addEventListener('keydown', onPickKeydown)
}

function deactivatePickMode() {
  pickModeActive.value = false
  currentPickEl = null

  const iframe = getReplayIframe()
  const doc = iframe?.contentDocument
  if (doc) {
    doc.removeEventListener('mousemove', onPickMove)
    doc.removeEventListener('click', onPickClick, true)
    doc.body.style.cursor = ''
    pickHighlightEl?.remove()
    pickTooltipEl?.remove()
  }

  if (playerMount.value) playerMount.value.classList.remove('inspect-mode')

  pickHighlightEl = null
  pickTooltipEl = null
  window.removeEventListener('keydown', onPickKeydown)
}

function onPickKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') deactivatePickMode()
}

function onPickMove(e: MouseEvent) {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return

  const el = iframe.contentDocument.elementFromPoint(e.clientX, e.clientY)
  if (!el || el.id === '__bugreel_pick_highlight__' || el.id === '__bugreel_pick_tooltip__') return

  currentPickEl = el
  const rect = el.getBoundingClientRect()

  if (pickHighlightEl) {
    Object.assign(pickHighlightEl.style, {
      display: 'block',
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    })
  }

  if (pickTooltipEl) {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : ''

    pickTooltipEl.textContent = `${tag}${id}${cls}`
    pickTooltipEl.style.display = 'block'
    let top = rect.top - 28
    if (top < 4) top = rect.bottom + 4
    pickTooltipEl.style.left = `${Math.max(4, rect.left)}px`
    pickTooltipEl.style.top = `${top}px`
  }
}

function onPickClick(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()

  if (!currentPickEl) return
  const el = currentPickEl

  const tag = el.tagName.toLowerCase()
  const id = el.id || ''
  const classes = el.className && typeof el.className === 'string' ? el.className.trim() : ''
  const cssPath = buildCssPath(el)
  const displayLabel = buildDisplayLabel(tag, id, classes)

  pinnedElement.value = { tag, id, classes, cssPath, displayLabel }

  deactivatePickMode()
}

function clearPinnedElement() {
  pinnedElement.value = null
}

function findElementInIframe(elementInfo: any): Element | null {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return null
  const doc = iframe.contentDocument
  let target: Element | null = null

  // Try the full CSS path
  try { target = doc.querySelector(elementInfo.cssPath) } catch {}

  // Fallback: find by ID
  if (!target && elementInfo.id) target = doc.getElementById(elementInfo.id)

  // Fallback: try progressively shorter paths (from the end)
  if (!target && elementInfo.cssPath) {
    const parts = (elementInfo.cssPath as string).split(' > ')
    for (let i = parts.length - 1; i >= Math.max(0, parts.length - 3); i--) {
      const partial = parts.slice(i).join(' > ')
      try { target = doc.querySelector(partial) } catch {}
      if (target) break
    }
  }

  return target
}

function doHighlightElement(elementInfo: any) {
  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return
  const doc = iframe.contentDocument

  const target = findElementInIframe(elementInfo)
  if (!target) return

  doc.getElementById('__bugreel_comment_highlight__')?.remove()

  const rect = target.getBoundingClientRect()
  const hl = doc.createElement('div')
  hl.id = '__bugreel_comment_highlight__'
  Object.assign(hl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    border: '2px solid #ff4070', background: 'rgba(255, 64, 112, 0.15)',
    borderRadius: '2px',
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
    transition: 'opacity 0.3s',
  })
  doc.body.appendChild(hl)

  setTimeout(() => {
    if (hl.parentElement) {
      hl.style.opacity = '0'
      setTimeout(() => hl.remove(), 300)
    }
  }, 3000)
}

function highlightCommentElement(elementInfo: any) {
  if (!elementInfo?.cssPath) return

  if (clock.playing) {
    replayer?.pause()
    clock.pause()
    if (playBtnEl.value) playBtnEl.value.textContent = '\u25B6'
  }

  // rrweb rebuilds the DOM asynchronously after pause/seek — retry until found
  let attempts = 0
  const tryHighlight = () => {
    if (findElementInIframe(elementInfo)) {
      doHighlightElement(elementInfo)
    } else if (attempts++ < 10) {
      setTimeout(tryHighlight, 100)
    }
  }
  tryHighlight()
}

// ── Hover highlight for comment element badges ──────────────────────────────
function showElementHighlight(elementInfo: any) {
  if (!elementInfo?.cssPath) return

  const iframe = getReplayIframe()
  if (!iframe?.contentDocument) return
  const doc = iframe.contentDocument

  const target = findElementInIframe(elementInfo)
  if (!target) return

  // Remove any previous hover highlight
  hoverHighlightEl?.remove()

  const rect = target.getBoundingClientRect()
  const hl = doc.createElement('div')
  hl.id = '__bugreel_hover_highlight__'
  Object.assign(hl.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483645',
    background: 'rgba(255, 64, 112, 0.2)',
    border: '1px solid rgba(255, 64, 112, 0.6)',
    borderRadius: '2px',
    left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
  })
  doc.body.appendChild(hl)
  hoverHighlightEl = hl
}

function hideElementHighlight() {
  hoverHighlightEl?.remove()
  hoverHighlightEl = null
}

// ── Ticket integration ───────────────────────────────────────────────────────
async function loadTicketInfo() {
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    const data = await $fetch<any>(`/api/reels/${reelId}/ticket`, { headers })
    ticketId.value = data.ticket_id
    ticketUrl.value = data.ticket_url
    ticketProvider.value = data.ticket_provider
  } catch {}
}

function openTicketModal() {
  ticketTitle.value = ''
  ticketDescription.value = ''
  ticketError.value = ''
  ticketModalOpen.value = true
}

async function createTicket() {
  if (!ticketTitle.value.trim() || ticketCreating.value) return
  ticketCreating.value = true
  ticketError.value = ''
  try {
    const headers: Record<string, string> = token.value ? { Authorization: `Bearer ${token.value}` } : {}
    const data = await $fetch<any>(`/api/reels/${reelId}/ticket`, {
      method: 'POST',
      headers,
      body: { title: ticketTitle.value.trim(), description: ticketDescription.value.trim() },
    })
    ticketId.value = data.ticketId
    ticketUrl.value = data.ticketUrl
    ticketModalOpen.value = false
  } catch (err: any) {
    ticketError.value = err?.data?.message || err?.message || 'Failed to create ticket'
  } finally {
    ticketCreating.value = false
  }
}

// ── Reel meta & actions ──────────────────────────────────────────────────────
async function loadReelMeta() {
  try {
    const headers: Record<string, string> = token.value
      ? { Authorization: `Bearer ${token.value}` }
      : {}
    const data = await $fetch<any>(`/api/reels/${reelId}`, { headers })
    reelMeta.value = data
    if (data.status) reelStatus.value = data.status
    if (data.is_screenshot) isScreenshot.value = true
  } catch (err) {
    console.error('[bugreel] Failed to load reel meta', err)
  }
}

function navigateBack() {
  const router = useRouter()
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function seekRelative(deltaMs: number) {
  const newOffset = Math.max(0, Math.min(clock.current + deltaMs, totalDuration))
  const wasPlaying = clock.seek(newOffset)
  if (replayer) {
    replayer.pause(newOffset)
    if (wasPlaying) replayer.play(newOffset)
  }
  updateUI(newOffset)
}

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

  if (e.code === 'Space') {
    e.preventDefault()
    togglePlay()
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault()
    seekRelative(-5000)
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    seekRelative(5000)
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(() => {
  loadReel()
  loadComments()
  loadTicketInfo()
  loadReelMeta()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId)
  replayer?.pause?.()
  if (_fontObserver) { _fontObserver.disconnect(); _fontObserver = null }
  if (inspectActive.value) deactivateInspect()
  if (pickModeActive.value) deactivatePickMode()
  hideElementHighlight()
  window.removeEventListener('keydown', onKeydown)
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
        <div class="meta-url-bar">
          <svg class="meta-globe" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="meta-url-text">{{ currentUrl || '…' }}</span>
        </div>
        <span ref="metaDateEl" class="meta-date" />

        <!-- Action buttons -->
        <div class="meta-actions">
          <button class="meta-action meta-action--playwright" title="Export as Playwright test" @click="downloadPlaywright">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Playwright</span>
          </button>
          <button
            class="meta-action meta-action--inspect"
            :class="{ 'meta-action--active': inspectActive }"
            title="Inspect DOM elements"
            @click="toggleInspect"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span>{{ inspectActive ? 'Stop' : 'Inspect' }}</span>
          </button>
          <button class="meta-action meta-action--dom" title="Open DOM snapshot in new tab" @click="openDomInNewTab">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            <span>DOM</span>
          </button>

          <!-- Ticket integration -->
          <a
            v-if="ticketUrl && ticketId"
            :href="ticketUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="meta-action meta-action--ticket-linked"
            :title="`Open ticket ${ticketId}`"
          >
            <!-- Linear icon -->
            <svg v-if="ticketProvider === 'linear'" width="13" height="13" viewBox="0 0 100 100" fill="currentColor">
              <path d="M1.22541 61.5228c-.97437 2.2107.67508 4.8855 3.04498 4.8855 1.21745 0 2.33584-.684 2.88498-1.7683l28.8001-56.8116c1.2869-2.53813-.5765-5.4844-3.3628-5.3155-1.2207.0739-2.2928.8074-2.8271 1.934L1.22541 61.5228ZM21.9282 73.128c-1.4791 2.233.3765 5.2066 3.0523 4.8953 1.1506-.1338 2.1375-.882 2.618-1.989L52.7999 17.2246c1.0832-2.4997-.7741-5.2246-3.4633-5.0863-1.1696.0602-2.1942.7877-2.7232 1.9257L21.9282 73.128ZM42.2913 84.8795c-1.7076 2.2335.1916 5.3702 3.0732 5.0835 1.1086-.1103 2.0758-.8327 2.5766-1.9252L73.34 37.0486c.996-2.1724-.4606-4.6742-2.8268-4.8519-1.1968-.0898-2.3344.5326-2.9695 1.6189L42.2913 84.8795ZM62.8382 96.4565c-1.6501 2.1877.1247 5.2645 2.9523 5.0555.948-.0701 1.8124-.552 2.3135-1.2913.0461-.068.0909-.1377.1344-.2088L98.0547 37.2924c1.0035-2.1909-.4511-4.7088-2.835-4.8987-1.2057-.0961-2.358.5291-2.9928 1.6229L62.8382 96.4565Z"/>
            </svg>
            <!-- Jira icon -->
            <svg v-else-if="ticketProvider === 'jira'" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53ZM6.77 7.17c0 2.4 1.96 4.35 4.34 4.35h1.78v1.7c0 2.4 1.97 4.35 4.35 4.35V7.99a.84.84 0 0 0-.84-.82H6.77ZM2 12.31c0 2.4 1.97 4.35 4.35 4.36h1.78v1.7c.01 2.39 1.97 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.84L2 12.31Z"/>
            </svg>
            <!-- Generic ticket icon -->
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/>
              <rect x="3" y="4" width="18" height="16" rx="2"/>
            </svg>
            <span>{{ ticketId }}</span>
          </a>
          <button
            v-else-if="ticketProvider && !ticketUrl"
            class="meta-action meta-action--ticket-create"
            title="Create a ticket"
            @click="openTicketModal"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 5v2"/><path d="M15 11v2"/><path d="M15 17v2"/>
              <rect x="3" y="4" width="18" height="16" rx="2"/>
              <line x1="9" y1="12" x2="5" y2="12"/><line x1="7" y1="10" x2="7" y2="14"/>
            </svg>
            <span>Create ticket</span>
          </button>

          <!-- More actions dropdown -->
          <ReelActionMenu
            :reel-id="reelId"
            :reel-name="reelMeta?.original_name"
            :status="reelStatus"
            :assigned-user-id="reelMeta?.assigned_user_id"
            :tags="reelMeta?.tags"
            :workspace-id="reelMeta?.workspace_id"
            :headers="token ? { Authorization: `Bearer ${token}` } : {}"
            size="sm"
            @updated="loadReelMeta()"
            @deleted="navigateBack()"
          />
        </div>
      </div>

      <!-- Main area -->
      <div id="main">
        <!-- Player -->
        <div ref="playerWrap" id="player-wrap">
            <div ref="playerMount" id="player-mount" />

            <!-- Inspector detail panel -->
            <div v-if="inspectInfo" class="inspect-panel">
              <div class="inspect-header">
                <div class="inspect-selector">
                  <span class="inspect-tag">&lt;{{ inspectInfo.tag }}&gt;</span>
                  <span v-if="inspectInfo.id" class="inspect-id">#{{ inspectInfo.id }}</span>
                  <span v-if="inspectInfo.classes" class="inspect-cls">.{{ inspectInfo.classes.split(' ').join('.') }}</span>
                </div>
                <span class="inspect-dims">{{ inspectInfo.dimensions }}</span>
                <button class="inspect-close" @click="inspectInfo = null">&times;</button>
              </div>
              <div class="inspect-path">{{ inspectInfo.path }}</div>
              <div v-if="inspectInfo.attributes.length" class="inspect-section">
                <div class="inspect-section-title">Attributes</div>
                <div class="inspect-attrs">
                  <template v-for="attr in inspectInfo.attributes" :key="attr.name">
                    <span class="inspect-attr-name">{{ attr.name }}</span>
                    <span class="inspect-attr-val">{{ attr.value }}</span>
                  </template>
                </div>
              </div>
              <div v-if="inspectInfo.styles.length" class="inspect-section">
                <div class="inspect-section-title">Computed</div>
                <div class="inspect-styles">
                  <template v-for="s in inspectInfo.styles" :key="s.prop">
                    <span class="inspect-style-prop">{{ s.prop }}</span>
                    <span class="inspect-style-val">{{ s.value }}</span>
                  </template>
                </div>
              </div>
            </div>
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
              :class="{ active: activeTab === 'interactions' }"
              @click="activeTab = 'interactions'"
            >
              Events
              <span ref="interactionsCountEl" class="tab-count">0</span>
            </button>
            <button
              class="tab-btn"
              :class="{ active: activeTab === 'comments' }"
              @click="activeTab = 'comments'"
            >
              Comments
              <span class="tab-count">{{ fmtCount(comments.length) }}</span>
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
            <div class="net-filters">
              <div class="net-filter-group">
                <label>Type</label>
                <select v-model="netFilterType">
                  <option value="all">All</option>
                  <option value="XHR">XHR</option>
                  <option value="JS">JS</option>
                  <option value="CSS">CSS</option>
                  <option value="Img">Img</option>
                  <option value="Font">Font</option>
                  <option value="Media">Media</option>
                  <option value="Doc">Doc</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div class="net-filter-group">
                <label>Method</label>
                <select v-model="netFilterMethod">
                  <option value="all">All</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                  <option value="OPTIONS">OPTIONS</option>
                </select>
              </div>
              <div class="net-filter-group">
                <label>Status</label>
                <select v-model="netFilterStatus">
                  <option value="all">All</option>
                  <option value="2xx">2xx</option>
                  <option value="3xx">3xx</option>
                  <option value="4xx">4xx</option>
                  <option value="5xx">5xx</option>
                  <option value="Error">Error</option>
                </select>
              </div>
            </div>
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

          <!-- Interactions panel -->
          <div
            ref="interactionsPanelEl"
            class="panel"
            :class="{ active: activeTab === 'interactions' }"
            id="interactions-panel"
          >
            <div ref="interactionsListEl" id="interactions-list" />
          </div>

          <!-- Comments panel -->
          <div
            class="panel panel-comments"
            :class="{ active: activeTab === 'comments' }"
            id="comments-panel"
          >
            <!-- New comment form -->
            <div class="cm-compose">
              <div class="cm-input-box">
                <textarea
                  v-model="newCommentContent"
                  class="cm-textarea"
                  placeholder="Add a comment at current time…"
                  rows="2"
                  @keydown.ctrl.enter.prevent="submitComment"
                  @keydown.meta.enter.prevent="submitComment"
                />
                <div class="cm-input-footer">
                  <!-- Pinned element badge -->
                  <div v-if="pinnedElement" class="cm-pinned-badge">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                    <span class="cm-pinned-label">{{ pinnedElement.displayLabel }}</span>
                    <button class="cm-pinned-remove" @click="clearPinnedElement">&times;</button>
                  </div>
                  <!-- Pick mode hint -->
                  <div v-else-if="pickModeActive" class="cm-pick-inline-hint">
                    Click an element in the player…
                  </div>
                  <!-- Pin button -->
                  <button
                    v-if="!pinnedElement"
                    class="cm-pin-btn"
                    :class="{ 'cm-pin-btn--active': pickModeActive }"
                    :title="pickModeActive ? 'Cancel' : 'Pin a DOM element to this comment'"
                    @click="pickModeActive ? deactivatePickMode() : activatePickMode()"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                    </svg>
                    <span class="cm-pin-label">Select element</span>
                  </button>
                </div>
              </div>
              <button class="cm-send-btn" :disabled="submitting || !newCommentContent.trim()" @click="submitComment">
                Comment at {{ currentTimeDisplay }}
              </button>
            </div>

            <!-- Thread list -->
            <div v-if="commentThreads.length === 0" class="cm-empty">No comments yet</div>
            <div v-for="thread in commentThreads" :key="thread.id" class="cm-thread" :class="{ 'cm-future': thread.timestamp_ms > currentTimeMs }">
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
                <div class="cm-actions-row">
                  <button
                    v-if="thread.element_info"
                    class="cm-element-badge"
                    title="Click to highlight element in player"
                    @click="jumpToComment(thread.timestamp_ms); $nextTick(() => highlightCommentElement(thread.element_info))"
                    @mouseenter="showElementHighlight(thread.element_info)"
                    @mouseleave="hideElementHighlight()"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="9" r="4"/><path d="M12 13v4"/>
                    </svg>
                    {{ thread.element_info.displayLabel || '&lt;element&gt;' }}
                  </button>
                  <button class="cm-reply-toggle" @click="openReplyId = openReplyId === thread.id ? null : thread.id; replyContent = ''">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
                    </svg>
                    Reply
                  </button>
                </div>
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

      <!-- Controls (hidden for screenshots) -->
      <div v-if="!isScreenshot" id="controls">
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

    <!-- Ticket creation modal -->
    <div v-if="ticketModalOpen" class="ticket-overlay" @click.self="ticketModalOpen = false">
      <div class="ticket-modal">
        <div class="ticket-modal-header">
          <span class="ticket-modal-title">Create ticket</span>
          <button class="ticket-modal-close" @click="ticketModalOpen = false">&times;</button>
        </div>
        <div class="ticket-modal-body">
          <div v-if="ticketError" class="ticket-error">{{ ticketError }}</div>
          <label class="ticket-label">
            Title
            <input
              v-model="ticketTitle"
              class="ticket-input"
              type="text"
              placeholder="Bug title…"
              @keydown.enter.prevent="createTicket"
            />
          </label>
          <label class="ticket-label">
            Description
            <textarea
              v-model="ticketDescription"
              class="ticket-textarea"
              rows="4"
              placeholder="Describe the issue…"
            />
          </label>
        </div>
        <div class="ticket-modal-footer">
          <button class="ticket-btn ticket-btn--cancel" @click="ticketModalOpen = false">Cancel</button>
          <button class="ticket-btn ticket-btn--create" :disabled="!ticketTitle.trim() || ticketCreating" @click="createTicket">
            {{ ticketCreating ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </div>
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
  height: 34px;
  flex-shrink: 0;
  background: #1c1c1f;
  border-bottom: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 11px;
  overflow: visible;
  white-space: nowrap;
}

.meta-url-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #111113;
  border: 1px solid #2e2e33;
  border-radius: 6px;
  padding: 3px 10px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.meta-globe {
  color: #6b6b76;
  flex-shrink: 0;
}
.meta-url-text {
  color: #e2e2e6;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
}

.meta-date {
  color: #6b6b76;
  font-size: 10px;
  flex-shrink: 0;
}

/* ── Action buttons ── */
.meta-actions {
  display: flex;
  gap: 5px;
  margin-left: 8px;
  flex-shrink: 0;
}
.meta-action {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px 3px 8px;
  border-radius: 5px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
  white-space: nowrap;
  transition: all 0.15s;
}
.meta-action--playwright {
  background: rgba(52, 211, 153, 0.10);
  color: #6ee7b7;
  border-color: rgba(52, 211, 153, 0.20);
}
.meta-action--playwright:hover {
  background: rgba(52, 211, 153, 0.18);
  border-color: rgba(52, 211, 153, 0.40);
  color: #a7f3d0;
}
.meta-action--inspect {
  background: rgba(96, 165, 250, 0.10);
  color: #93bbfd;
  border-color: rgba(96, 165, 250, 0.20);
}
.meta-action--inspect:hover {
  background: rgba(96, 165, 250, 0.18);
  border-color: rgba(96, 165, 250, 0.40);
  color: #bdd4fe;
}
.meta-action--inspect.meta-action--active {
  background: rgba(96, 165, 250, 0.22);
  border-color: rgba(96, 165, 250, 0.55);
  color: #bdd4fe;
  box-shadow: 0 0 10px rgba(96, 165, 250, 0.20);
}
.meta-action--dom {
  background: rgba(251, 191, 36, 0.10);
  color: #fcd34d;
  border-color: rgba(251, 191, 36, 0.20);
}
.meta-action--dom:hover {
  background: rgba(251, 191, 36, 0.18);
  border-color: rgba(251, 191, 36, 0.40);
  color: #fde68a;
  background: rgba(76, 141, 255, 0.08);
}
.meta-action--ticket-linked {
  background: rgba(167, 139, 250, 0.10);
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.20);
  text-decoration: none;
}
.meta-action--ticket-linked:hover {
  background: rgba(167, 139, 250, 0.18);
  border-color: rgba(167, 139, 250, 0.40);
  color: #ddd6fe;
}
.meta-action--ticket-create {
  background: rgba(167, 139, 250, 0.10);
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.20);
}
.meta-action--ticket-create:hover {
  background: rgba(167, 139, 250, 0.18);
  border-color: rgba(167, 139, 250, 0.40);
  color: #ddd6fe;
}

/* ── Ticket modal ────────────────────────────────────────────────────────── */
.ticket-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
}
.ticket-modal {
  background: #1c1c1f;
  border: 1px solid #2e2e33;
  border-radius: 10px;
  width: 420px;
  max-width: 90vw;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.ticket-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid #2e2e33;
}
.ticket-modal-title {
  font-size: 13px;
  font-weight: 600;
  color: #e2e2e6;
}
.ticket-modal-close {
  background: none;
  border: none;
  color: #6b6b76;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.ticket-modal-close:hover {
  color: #e2e2e6;
}
.ticket-modal-body {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ticket-error {
  background: rgba(241, 99, 112, 0.12);
  border: 1px solid rgba(241, 99, 112, 0.25);
  color: #f9a8b0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11.5px;
}
.ticket-label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: #a0a0ab;
}
.ticket-required {
  color: #f16370;
}
.ticket-input {
  background: #111113;
  border: 1px solid #2e2e33;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e2e2e6;
  font-family: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.ticket-input:focus {
  border-color: #4c8dff;
}
.ticket-textarea {
  background: #111113;
  border: 1px solid #2e2e33;
  border-radius: 6px;
  padding: 8px 10px;
  color: #e2e2e6;
  font-family: inherit;
  font-size: 12px;
  outline: none;
  resize: vertical;
  transition: border-color 0.15s;
}
.ticket-textarea:focus {
  border-color: #4c8dff;
}
.ticket-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 14px;
  border-top: 1px solid #2e2e33;
}
.ticket-btn {
  padding: 7px 16px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.ticket-btn--cancel {
  background: #242428;
  color: #a0a0ab;
  border-color: #2e2e33;
}
.ticket-btn--cancel:hover {
  background: #2e2e33;
  color: #e2e2e6;
}
.ticket-btn--create {
  background: rgba(167, 139, 250, 0.20);
  color: #c4b5fd;
  border-color: rgba(167, 139, 250, 0.30);
}
.ticket-btn--create:hover:not(:disabled) {
  background: rgba(167, 139, 250, 0.30);
  border-color: rgba(167, 139, 250, 0.50);
  color: #ddd6fe;
}
.ticket-btn--create:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
#player-mount.inspect-mode :deep(.replayer-wrapper) {
  pointer-events: auto !important;
}
#player-mount.inspect-mode :deep(.replayer-wrapper iframe) {
  pointer-events: auto !important;
}
#player-mount.inspect-mode :deep(.replayer-mouse) {
  pointer-events: none !important;
}
#player-mount.inspect-mode :deep(.replayer-wrapper > *:not(iframe)) {
  pointer-events: none !important;
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
  overflow: hidden;
  min-width: 0;
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
  color: #ff4070;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 46px;
  background: rgba(255, 64, 112, 0.15);
  border: none;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: pointer;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  transition: background 0.15s;
}
:deep(.c-ts:hover) { background: rgba(255, 64, 112, 0.25); }

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

/* ── Network filters ─────────────────────────────────────────────────────── */
.net-filters {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  background: #1a1a1e;
  border-bottom: 1px solid #2e2e33;
  flex-shrink: 0;
}
.net-filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.net-filter-group label {
  font-size: 10px;
  color: #6b6b76;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}
.net-filter-group select {
  background: #242428;
  color: #e2e2e6;
  border: 1px solid #333;
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 6px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  cursor: pointer;
  outline: none;
}
.net-filter-group select:focus {
  border-color: #4c8dff;
}

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
  background: #ff4070;
  border: 2px solid #111113;
  cursor: pointer;
  padding: 0;
  z-index: 2;
  transition: transform 0.1s, background 0.1s;
}

.cm-bubble:hover {
  background: #ff6b91;
  transform: translate(-50%, -50%) scale(1.3);
}

/* ── Interactions panel ──────────────────────────────────────────────────── */
#interactions-list { padding: 2px 0; }
:deep(.ix-row.future) { opacity: 0.3; }

:deep(.ix-row) {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding: 4px 10px 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.55;
  border-left: 2px solid transparent;
}

:deep(.ix-row:hover) { background: rgba(255,255,255,0.03); }
:deep(.ix-navigate) { border-left-color: #4c8dff; }
:deep(.ix-input)    { border-left-color: #3ecf8e; }
:deep(.ix-click)    { border-left-color: #6b6b76; }

:deep(.ix-ts) {
  color: #ff4070;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 46px;
  background: rgba(255, 64, 112, 0.15);
  border: none;
  border-radius: 3px;
  padding: 1px 5px;
  cursor: pointer;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  transition: background 0.15s;
}

:deep(.ix-ts:hover) { background: rgba(255, 64, 112, 0.25); }

:deep(.ix-icon) {
  flex-shrink: 0;
  font-size: 12px;
  width: 14px;
  text-align: center;
}

:deep(.ix-navigate .ix-icon) { color: #4c8dff; }
:deep(.ix-input .ix-icon)    { color: #3ecf8e; }
:deep(.ix-click .ix-icon)    { color: #6b6b76; }

:deep(.ix-body) {
  color: #e2e2e6;
  word-break: break-all;
  white-space: pre-wrap;
  flex: 1;
  min-width: 0;
}

:deep(.ix-navigate .ix-body) { color: #4c8dff; }
:deep(.ix-input .ix-body)    { color: #c8c8ce; }

:deep(.ix-tag) {
  color: #6b6b76;
  font-size: 10px;
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
  transition: opacity 0.2s;
}
.cm-thread.cm-future {
  opacity: 0.3;
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
  background: rgba(255, 64, 112, 0.15);
  border: none;
  border-radius: 3px;
  color: #ff4070;
  cursor: pointer;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  transition: background 0.15s;
}

.cm-ts-btn:hover { background: rgba(255, 64, 112, 0.25); }

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

.cm-actions-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.cm-reply-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid #2e2e33;
  border-radius: 4px;
  color: #8b8b98;
  cursor: pointer;
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 500;
  padding: 3px 8px 3px 6px;
  transition: all 0.15s;
}

.cm-reply-toggle:hover {
  color: #c8c8ce;
  border-color: #48485a;
  background: rgba(255, 255, 255, 0.03);
}

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

/* ── Inspector detail panel ─────────────────────────────────────────────── */
.inspect-panel {
  position: absolute;
  bottom: 12px;
  left: 12px;
  max-width: 420px;
  max-height: 50%;
  overflow-y: auto;
  background: rgba(28, 28, 31, 0.96);
  border: 1px solid #2e2e33;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  z-index: 10;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.inspect-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.inspect-selector {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspect-tag { color: #f4844a; font-weight: 600; }
.inspect-id { color: #4c8dff; }
.inspect-cls { color: #3ecf8e; }

.inspect-dims {
  color: #6b6b76;
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.inspect-close {
  background: none;
  border: none;
  color: #6b6b76;
  cursor: pointer;
  font-size: 16px;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.inspect-close:hover { color: #e2e2e6; }

.inspect-path {
  color: #6b6b76;
  font-size: 10px;
  margin-bottom: 8px;
  word-break: break-all;
  line-height: 1.4;
}

.inspect-section {
  margin-top: 8px;
}

.inspect-section-title {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #6b6b76;
  margin-bottom: 4px;
}

.inspect-attrs,
.inspect-styles {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 0;
}

.inspect-attr-name {
  color: #f4844a;
  padding: 2px 8px 2px 0;
  white-space: nowrap;
}

.inspect-attr-val {
  color: #4c8dff;
  padding: 2px 0;
  word-break: break-all;
}

.inspect-style-prop {
  color: #c8c8ce;
  padding: 2px 8px 2px 0;
  white-space: nowrap;
}

.inspect-style-val {
  color: #3ecf8e;
  padding: 2px 0;
  word-break: break-all;
}

/* ── Comment input box with integrated pin ── */
.cm-input-box {
  border: 1px solid #2e2e33;
  border-radius: 6px;
  background: #111113;
  overflow: hidden;
  transition: border-color 0.15s;
}
.cm-input-box:focus-within {
  border-color: #48485a;
}
.cm-input-box .cm-textarea {
  border: none;
  border-radius: 0;
  background: transparent;
  resize: none;
}
.cm-input-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 5px;
  min-height: 24px;
}

.cm-pin-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: #55555f;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
  flex-shrink: 0;
  padding: 0 6px;
}
.cm-pin-label {
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.cm-pin-btn:hover {
  color: #93bbfd;
  background: rgba(96, 165, 250, 0.1);
}
.cm-pin-btn--active {
  color: #93bbfd;
  background: rgba(96, 165, 250, 0.15);
  animation: cm-pin-glow 1.8s ease-in-out infinite;
}

@keyframes cm-pin-glow {
  0%, 100% { box-shadow: 0 0 6px rgba(96, 165, 250, 0.2); }
  50% { box-shadow: 0 0 12px rgba(96, 165, 250, 0.35); }
}

.cm-pick-inline-hint {
  font-size: 10px;
  color: rgba(96, 165, 250, 0.7);
  animation: cm-pick-pulse 1.8s ease-in-out infinite;
}

/* Pinned element badge */
.cm-pinned-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(96, 165, 250, 0.1);
  border: 1px solid rgba(96, 165, 250, 0.25);
  border-radius: 3px;
  padding: 2px 6px 2px 5px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 10px;
  color: #93bbfd;
  max-width: calc(100% - 30px);
}

.cm-pinned-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.cm-pinned-remove {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #6b6b76;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
  transition: color 0.15s;
}
.cm-pinned-remove:hover {
  color: #f16370;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.4;
}

@keyframes cm-pick-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.cm-element-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(76, 141, 255, 0.08);
  border: 1px solid rgba(76, 141, 255, 0.20);
  border-radius: 4px;
  padding: 3px 7px 3px 5px;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 10px;
  color: #7aabff;
  cursor: pointer;
  transition: all 0.15s;
}

.cm-element-badge:hover {
  background: rgba(76, 141, 255, 0.15);
  border-color: rgba(76, 141, 255, 0.40);
  color: #93bbfd;
}

.cm-element-badge svg {
  flex-shrink: 0;
}

</style>
