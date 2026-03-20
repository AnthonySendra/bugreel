<script setup lang="ts">
const { token } = useAuth()
const isLoggedIn = computed(() => !!token.value)
const runtimeConfig = useRuntimeConfig()
const isStatic = computed(() => !!runtimeConfig.public.staticLanding)

const copied = ref<string | null>(null)
const previewTab = ref<'console' | 'network' | 'events' | 'comments'>('console')
const previewNetDetail = ref(false)

function copyToClipboard(text: string, id: string) {
  navigator.clipboard.writeText(text)
  copied.value = id
  setTimeout(() => { copied.value = null }, 2000)
}

// ── Preview player animation ──────────────────────────────────────────────
const previewPlaying = ref(false)
const previewTime = ref(0) // 0-5000ms
const previewProgress = computed(() => (previewTime.value / 5000) * 100)
const previewTimeDisplay = computed(() => {
  const s = previewTime.value / 1000
  const sec = Math.floor(s)
  const dec = Math.floor((s - sec) * 10)
  return `0:0${sec}.${dec}`
})
// Which fake site state to show based on time
const previewPhase = computed(() => {
  if (previewTime.value < 1500) return 'idle'       // normal site
  if (previewTime.value < 2800) return 'click'      // user clicks migrate
  if (previewTime.value < 3500) return 'loading'    // loading state
  return 'error'                                     // error appears
})
// Console entries visible up to current time
const allConsoleEntries = [
  { time: 200, ts: '0:00.2', text: '[info] App initialized', type: 'info' },
  { time: 800, ts: '0:00.8', text: 'GET /api/projects 200', type: 'info', hasStatus: true },
  { time: 1500, ts: '0:01.5', text: '[info] User clicked "Migrate"', type: 'info' },
  { time: 2000, ts: '0:02.0', text: 'POST /api/projects/migrate', type: 'info' },
  { time: 2800, ts: '0:02.8', text: '[warn] Deprecated API field "legacy_id"', type: 'warn' },
  { time: 3500, ts: '0:03.5', text: 'POST /api/projects/migrate 500', type: 'error', hasStatus: true },
  { time: 3600, ts: '0:03.6', text: 'TypeError: Cannot read property \'map\' of undefined', type: 'error' },
  { time: 3700, ts: '0:03.7', text: '  at ProjectList.render (projects.tsx:42)', type: 'error' },
]
const visibleConsoleEntries = computed(() =>
  allConsoleEntries.filter(e => e.time <= previewTime.value)
)

let animFrame: number | null = null
let startTs = 0
let startTime = 0

function togglePreviewPlay() {
  if (previewPlaying.value) {
    previewPlaying.value = false
    if (animFrame) cancelAnimationFrame(animFrame)
    return
  }
  // Reset if at end
  if (previewTime.value >= 5000) previewTime.value = 0
  previewPlaying.value = true
  startTs = performance.now()
  startTime = previewTime.value
  tick()
}

function tick() {
  if (!previewPlaying.value) return
  const elapsed = performance.now() - startTs
  previewTime.value = Math.min(startTime + elapsed, 5000)
  if (previewTime.value >= 5000) {
    previewPlaying.value = false
    return
  }
  animFrame = requestAnimationFrame(tick)
}

function seekPreview(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  previewTime.value = Math.round(pct * 5000)
}
</script>

