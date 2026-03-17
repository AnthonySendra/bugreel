<script setup lang="ts">
const { token } = useAuth()
const isLoggedIn = computed(() => !!token.value)

const copied = ref<string | null>(null)

function copyToClipboard(text: string, id: string) {
  navigator.clipboard.writeText(text)
  copied.value = id
  setTimeout(() => { copied.value = null }, 2000)
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
          <template v-if="isLoggedIn">
            <UButton to="/dashboard" size="sm" label="Dashboard" />
          </template>
          <template v-else>
            <UButton to="/login" variant="ghost" color="neutral" size="sm" label="Sign in" />
            <UButton to="/register" size="sm" label="Get started" />
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
          <UButton v-if="isLoggedIn" to="/dashboard" size="lg" label="Dashboard" />
          <UButton v-else to="/register" size="lg" label="Create an account" />
          <UButton href="#setup" size="lg" variant="outline" color="neutral" label="Setup guide" />
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
            <p class="text-xs text-neutral-500 leading-relaxed">Pixel-perfect interactive replay using rrweb. Not a video &mdash; you can inspect elements, scroll, and resize.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-terminal" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">Console Logs</h3>
            <p class="text-xs text-neutral-500 leading-relaxed">Every log, warning, error and uncaught exception with precise timestamps synced to the replay timeline.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-globe" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">Network Requests</h3>
            <p class="text-xs text-neutral-500 leading-relaxed">URL, method, status, headers, duration and response bodies. See exactly what the API returned when the bug happened.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-3">
            <div class="w-9 h-9 rounded-lg bg-bugreel-950/80 border border-bugreel-800/30 flex items-center justify-center">
              <UIcon name="i-lucide-mouse-pointer-click" class="text-bugreel-400 text-lg" />
            </div>
            <h3 class="text-white font-medium text-sm">User Interactions</h3>
            <p class="text-xs text-neutral-500 leading-relaxed">Clicks, inputs, and navigations logged in order. Jump to any interaction on the timeline to see what the user did.</p>
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
            <p class="text-xs text-neutral-500 leading-relaxed">Add comments at any point in the timeline. Threaded replies with email notifications to keep the team in sync.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-flask-conical" class="text-neutral-500" />
              Playwright Export
            </h3>
            <p class="text-xs text-neutral-500 leading-relaxed">Generate a ready-to-run <code class="text-bugreel-400">.spec.ts</code> file from any recording. Reproduce bugs in CI automatically.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-search" class="text-neutral-500" />
              DOM Inspector
            </h3>
            <p class="text-xs text-neutral-500 leading-relaxed">Hover over any element in the replay to inspect attributes and computed styles, like DevTools frozen in time.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-puzzle" class="text-neutral-500" />
              Browser Extension
            </h3>
            <p class="text-xs text-neutral-500 leading-relaxed">Chrome and Firefox extensions for full-featured recording including multi-page navigations.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-code" class="text-neutral-500" />
              Embed SDK
            </h3>
            <p class="text-xs text-neutral-500 leading-relaxed">One script tag to add a "Record Bug" button to any site. No installation required for your users.</p>
          </div>
          <div class="rounded-xl bg-neutral-900/50 border border-neutral-800/50 p-5 space-y-2">
            <h3 class="text-white font-medium text-sm flex items-center gap-2">
              <UIcon name="i-lucide-database" class="text-neutral-500" />
              Your Infrastructure
            </h3>
            <p class="text-xs text-neutral-500 leading-relaxed">SQLite + local disk or any S3-compatible storage. No external dependencies, runs anywhere with Docker.</p>
          </div>
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
          <UButton to="/register" size="sm" variant="soft" label="Create account →" />
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
          <template v-if="isLoggedIn">
            <UButton to="/dashboard" variant="link" color="neutral" size="xs" label="Dashboard" />
          </template>
          <template v-else>
            <UButton to="/login" variant="link" color="neutral" size="xs" label="Sign in" />
            <UButton to="/register" variant="link" color="neutral" size="xs" label="Register" />
          </template>
        </div>
      </div>
    </footer>
  </div>
</template>