<template>
  <div class="min-h-screen bg-neutral-950 text-neutral-300">
    <!-- Nav -->
    <nav class="fixed top-0 inset-x-0 z-50 border-b border-neutral-800/60 bg-neutral-950/80 backdrop-blur-xl">
      <div class="max-w-5xl mx-auto flex items-center justify-between px-6 h-14">
        <NuxtLink to="/" class="flex items-center gap-2.5 group">
          <div class="w-3.5 h-3.5 rounded-full bg-bugreel-500 shrink-0 group-hover:bg-bugreel-400 transition-colors" />
          <span class="text-lg font-semibold tracking-tight text-white">bugreel</span>
        </NuxtLink>
        <div class="flex items-center gap-3">
          <UButton href="https://github.com/AnthonySendra/bugreel" target="_blank" variant="ghost" color="neutral" size="sm" icon="i-lucide-github" label="GitHub" />
          <template v-if="!isStatic">
            <template v-if="isLoggedIn">
              <UButton to="/dashboard" size="sm" label="Dashboard" />
            </template>
            <template v-else>
              <UButton to="/login" variant="ghost" color="neutral" size="sm" label="Sign in" />
              <UButton to="/register" size="sm" label="Get started" />
            </template>
          </template>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="pt-32 pb-20 px-6">
      <div class="max-w-3xl mx-auto text-center space-y-6">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bugreel-950/60 border border-bugreel-800/40 text-bugreel-400 text-xs font-medium tracking-wide uppercase">
          <span class="w-1.5 h-1.5 rounded-full bg-bugreel-500 animate-pulse" />
          Self-hosted &middot; Open source
        </div>
        <h1 class="text-5xl sm:text-6xl font-bold tracking-tight text-white leading-[1.1]">
          Bug reports that<br class="hidden sm:block" /> actually make sense
        </h1>
        <p class="text-lg text-neutral-400 max-w-xl mx-auto leading-relaxed">
          Capture DOM, console, network &amp; interactions as a structured, replayable recording &mdash; not a video. Self-hosted, no vendor lock-in.
        </p>
        <div class="flex items-center justify-center gap-4 pt-2">
          <template v-if="!isStatic">
            <UButton v-if="isLoggedIn" to="/dashboard" size="lg" label="Dashboard" />
            <UButton v-else to="/register" size="lg" label="Create an account" />
          </template>
          <UButton :href="isStatic ? '#install' : '#setup'" size="lg" variant="outline" color="neutral" :label="isStatic ? 'Install' : 'Setup guide'" />
          <UButton href="https://github.com/AnthonySendra/bugreel" target="_blank" size="lg" variant="outline" color="neutral" icon="i-lucide-github" label="GitHub" />
        </div>
      </div>
    </section>

    <!-- Player preview -->
    <section class="pb-24 px-6">
      <div class="max-w-5xl mx-auto">
        <div class="preview-player">
          <!-- Meta bar -->
          <div class="preview-meta">
            <div class="preview-url-bar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-600 shrink-0">
                <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span class="text-neutral-500 text-[11px] truncate">https://app.example.com/dashboard</span>
            </div>
            <span class="text-neutral-600 text-[10px] hidden sm:inline">Mar 20, 2026 14:32</span>
            <div class="preview-meta-actions">
              <span class="preview-meta-btn">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span class="hidden sm:inline">Playwright</span>
              </span>
              <span class="preview-meta-btn">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <span class="hidden sm:inline">Inspect</span>
              </span>
              <span class="preview-meta-btn">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <span class="hidden sm:inline">DOM</span>
              </span>
            </div>
          </div>

          <!-- Main area -->
          <div class="preview-main">
            <!-- Fake website in player -->
            <div class="preview-player-area">
              <div class="preview-fake-site">
                <!-- Fake site nav -->
                <div class="preview-site-nav">
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-5 rounded bg-blue-500/80" />
                    <span class="text-[11px] text-neutral-300 font-medium">Acme App</span>
                  </div>
                  <div class="flex gap-3">
                    <span class="text-[10px] text-neutral-500">Dashboard</span>
                    <span class="text-[10px] text-blue-400">Projects</span>
                    <span class="text-[10px] text-neutral-500">Settings</span>
                  </div>
                </div>
                <!-- Fake site content -->
                <div class="p-4 space-y-3">
                  <div class="flex items-center justify-between">
                    <span class="text-[12px] text-neutral-200 font-medium">Projects</span>
                    <div class="px-2 py-0.5 rounded bg-blue-500/20 text-[9px] text-blue-400">+ New</div>
                  </div>
                  <div class="space-y-2">
                    <div class="preview-site-card">
                      <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-green-500/70" />
                        <span class="text-[10px] text-neutral-300">Frontend redesign</span>
                      </div>
                      <span class="text-[9px] text-neutral-600">3 tasks</span>
                    </div>
                    <div class="preview-site-card" :class="{ 'preview-site-card--error': previewPhase === 'error', 'preview-site-card--highlight': previewPhase === 'click' }">
                      <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full" :class="previewPhase === 'error' ? 'bg-red-500/70' : previewPhase === 'loading' ? 'bg-yellow-500/70 animate-pulse' : 'bg-blue-500/70'" />
                        <span class="text-[10px] text-neutral-300">API migration</span>
                      </div>
                      <span v-if="previewPhase === 'error'" class="text-[9px] text-red-400/80">Error</span>
                      <span v-else-if="previewPhase === 'loading'" class="text-[9px] text-yellow-500/60">Migrating…</span>
                      <span v-else-if="previewPhase === 'click'" class="text-[9px] text-blue-400/60">Migrate →</span>
                      <span v-else class="text-[9px] text-neutral-600">5 tasks</span>
                    </div>
                    <!-- Error toast -->
                    <Transition name="preview-toast">
                      <div v-if="previewPhase === 'error'" class="preview-error-toast">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="text-red-400 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        <span class="text-[10px] text-red-300">Migration failed: internal server error</span>
                      </div>
                    </Transition>
                    <div class="preview-site-card">
                      <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-yellow-500/70" />
                        <span class="text-[10px] text-neutral-300">Auth service</span>
                      </div>
                      <span class="text-[9px] text-neutral-600">7 tasks</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Side panel -->
            <div class="preview-side">
              <!-- Tab bar -->
              <div class="preview-tabs">
                <button class="preview-tab" :class="{ 'preview-tab--active': previewTab === 'console' }" @click="previewTab = 'console'">Console <span class="preview-tab-count" :class="{ 'preview-tab-count--active': previewTab === 'console' }">12</span></button>
                <button class="preview-tab" :class="{ 'preview-tab--active': previewTab === 'network' }" @click="previewTab = 'network'">Network <span class="preview-tab-count" :class="{ 'preview-tab-count--active': previewTab === 'network' }">47</span></button>
                <button class="preview-tab" :class="{ 'preview-tab--active': previewTab === 'events' }" @click="previewTab = 'events'">Events <span class="preview-tab-count" :class="{ 'preview-tab-count--active': previewTab === 'events' }">8</span></button>
                <button class="preview-tab" :class="{ 'preview-tab--active': previewTab === 'comments' }" @click="previewTab = 'comments'">Comments <span class="preview-tab-count" :class="{ 'preview-tab-count--active': previewTab === 'comments' }">1</span></button>
              </div>

              <!-- Console -->
              <div v-if="previewTab === 'console'" class="preview-panel">
                <TransitionGroup name="preview-entry">
                  <div
                    v-for="entry in visibleConsoleEntries"
                    :key="entry.ts"
                    class="preview-console-entry"
                    :class="{
                      'preview-console-entry--warn': entry.type === 'warn',
                      'preview-console-entry--error': entry.type === 'error',
                    }"
                  >
                    <span class="text-neutral-600 text-[9px] shrink-0">{{ entry.ts }}</span>
                    <span
                      class="text-[10px]"
                      :class="{
                        'text-neutral-400': entry.type === 'info',
                        'text-yellow-500/80': entry.type === 'warn',
                        'text-red-400': entry.type === 'error',
                      }"
                    >{{ entry.text }}</span>
                  </div>
                </TransitionGroup>
                <div v-if="visibleConsoleEntries.length === 0" class="p-3 text-[10px] text-neutral-600 text-center">
                  Press play to start the recording…
                </div>
              </div>

              <!-- Network -->
              <div v-if="previewTab === 'network'" class="preview-panel">
                <template v-if="!previewNetDetail">
                  <div class="preview-net-header">
                    <span class="text-[9px] text-neutral-600 w-8">Method</span>
                    <span class="text-[9px] text-neutral-600 w-6">Status</span>
                    <span class="text-[9px] text-neutral-600 flex-1">URL</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">Time</span>
                  </div>
                  <div class="preview-net-row">
                    <span class="text-[9px] text-neutral-500 w-8">GET</span>
                    <span class="text-[9px] text-green-500/70 w-6">200</span>
                    <span class="text-[9px] text-neutral-400 flex-1 truncate">/api/projects</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">124ms</span>
                  </div>
                  <div class="preview-net-row">
                    <span class="text-[9px] text-neutral-500 w-8">GET</span>
                    <span class="text-[9px] text-green-500/70 w-6">200</span>
                    <span class="text-[9px] text-neutral-400 flex-1 truncate">/api/user</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">89ms</span>
                  </div>
                  <div class="preview-net-row preview-net-row--error preview-net-row--clickable" @click="previewNetDetail = true">
                    <span class="text-[9px] text-neutral-500 w-8">POST</span>
                    <span class="text-[9px] text-red-400 w-6">500</span>
                    <span class="text-[9px] text-neutral-400 flex-1 truncate">/api/projects/migrate</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">2.1s</span>
                  </div>
                  <div class="preview-net-row">
                    <span class="text-[9px] text-neutral-500 w-8">GET</span>
                    <span class="text-[9px] text-green-500/70 w-6">200</span>
                    <span class="text-[9px] text-neutral-400 flex-1 truncate">/api/notifications</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">67ms</span>
                  </div>
                  <div class="preview-net-row">
                    <span class="text-[9px] text-neutral-500 w-8">GET</span>
                    <span class="text-[9px] text-green-500/70 w-6">304</span>
                    <span class="text-[9px] text-neutral-400 flex-1 truncate">/assets/main.css</span>
                    <span class="text-[9px] text-neutral-600 w-8 text-right">12ms</span>
                  </div>
                </template>
                <!-- Request detail -->
                <template v-else>
                  <div class="preview-net-detail-header">
                    <button class="preview-net-back" @click="previewNetDetail = false">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span class="text-[9px] text-neutral-500">POST</span>
                    <span class="text-[9px] text-red-400">500</span>
                    <span class="text-[9px] text-neutral-400 truncate">/api/projects/migrate</span>
                  </div>
                  <div class="preview-net-detail-body">
                    <div class="preview-net-detail-section">
                      <span class="text-[8px] text-neutral-600 uppercase tracking-wider">Request Headers</span>
                      <div class="preview-net-detail-kv">
                        <span class="text-neutral-500">Content-Type</span>
                        <span class="text-neutral-400">application/json</span>
                      </div>
                      <div class="preview-net-detail-kv">
                        <span class="text-neutral-500">Authorization</span>
                        <span class="text-neutral-400">Bearer eyJhbG...x4kQ</span>
                      </div>
                    </div>
                    <div class="preview-net-detail-section">
                      <span class="text-[8px] text-neutral-600 uppercase tracking-wider">Response Headers</span>
                      <div class="preview-net-detail-kv">
                        <span class="text-neutral-500">Content-Type</span>
                        <span class="text-neutral-400">application/json</span>
                      </div>
                      <div class="preview-net-detail-kv">
                        <span class="text-neutral-500">X-Request-Id</span>
                        <span class="text-neutral-400">req_8f2a...3d1b</span>
                      </div>
                    </div>
                    <div class="preview-net-detail-section">
                      <span class="text-[8px] text-neutral-600 uppercase tracking-wider">Response Body</span>
                      <pre class="preview-net-detail-json"><span class="text-neutral-600">{</span>
  <span class="text-blue-400">"error"</span><span class="text-neutral-600">:</span> <span class="text-red-400">"InternalServerError"</span><span class="text-neutral-600">,</span>
  <span class="text-blue-400">"message"</span><span class="text-neutral-600">:</span> <span class="text-red-400">"Cannot read property 'map' of undefined"</span><span class="text-neutral-600">,</span>
  <span class="text-blue-400">"stack"</span><span class="text-neutral-600">:</span> <span class="text-neutral-500">"TypeError: Cannot read property 'map'
    at migrateProjects (projects.ts:87)
    at handler (router.ts:142)"</span>
<span class="text-neutral-600">}</span></pre>
                    </div>
                  </div>
                </template>
              </div>

              <!-- Events -->
              <div v-if="previewTab === 'events'" class="preview-panel">
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:01.0</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">navigate</span> /dashboard</span>
                </div>
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:02.8</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">click</span> button.nav-link "Projects"</span>
                </div>
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:03.1</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">navigate</span> /projects</span>
                </div>
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:04.5</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">click</span> div.project-card "API migration"</span>
                </div>
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:05.0</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">click</span> button "Migrate"</span>
                </div>
                <div class="preview-console-entry">
                  <span class="text-neutral-600 text-[9px] shrink-0">0:07.2</span>
                  <span class="text-[10px] text-neutral-400"><span class="text-blue-400/70">scroll</span> window (0, 340)</span>
                </div>
              </div>

              <!-- Comments -->
              <div v-if="previewTab === 'comments'" class="preview-panel preview-panel--comments">
                <div class="preview-comment">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-[9px] text-blue-400 font-medium px-1.5 py-0.5 rounded bg-blue-500/10">0:03.5</span>
                    <span class="text-[10px] text-neutral-300">alice@acme.com</span>
                    <span class="text-[9px] text-neutral-600">2m ago</span>
                  </div>
                  <p class="text-[10px] text-neutral-400 leading-relaxed">The project list crashes here after the migration API returns a 500. Looks like the response is missing the expected array.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Controls bar -->
          <div class="preview-controls">
            <button class="preview-play-btn" @click="togglePreviewPlay">
              <svg v-if="!previewPlaying" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="4" height="18"/><rect x="15" y="3" width="4" height="18"/></svg>
            </button>
            <div class="preview-timeline" @click="seekPreview">
              <div class="preview-progress" :style="{ width: previewProgress + '%' }" />
              <div class="preview-bubble" style="left: 70%" />
            </div>
            <span class="text-[10px] text-neutral-500 tabular-nums shrink-0">{{ previewTimeDisplay }} / 0:05.0</span>
          </div>
        </div>
      </div>
    </section>

    <!-- What it captures -->
    <section class="pb-24 px-6">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-sm font-medium text-neutral-500 uppercase tracking-widest mb-8 text-center">What each recording captures</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-monitor" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">DOM Replay</h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Pixel-perfect interactive replay using rrweb. Not a video &mdash; you can inspect elements, scroll, and resize.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-terminal" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">Console Logs</h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Every log, warning, error and uncaught exception with precise timestamps synced to the replay timeline.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-globe" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">Network Requests</h3>
            <p class="text-sm text-neutral-400 leading-relaxed">URL, method, status, headers, duration and response bodies. See exactly what the API returned when the bug happened.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-mouse-pointer-click" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">User Interactions</h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Clicks, inputs, and navigations logged in order. Jump to any interaction on the timeline to see what the user did.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="pb-24 px-6">
      <div class="max-w-5xl mx-auto">
        <h2 class="text-sm font-medium text-neutral-500 uppercase tracking-widest mb-8 text-center">Built for developers</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-message-square" class="text-neutral-500" />
              Timestamped Comments
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Add comments at any point in the timeline. Threaded replies with email notifications to keep the team in sync.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-flask-conical" class="text-neutral-500" />
              Playwright Export
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Generate a ready-to-run <code class="text-bugreel-400">.spec.ts</code> file from any recording. Reproduce bugs in CI automatically.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-search" class="text-neutral-500" />
              DOM Inspector
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Hover over any element in the replay to inspect attributes and computed styles, like DevTools frozen in time.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-puzzle" class="text-neutral-500" />
              Browser Extension
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Chrome and Firefox extensions for full-featured recording including multi-page navigations.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-code" class="text-neutral-500" />
              Embed SDK
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">One script tag to add a "Record Bug" button to any site. No installation required for your users.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-database" class="text-neutral-500" />
              Your Infrastructure
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">SQLite + local disk or any S3-compatible storage. No external dependencies, runs anywhere with Docker.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-plug" class="text-neutral-500" />
              Linear &amp; Jira Integration
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Create tickets directly from recordings. Bidirectional sync &mdash; mark a reel as done to close the ticket, or close the ticket to mark the reel as done.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-circle-dot" class="text-neutral-500" />
              Permanent Recording
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">SDK records continuously in a rolling buffer. When a bug happens, the last N seconds are already captured &mdash; no need to reproduce.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-bell" class="text-neutral-500" />
              Slack, Discord &amp; Mattermost
            </h3>
            <p class="text-sm text-neutral-400 leading-relaxed">Webhook notifications for new recordings, comments, and done reels. Works with Slack, Discord, Mattermost, or any HTTP endpoint.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Install (static landing only) -->
    <section v-if="isStatic" id="install" class="pb-24 px-6 scroll-mt-20">
      <div class="max-w-3xl mx-auto">
        <h2 class="text-2xl font-bold text-white mb-2 text-center">Install</h2>
        <p class="text-sm text-neutral-500 mb-10 text-center">Get bugreel running on your infrastructure in seconds.</p>

        <div class="grid sm:grid-cols-2 gap-4 mb-6">
          <!-- Docker -->
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-container" class="text-bugreel-400 text-lg" />
              <h3 class="text-white font-semibold text-sm">Docker</h3>
            </div>
            <div class="relative group">
              <pre class="rounded-lg bg-neutral-950 border border-neutral-800 p-3 text-xs overflow-x-auto"><code class="text-neutral-300">docker run -p 7777:7777 \
  -e NUXT_JWT_SECRET=your-secret \
  -v bugreel-data:/data \
  patatra/bugreel</code></pre>
              <button
                class="absolute top-2 right-2 p-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                @click="copyToClipboard('docker run -p 7777:7777 -e NUXT_JWT_SECRET=your-secret -v bugreel-data:/data patatra/bugreel', 'docker')"
              >
                <UIcon :name="copied === 'docker' ? 'i-lucide-check' : 'i-lucide-copy'" class="text-sm" />
              </button>
            </div>
            <p class="text-xs text-neutral-500">Available at <code class="text-neutral-400">http://localhost:7777</code></p>
          </div>

          <!-- From source -->
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="flex items-center gap-2 mb-1">
              <UIcon name="i-lucide-terminal" class="text-bugreel-400 text-lg" />
              <h3 class="text-white font-semibold text-sm">From source</h3>
            </div>
            <div class="relative group">
              <pre class="rounded-lg bg-neutral-950 border border-neutral-800 p-3 text-xs overflow-x-auto"><code class="text-neutral-300">git clone https://github.com/AnthonySendra/bugreel.git
cd bugreel/app
npm install
NUXT_JWT_SECRET=your-secret npm run dev</code></pre>
              <button
                class="absolute top-2 right-2 p-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                @click="copyToClipboard('git clone https://github.com/AnthonySendra/bugreel.git && cd bugreel/app && npm install && NUXT_JWT_SECRET=your-secret npm run dev', 'source')"
              >
                <UIcon :name="copied === 'source' ? 'i-lucide-check' : 'i-lucide-copy'" class="text-sm" />
              </button>
            </div>
            <p class="text-xs text-neutral-500">Available at <code class="text-neutral-400">http://localhost:7777</code></p>
          </div>
        </div>

        <div class="text-center">
          <UButton href="https://github.com/AnthonySendra/bugreel#readme" target="_blank" size="sm" variant="outline" color="neutral" icon="i-lucide-book-open" label="Full documentation" trailing-icon="i-lucide-external-link" />
        </div>
      </div>
    </section>

    <!-- Setup Guide -->
    <section id="setup" class="pb-24 px-6 scroll-mt-20">
      <div class="max-w-3xl mx-auto">
        <h2 class="text-2xl font-bold text-white mb-2 text-center">Setup guide</h2>
        <p class="text-sm text-neutral-500 mb-12 text-center">Your server is running. Here's how to start recording bugs.</p>

        <!-- Step 1 -->
        <div class="relative pl-10 pb-12 border-l border-neutral-800 ml-4">
          <div class="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-xs font-bold text-white">1</div>
          <h3 class="text-white font-semibold mb-2">Create an account</h3>
          <p class="text-sm text-neutral-400 mb-4">Register to create your first workspace and application.</p>
          <UButton v-if="!isStatic" to="/register" size="sm" variant="soft" label="Create account →" />
        </div>

        <!-- Step 2 -->
        <div class="relative pl-10 pb-12 border-l border-neutral-800 ml-4">
          <div class="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-xs font-bold text-white">2</div>
          <h3 class="text-white font-semibold mb-2">Create a workspace &amp; application</h3>
          <p class="text-sm text-neutral-400 mb-1">After signing in, create a workspace (e.g. your team name) then add an application inside it (e.g. "Frontend", "Dashboard").</p>
          <p class="text-sm text-neutral-400">Each application gets its own reel feed. The endpoint URL for the extension/SDK will be generated in the next step.</p>
        </div>

        <!-- Step 3 -->
        <div class="relative pl-10 pb-12 border-l border-neutral-800 ml-4">
          <div class="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-xs font-bold text-white">3</div>
          <h3 class="text-white font-semibold mb-2">Generate an API token</h3>
          <p class="text-sm text-neutral-400 mb-3">Open your application and go to the <strong class="text-neutral-300">API Tokens</strong> tab. Create a new token &mdash; an <strong class="text-neutral-300">endpoint URL</strong> is generated that contains everything the extension and SDK need to upload recordings.</p>
          <div class="rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-xs space-y-2">
            <p class="text-neutral-500">Application → API Tokens → <span class="text-bugreel-400">Create token</span></p>
            <p class="text-neutral-500">Copy the endpoint URL for your application &mdash; it's only shown once.</p>
            <div class="mt-2 pt-2 border-t border-neutral-800">
              <p class="text-neutral-600 mb-1">Generated URL format:</p>
              <code class="text-neutral-400">https://your-server/api/ingest?token=<span class="text-bugreel-400">{token}</span></code>
            </div>
          </div>
        </div>

        <!-- Step 4 -->
        <div class="relative pl-10 pb-12 border-l border-neutral-800 ml-4">
          <div class="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-neutral-900 border border-neutral-700 flex items-center justify-center text-xs font-bold text-white">4</div>
          <h3 class="text-white font-semibold mb-4">Start recording</h3>

          <!-- Option A: SDK -->
          <div class="mb-6">
            <h4 class="text-sm text-neutral-300 font-medium mb-2 flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-bugreel-950/60 border border-bugreel-800/30 text-bugreel-400 text-[10px] font-bold uppercase">Option A</span>
              Embed SDK (one script tag)
            </h4>
            <p class="text-sm text-neutral-400 mb-3">Add this to any page with the endpoint URL from step 3. A floating "Record Bug" button will appear &mdash; recordings are uploaded automatically.</p>
            <div class="relative group">
              <pre class="rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-xs overflow-x-auto"><code class="text-neutral-300"><span class="text-neutral-600">&lt;</span><span class="text-bugreel-400">script</span>
  <span class="text-neutral-400">src</span><span class="text-neutral-600">=</span><span class="text-green-400">"<span class="text-green-300">https://your-bugreel-server</span>/sdk/recorder.js"</span>
  <span class="text-neutral-400">data-endpoint</span><span class="text-neutral-600">=</span><span class="text-green-400">"<span class="text-green-300">YOUR_ENDPOINT_URL</span>"</span>
<span class="text-neutral-600">&gt;&lt;/</span><span class="text-bugreel-400">script</span><span class="text-neutral-600">&gt;</span></code></pre>
              <button
                class="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                @click="copyToClipboard(`<script\n  src=&quot;${window.location.origin}/sdk/recorder.js&quot;\n  data-endpoint=&quot;YOUR_ENDPOINT_URL&quot;\n><\/script>`, 'sdk')"
              >
                <UIcon :name="copied === 'sdk' ? 'i-lucide-check' : 'i-lucide-copy'" class="text-sm" />
              </button>
            </div>
          </div>

          <!-- Option B: Extension -->
          <div>
            <h4 class="text-sm text-neutral-300 font-medium mb-2 flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-bugreel-950/60 border border-bugreel-800/30 text-bugreel-400 text-[10px] font-bold uppercase">Option B</span>
              Browser Extension
            </h4>
            <p class="text-sm text-neutral-400 mb-3">For full-featured recording with multi-page navigation support (Chrome &amp; Firefox). Paste the endpoint URL from step 3 into the extension:</p>
            <div class="rounded-lg bg-neutral-900 border border-neutral-800 p-4 text-xs space-y-2">
              <p class="text-neutral-500">Open the extension popup → paste your <strong class="text-neutral-300">endpoint URL</strong></p>
              <div class="mt-2 pt-2 border-t border-neutral-800">
                <code class="text-neutral-400 text-[11px]">https://your-server/api/ingest?token=<span class="text-bugreel-400">{token}</span></code>
              </div>
              <p class="text-neutral-600">The URL contains the server address and token &mdash; no other configuration needed.</p>
            </div>
          </div>
        </div>

        <!-- Step 5 -->
        <div class="relative pl-10 ml-4">
          <div class="absolute -left-3.5 top-0 w-7 h-7 rounded-full bg-bugreel-500 flex items-center justify-center text-xs font-bold text-white">5</div>
          <h3 class="text-white font-semibold mb-2">View &amp; share recordings</h3>
          <p class="text-sm text-neutral-400">Recordings appear in your application's reel feed. Click any reel to open the interactive viewer with synchronized DOM replay, console, network, and interaction panels. Share the link with your team &mdash; add timestamped comments for context.</p>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-neutral-800/60 py-8 px-6">
      <div class="max-w-5xl mx-auto flex items-center justify-between">
        <span class="text-xs text-neutral-600">bugreel &mdash; self-hosted bug recording</span>
        <div class="flex items-center gap-4">
          <UButton href="https://github.com/AnthonySendra/bugreel" target="_blank" variant="link" color="neutral" size="xs" icon="i-lucide-github" label="GitHub" />
          <template v-if="!isStatic">
            <template v-if="isLoggedIn">
              <UButton to="/dashboard" variant="link" color="neutral" size="xs" label="Dashboard" />
            </template>
            <template v-else>
              <UButton to="/login" variant="link" color="neutral" size="xs" label="Sign in" />
              <UButton to="/register" variant="link" color="neutral" size="xs" label="Register" />
            </template>
          </template>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ── Player preview ─────────────────────────────────────────────────────── */
.preview-player {
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #2e2e33;
  background: #111113;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03);
}

.preview-meta {
  height: 34px;
  background: #1c1c1f;
  border-bottom: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
}

.preview-url-bar {
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

.preview-meta-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.preview-meta-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  color: #6b6b76;
  font-size: 10px;
  font-weight: 500;
}

.preview-main {
  display: flex;
  height: 340px;
}
@media (min-width: 640px) {
  .preview-main { height: 380px; }
}

.preview-player-area {
  flex: 1;
  background: #0a0a0b;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 16px;
}

.preview-fake-site {
  width: 100%;
  max-width: 420px;
  background: #18181b;
  border-radius: 8px;
  border: 1px solid #27272a;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.preview-site-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #27272a;
  background: #1c1c1f;
}

.preview-site-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: #1c1c1f;
  border: 1px solid #27272a;
  border-radius: 6px;
}

.preview-site-card--error {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.04);
}

.preview-side {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid #2e2e33;
  background: #1c1c1f;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
@media (max-width: 639px) {
  .preview-side { display: none; }
}
@media (min-width: 640px) and (max-width: 1023px) {
  .preview-side { width: 220px; }
}

.preview-tabs {
  display: flex;
  border-bottom: 1px solid #2e2e33;
  flex-shrink: 0;
}

.preview-tab {
  flex: 1;
  padding: 8px 4px;
  text-align: center;
  font-size: 10px;
  font-weight: 500;
  color: #6b6b76;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 0.15s;
}

.preview-tab:hover {
  color: #e2e2e6;
}

.preview-tab--active {
  color: #e2e2e6;
  border-bottom-color: #4c8dff;
}

.preview-tab-count {
  background: #242428;
  color: #6b6b76;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 8px;
  min-width: 14px;
  text-align: center;
}

.preview-tab-count--active {
  background: rgba(76, 141, 255, 0.15);
  color: #4c8dff;
}

.preview-panel {
  flex: 1;
  overflow: hidden;
  padding: 2px 0;
}

.preview-console-entry {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 10px;
  border-bottom: 1px solid #1a1a1e;
}

.preview-console-entry--warn {
  background: rgba(234, 179, 8, 0.04);
  border-left: 2px solid rgba(234, 179, 8, 0.3);
}

.preview-console-entry--error {
  background: rgba(239, 68, 68, 0.04);
  border-left: 2px solid rgba(239, 68, 68, 0.3);
}

.preview-net-header {
  display: flex;
  gap: 6px;
  padding: 5px 10px;
  border-bottom: 1px solid #2e2e33;
}

.preview-net-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-bottom: 1px solid #1a1a1e;
}

.preview-net-row--error {
  background: rgba(239, 68, 68, 0.04);
}

.preview-net-row--clickable {
  cursor: pointer;
  transition: background 0.15s;
}

.preview-net-row--clickable:hover {
  background: rgba(239, 68, 68, 0.1);
}

.preview-net-detail-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid #2e2e33;
  background: rgba(239, 68, 68, 0.04);
}

.preview-net-back {
  background: none;
  border: none;
  color: #6b6b76;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.preview-net-back:hover {
  color: #e2e2e6;
}

.preview-net-detail-body {
  padding: 6px 10px;
  overflow-y: auto;
  flex: 1;
}

.preview-net-detail-section {
  margin-bottom: 10px;
}

.preview-net-detail-section > span:first-child {
  display: block;
  margin-bottom: 4px;
}

.preview-net-detail-kv {
  display: flex;
  gap: 8px;
  font-size: 9px;
  padding: 2px 0;
  border-bottom: 1px solid #1a1a1e;
}

.preview-net-detail-kv span:first-child {
  flex-shrink: 0;
  min-width: 70px;
}

.preview-net-detail-json {
  font-size: 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #111113;
  border: 1px solid #2e2e33;
  border-radius: 4px;
  padding: 8px;
  margin: 4px 0 0;
  overflow-x: auto;
  line-height: 1.5;
  white-space: pre;
}

.preview-panel--comments {
  padding: 6px;
}

.preview-comment {
  padding: 8px;
  border-radius: 6px;
  border: 1px solid #2e2e33;
  background: #18181b;
  margin-bottom: 6px;
}

/* Card highlight when "clicked" */
.preview-site-card--highlight {
  border-color: rgba(96, 165, 250, 0.4);
  background: rgba(96, 165, 250, 0.06);
}

/* Error toast */
.preview-error-toast {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 6px;
}

/* Toast transition */
.preview-toast-enter-active {
  transition: all 0.3s ease-out;
}
.preview-toast-leave-active {
  transition: all 0.2s ease-in;
}
.preview-toast-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.preview-toast-leave-to {
  opacity: 0;
}

/* Console entry transition */
.preview-entry-enter-active {
  transition: all 0.25s ease-out;
}
.preview-entry-enter-from {
  opacity: 0;
  transform: translateX(-6px);
}

.preview-controls {
  height: 40px;
  background: #1c1c1f;
  border-top: 1px solid #2e2e33;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}

.preview-play-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #4c8dff;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.preview-play-btn:hover {
  background: #3a7de8;
}

.preview-play-btn:active {
  transform: scale(0.93);
}

.preview-timeline {
  flex: 1;
  position: relative;
  height: 4px;
  background: #2e2e33;
  border-radius: 2px;
  cursor: pointer;
}

.preview-progress {
  height: 100%;
  background: #4c8dff;
  border-radius: 2px;
  transition: width 0.05s linear;
}

.preview-bubble {
  position: absolute;
  top: -3px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4c8dff;
  border: 2px solid #1c1c1f;
  transform: translateX(-50%);
}
</style>
