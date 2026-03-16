<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'workspace' })

const route = useRoute()
const { token } = useAuth()
const appId = route.params.appId as string

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

interface Reel { id: string; filename: string; original_name: string | null; size: number | null; created_at: number; uploaded_by_email: string | null; reporter_name: string | null }
interface ReelsResponse { items: Reel[]; hasMore: boolean; nextBefore: number | null }

const allReels = ref<Reel[]>([])
const hasMore = ref(false)
const nextBefore = ref<number | null>(null)
const loadingMore = ref(false)

const { data: reelsData, refresh: refreshReelsData } = await useFetch<ReelsResponse>(`/api/apps/${appId}/reels`, { headers })

// Sync initial data
if (reelsData.value) {
  allReels.value = reelsData.value.items
  hasMore.value = reelsData.value.hasMore
  nextBefore.value = reelsData.value.nextBefore
}

// Watch for refresh changes
watch(reelsData, (val) => {
  if (val) {
    allReels.value = val.items
    hasMore.value = val.hasMore
    nextBefore.value = val.nextBefore
  }
})

async function refreshReels() {
  await refreshReelsData()
}

async function loadMore() {
  if (!hasMore.value || !nextBefore.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const data = await $fetch<ReelsResponse>(`/api/apps/${appId}/reels`, {
      headers: headers.value,
      params: { before: nextBefore.value },
    })
    allReels.value = [...allReels.value, ...data.items]
    hasMore.value = data.hasMore
    nextBefore.value = data.nextBefore
  } finally {
    loadingMore.value = false
  }
}

// Expose as reels ref for compatibility with the rest of the template
const reels = allReels

const sdkScriptUrl = import.meta.client ? `${window.location.origin}/sdk/recorder.js` : '/sdk/recorder.js'
const origin = import.meta.client ? window.location.origin : ''

// ── API Tokens ────────────────────────────────────────────────────────────────
const {
  apiTokens, tokenModalOpen, newTokenName, newTokenLoading, newTokenError,
  createdToken, copiedToken, copiedEndpoint, copiedSnippet, endpointUrl,
  sdkSnippetText, copyTokenValue, copyEndpoint, copySnippetText, createToken,
  closeTokenModal, deleteTokenModalOpen, tokenToDelete, deleteTokenLoading,
  confirmDeleteToken, deleteToken, formatDate,
} = useAppTokens(appId, headers)

// ── Tabs ─────────────────────────────────────────────────────────────────────
const validTabs = ['reels', 'tokens', 'settings'] as const
type AppTab = typeof validTabs[number]
const initialTab = validTabs.includes(route.hash.slice(1) as any) ? route.hash.slice(1) as AppTab : 'reels'
const activeTab = ref<AppTab>(initialTab)

watch(activeTab, (tab) => {
  const hash = tab === 'reels' ? '' : `#${tab}`
  navigateTo({ hash }, { replace: true })
})

// ── Rename app ───────────────────────────────────────────────────────────────
const { data: appData } = await useFetch<{ id: string; name: string }>(`/api/workspaces/${route.params.id}/apps`, {
  headers,
  transform: (apps: any[]) => apps.find((a: any) => a.id === appId),
})
const editAppName = ref(appData.value?.name || '')
const editAppLoading = ref(false)
const editAppSaved = ref(false)

async function renameApp() {
  if (!editAppName.value.trim() || editAppLoading.value) return
  editAppLoading.value = true
  editAppSaved.value = false
  try {
    await $fetch(`/api/workspaces/${route.params.id}/apps/${appId}`, {
      method: 'PATCH',
      headers: headers.value,
      body: { name: editAppName.value.trim() },
    })
    editAppSaved.value = true
    setTimeout(() => { editAppSaved.value = false }, 2000)
  } finally {
    editAppLoading.value = false
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}d ago`
  if (h > 0) return `${h}h ago`
  if (m > 0) return `${m}m ago`
  return 'just now'
}

// Sorted by creation date, newest first
const sortedReels = computed(() =>
  [...(reels.value || [])].sort((a, b) => b.created_at - a.created_at)
)

// ── Filters ──────────────────────────────────────────────────────────────────
const filterDate = ref('all')
const filterCreator = ref('all')

const datePills = [
  { label: 'All', value: 'all' },
  { label: 'Today', value: 'today' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: '3 months', value: '3months' },
]

const creators = computed(() => {
  const emails = new Set<string>()
  for (const reel of sortedReels.value) {
    if (reel.uploaded_by_email) emails.add(reel.uploaded_by_email)
  }
  return [...emails].sort()
})

const creatorOptions = computed(() => [
  { label: 'All creators', value: 'all' },
  ...creators.value.map(e => ({ label: e, value: e })),
])

const showCreatorFilter = computed(() => creators.value.length > 0)

// filteredReels applies date + creator filters on top of sortedReels.
// NOTE: If you are grouping reels (e.g. reelGroups), read from filteredReels instead of sortedReels.
const filteredReels = computed(() => {
  let list = sortedReels.value

  // Date filter
  if (filterDate.value !== 'all') {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let cutoff: number
    switch (filterDate.value) {
      case 'today':
        cutoff = today.getTime()
        break
      case 'week': {
        const d = new Date(today)
        d.setDate(d.getDate() - d.getDay())
        cutoff = d.getTime()
        break
      }
      case 'month':
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
        break
      case '3months':
        cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime()
        break
      default:
        cutoff = 0
    }
    list = list.filter(r => r.created_at >= cutoff)
  }

  // Creator filter
  if (filterCreator.value !== 'all') {
    list = list.filter(r => r.uploaded_by_email === filterCreator.value)
  }

  return list
})

const hasActiveFilters = computed(() => filterDate.value !== 'all' || filterCreator.value !== 'all')

function clearFilters() {
  filterDate.value = 'all'
  filterCreator.value = 'all'
}

// Group reels by time period — reads from filteredReels so filters are respected
const reelGroups = computed(() => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const startOfYear = new Date(now.getFullYear(), 0, 1)

  const buckets: Record<string, Reel[]> = {
    Today: [],
    Yesterday: [],
    'This week': [],
    'This month': [],
    'Last month': [],
    'This year': [],
    Older: [],
  }

  for (const reel of filteredReels.value) {
    const d = new Date(reel.created_at)
    if (d >= today) buckets.Today.push(reel)
    else if (d >= yesterday) buckets.Yesterday.push(reel)
    else if (d >= startOfWeek) buckets['This week'].push(reel)
    else if (d >= startOfMonth) buckets['This month'].push(reel)
    else if (d >= startOfLastMonth) buckets['Last month'].push(reel)
    else if (d >= startOfYear) buckets['This year'].push(reel)
    else buckets.Older.push(reel)
  }

  const order = ['Today', 'Yesterday', 'This week', 'This month', 'Last month', 'This year', 'Older']
  return order
    .filter(label => buckets[label].length > 0)
    .map(label => ({ label, reels: buckets[label] }))
})

// ── Delete reel ───────────────────────────────────────────────────────────────
const deleteModalOpen = ref(false)
const reelToDelete = ref<Reel | null>(null)
const deleteLoading = ref(false)

function confirmDelete(reel: Reel, e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  reelToDelete.value = reel
  deleteModalOpen.value = true
}

async function deleteReel() {
  if (!reelToDelete.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/reels/${reelToDelete.value.id}`, {
      method: 'DELETE',
      headers: headers.value,
    })
    deleteModalOpen.value = false
    reelToDelete.value = null
    await refreshReels()
  } finally {
    deleteLoading.value = false
  }
}

// ── Delete app ────────────────────────────────────────────────────────────────
const deleteAppModalOpen = ref(false)
const deleteAppLoading = ref(false)
const deleteAppConfirm = ref('')

async function deleteApp() {
  deleteAppLoading.value = true
  try {
    await $fetch(`/api/workspaces/${route.params.id}/apps/${appId}`, {
      method: 'DELETE',
      headers: headers.value,
    })
    await navigateTo(`/workspace/${route.params.id}`)
  } finally {
    deleteAppLoading.value = false
  }
}

function closeDeleteAppModal() {
  deleteAppModalOpen.value = false
  deleteAppConfirm.value = ''
}

// ── File upload ───────────────────────────────────────────────────────────────
const isDragging = ref(false)
const uploadError = ref('')
const uploading = ref(false)

async function uploadFile(file: File) {
  if (!file.name.endsWith('.reel')) {
    uploadError.value = 'Only .reel files are accepted'
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    const formData = new FormData()
    formData.append('file', file, file.name)
    await $fetch(`/api/apps/${appId}/reels`, {
      method: 'POST',
      body: formData,
      headers: headers.value,
    })
    await refreshReels()
  } catch (e: any) {
    uploadError.value = e?.data?.message || 'Upload failed'
  } finally {
    uploading.value = false
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) uploadFile(file)
}

function onFileInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) uploadFile(file)
}
</script>

<template>
  <div class="flex flex-col flex-1 reels-page">

    <!-- Tab bar -->
    <nav class="tab-bar">
      <button class="tab-btn" :class="{ 'tab-active': activeTab === 'reels' }" @click="activeTab = 'reels'">
        <UIcon name="i-lucide-film" class="w-4 h-4" />
        Reels
      </button>
      <button class="tab-btn" :class="{ 'tab-active': activeTab === 'tokens' }" @click="activeTab = 'tokens'">
        <UIcon name="i-lucide-key-round" class="w-4 h-4" />
        API Tokens
      </button>
      <button class="tab-btn" :class="{ 'tab-active': activeTab === 'settings' }" @click="activeTab = 'settings'">
        <UIcon name="i-lucide-settings" class="w-4 h-4" />
        Settings
      </button>
    </nav>

    <!-- Reels content -->
    <div v-if="activeTab === 'reels'" class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto space-y-6">

      <!-- Drop zone -->
      <div
        class="drop-zone"
        :class="{ 'drop-active': isDragging }"
        @dragover.prevent="isDragging = true"
        @dragleave.self="isDragging = false"
        @drop.prevent="onDrop"
        @click="($refs.fileInput as HTMLInputElement).click()"
      >
        <input ref="fileInput" type="file" accept=".reel" class="hidden" @change="onFileInput" />
        <div v-if="uploading" class="flex items-center justify-center gap-2 text-(--ui-text-muted) text-sm">
          <UIcon name="i-lucide-loader-circle" class="w-4 h-4 animate-spin" />
          Uploading…
        </div>
        <div v-else class="flex items-center justify-center gap-3">
          <div class="drop-icon">
            <UIcon name="i-lucide-upload" class="w-4 h-4" />
          </div>
          <div>
            <p class="text-sm text-(--ui-text-muted)">
              Drop a <code class="text-(--ui-text) font-mono text-xs">.reel</code> file here
              or <span class="text-bugreel-400 hover:text-bugreel-300 transition-colors">browse</span>
            </p>
          </div>
        </div>
        <UAlert v-if="uploadError" color="error" variant="soft" :description="uploadError" class="mt-4 text-left" />
      </div>

      <!-- Filter bar (only show when there are reels) -->
      <div v-if="sortedReels.length > 0" class="filter-bar">
        <div class="filter-left">
          <!-- Date pills -->
          <div class="filter-pills">
            <button
              v-for="pill in datePills"
              :key="pill.value"
              class="filter-pill"
              :class="{ 'filter-pill--active': filterDate === pill.value }"
              @click="filterDate = pill.value"
            >
              {{ pill.label }}
            </button>
          </div>

          <!-- Creator dropdown (only if multiple creators) -->
          <div v-if="showCreatorFilter" class="filter-divider" />
          <USelectMenu
            v-if="showCreatorFilter"
            v-model="filterCreator"
            :items="creatorOptions"
            value-key="value"
            class="filter-creator"
            size="xs"
          />
        </div>

        <div class="filter-right">
          <span class="filter-count">{{ filteredReels.length }}<span class="filter-count-label"> reel{{ filteredReels.length !== 1 ? 's' : '' }}</span></span>
          <button
            v-if="hasActiveFilters"
            class="filter-clear"
            title="Clear all filters"
            @click="clearFilters"
          >
            <UIcon name="i-lucide-x" class="w-3 h-3" />
          </button>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="sortedReels.length === 0" class="empty-state">
        <div class="empty-icon-wrap">
          <UIcon name="i-lucide-film" class="w-8 h-8" />
        </div>
        <p class="empty-title">No recordings yet</p>
        <p class="empty-desc">
          Push a <code class="font-mono text-(--ui-text) text-xs">.reel</code> from the extension, the SDK, or upload one above.
        </p>

        <!-- Mini how-to -->
        <div class="how-to">
          <p class="how-to-label">How to record your first reel</p>
          <div class="how-to-steps" style="margin-bottom: 1.25rem;">
            <div class="how-to-step">
              <div class="how-to-num">0</div>
              <p>Go to the <button class="text-bugreel-400 hover:text-bugreel-300 underline underline-offset-2 font-medium transition-colors" @click="activeTab = 'tokens'">API Tokens</button> tab and create a token — copy the <strong>endpoint URL</strong></p>
            </div>
          </div>
          <p class="how-to-subtitle">Option A — Browser extension</p>
          <div class="how-to-steps">
            <div class="how-to-step">
              <div class="how-to-num">1</div>
              <p>Install the extension from <code class="font-mono text-xs">recorder/dist/chrome</code> or <code class="font-mono text-xs">recorder/dist/firefox</code></p>
            </div>
            <div class="how-to-step">
              <div class="how-to-num">2</div>
              <p>Open the extension popup and paste your endpoint URL</p>
            </div>
            <div class="how-to-step">
              <div class="how-to-num">3</div>
              <p>Navigate to your app, click <strong>Record</strong>, reproduce the bug, then <strong>Stop</strong></p>
            </div>
            <div class="how-to-step">
              <div class="how-to-num">4</div>
              <p>The reel appears here automatically</p>
            </div>
          </div>
          <p class="how-to-subtitle how-to-subtitle-alt">Option B — SDK script tag</p>
          <div class="how-to-steps">
            <div class="how-to-step how-to-step-block">
              <div class="how-to-num">1</div>
              <div>
                <p>Add this to your HTML:</p>
                <code class="snippet-block">&lt;script src="{{ sdkScriptUrl }}" data-endpoint="ENDPOINT_URL"&gt;&lt;/script&gt;</code>
              </div>
            </div>
            <div class="how-to-step">
              <div class="how-to-num">2</div>
              <p>A <strong>Report Bug</strong> button appears — users click it, record, and the reel is sent here</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filtered-empty state -->
      <div v-else-if="filteredReels.length === 0" class="filtered-empty">
        <UIcon name="i-lucide-search-x" class="w-6 h-6 text-(--ui-text-dimmed)" />
        <p class="text-sm text-(--ui-text-muted) mt-2">No reels match the current filters.</p>
        <button class="filter-clear mt-2" @click="clearFilters">
          <UIcon name="i-lucide-x" class="w-3 h-3" />
          Clear filters
        </button>
      </div>

      <!-- Reels grid (grouped by time period) -->
      <div v-else class="reel-groups">
        <section v-for="group in reelGroups" :key="group.label" class="reel-group">
          <h3 class="reel-group-header">{{ group.label }}</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div
              v-for="reel in group.reels"
              :key="reel.id"
              class="reel-card group"
            >
              <!-- Thumbnail -->
              <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="reel-thumb">
                <ReelThumbnail :reel-id="reel.id" :token="token" />
                <div class="reel-play-overlay">
                  <div class="reel-play-btn">
                    <UIcon name="i-lucide-play" class="w-5 h-5 text-white ml-0.5" />
                  </div>
                </div>
              </NuxtLink>

              <!-- Info row -->
              <div class="reel-info">
                <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-(--ui-text-highlighted) group-hover:text-white transition-colors truncate">
                    {{ reel.original_name || reel.filename }}
                  </p>
                  <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
                    {{ formatSize(reel.size) }} · {{ timeAgo(reel.created_at) }}
                    <template v-if="reel.reporter_name || reel.uploaded_by_email"> · {{ reel.reporter_name || reel.uploaded_by_email }}</template>
                  </p>
                </NuxtLink>
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click="confirmDelete(reel, $event)"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Load more button -->
        <div v-if="hasMore" class="load-more-wrap">
          <button
            class="load-more-btn"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <UIcon v-if="loadingMore" name="i-lucide-loader-circle" class="w-4 h-4 animate-spin" />
            <UIcon v-else name="i-lucide-chevrons-down" class="w-4 h-4" />
            {{ loadingMore ? 'Loading...' : 'Load more reels' }}
          </button>
        </div>
      </div>
    </div>

    <!-- API Tokens content -->
    <div v-if="activeTab === 'tokens'" class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <h1 class="section-title">API Tokens</h1>
          <p class="text-sm text-(--ui-text-muted) mt-1">
            Tokens connect the browser extension or SDK to this app.
          </p>
        </div>
        <UButton label="Create token" icon="i-lucide-plus" size="sm" @click="tokenModalOpen = true" />
      </div>

      <div v-if="!apiTokens?.length" class="empty-state-sm">
        <UIcon name="i-lucide-key-round" class="w-5 h-5 text-(--ui-text-dimmed)" />
        <p>No API tokens yet</p>
      </div>

      <div v-else class="token-list">
        <div
          v-for="t in apiTokens"
          :key="t.id"
          class="token-row group"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-(--ui-text)">{{ t.name }}</p>
            <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
              Created {{ formatDate(t.created_at) }}
              <template v-if="t.created_by_email"> by {{ t.created_by_email }}</template>
            </p>
          </div>
          <UButton
            icon="i-lucide-trash-2"
            size="xs"
            color="error"
            variant="ghost"
            class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            @click="confirmDeleteToken(t)"
          />
        </div>
      </div>
    </div>

    <!-- Settings content -->
    <div v-if="activeTab === 'settings'" class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto space-y-10">

      <!-- App info -->
      <div>
        <h2 class="section-title">General</h2>
        <div class="settings-card space-y-4">
          <div>
            <label class="settings-label">App ID</label>
            <code class="settings-code">{{ appId }}</code>
          </div>
          <div>
            <label class="settings-label">App name</label>
            <div class="flex items-center gap-2">
              <UInput v-model="editAppName" placeholder="App name" class="flex-1" @keyup.enter="renameApp" />
              <UButton
                :label="editAppSaved ? 'Saved' : 'Save'"
                :icon="editAppSaved ? 'i-lucide-check' : undefined"
                size="sm"
                :loading="editAppLoading"
                :disabled="!editAppName.trim() || editAppName.trim() === appData?.name"
                @click="renameApp"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Danger zone -->
      <div>
        <h2 class="text-sm font-semibold text-red-400 mb-4">Danger zone</h2>
        <div class="danger-zone">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-(--ui-text)">Delete this application</p>
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5">All reels and data in this app will be permanently deleted.</p>
            </div>
            <UButton label="Delete app" color="error" variant="soft" size="sm" icon="i-lucide-trash-2" @click="deleteAppModalOpen = true" />
          </div>
        </div>
      </div>
    </div>

    <!-- Delete app modal -->
    <UModal v-model:open="deleteAppModalOpen" title="Delete application" @close="closeDeleteAppModal">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-(--ui-text-muted)">
            This will permanently delete this application and <strong class="text-(--ui-text)">all its reels</strong>. This action cannot be undone.
          </p>
          <UFormField label="Type DELETE to confirm">
            <UInput v-model="deleteAppConfirm" placeholder="DELETE" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="closeDeleteAppModal" />
          <UButton label="Delete forever" color="error" :loading="deleteAppLoading" :disabled="deleteAppConfirm !== 'DELETE'" @click="deleteApp" />
        </div>
      </template>
    </UModal>

    <!-- Delete confirmation modal -->
    <UModal v-model:open="deleteModalOpen" title="Delete recording">
      <template #body>
        <p class="text-sm text-(--ui-text-muted)">
          Are you sure you want to delete
          <span class="font-medium text-(--ui-text)">{{ reelToDelete?.original_name || reelToDelete?.filename }}</span>?
          This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteModalOpen = false" />
          <UButton label="Delete" color="error" :loading="deleteLoading" @click="deleteReel" />
        </div>
      </template>
    </UModal>

    <!-- Create token modal -->
    <UModal v-model:open="tokenModalOpen" title="Create API token" @close="closeTokenModal">
      <template #body>
        <div class="space-y-4">
          <div v-if="!createdToken" class="space-y-4">
            <UFormField label="Token name" hint="e.g. Chrome extension, CI">
              <UInput v-model="newTokenName" placeholder="My extension" autofocus class="w-full" @keyup.enter="createToken" />
            </UFormField>
            <UAlert v-if="newTokenError" color="error" variant="soft" :description="newTokenError" />
          </div>
          <div v-else class="space-y-4">
            <UAlert color="warning" variant="soft" title="Save this token now" description="It won't be shown again after you close this dialog." />

            <!-- Raw token -->
            <div>
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2">Token</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-3 py-2 rounded-lg break-all text-(--ui-text)">{{ createdToken }}</code>
                <UButton :icon="copiedToken ? 'i-lucide-check' : 'i-lucide-copy'" size="xs" variant="outline" class="shrink-0" @click="copyTokenValue(createdToken!)" />
              </div>
            </div>

            <!-- Endpoint URL -->
            <div>
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2 flex items-center gap-1.5">
                Endpoint URL
                <UTooltip text="Paste this URL in the browser extension popup to connect it to this app.">
                  <UIcon name="i-lucide-circle-help" class="w-3.5 h-3.5 text-(--ui-text-dimmed) cursor-help" />
                </UTooltip>
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-2 py-1.5 rounded-md text-(--ui-text-muted) truncate">{{ endpointUrl }}</code>
                <UButton
                  :icon="copiedEndpoint ? 'i-lucide-check' : 'i-lucide-copy'"
                  size="xs"
                  variant="outline"
                  class="shrink-0"
                  @click="copyEndpoint"
                />
              </div>
            </div>

            <!-- SDK snippet -->
            <div>
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2 flex items-center gap-1.5">
                SDK script tag
                <UTooltip text="Add this script tag to your website HTML to embed a Record Bug button — no extension needed.">
                  <UIcon name="i-lucide-circle-help" class="w-3.5 h-3.5 text-(--ui-text-dimmed) cursor-help" />
                </UTooltip>
              </p>
              <div class="flex items-center gap-2">
                <pre class="flex-1 text-[11px] font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-2 py-1.5 rounded-md text-(--ui-text-muted) whitespace-pre-wrap break-all leading-relaxed min-w-0">{{ sdkSnippetText }}</pre>
                <UButton
                  :icon="copiedSnippet ? 'i-lucide-check' : 'i-lucide-copy'"
                  size="xs"
                  variant="outline"
                  class="shrink-0"
                  @click="copySnippetText"
                />
              </div>
            </div>

            <!-- Ad-blocker warning -->
            <div class="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
              <UIcon name="i-lucide-shield-alert" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p class="text-xs text-(--ui-text-muted) leading-relaxed">
                <span class="font-medium text-amber-400">Ad blockers</span> can prevent the extension and SDK from connecting. Disable your ad blocker on the target site if recording doesn't work.
              </p>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Close" color="neutral" variant="outline" @click="closeTokenModal" />
          <UButton v-if="!createdToken" label="Create" :loading="newTokenLoading" :disabled="!newTokenName.trim()" @click="createToken" />
        </div>
      </template>
    </UModal>

    <!-- Delete token confirmation modal -->
    <UModal v-model:open="deleteTokenModalOpen" title="Delete API token">
      <template #body>
        <p class="text-sm text-(--ui-text-muted)">
          Are you sure you want to delete the token
          <span class="font-medium text-(--ui-text)">{{ tokenToDelete?.name }}</span>?
          Any extension or SDK using it will stop working.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteTokenModalOpen = false" />
          <UButton label="Delete" color="error" :loading="deleteTokenLoading" @click="deleteToken" />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* ── Tab bar ── */
.tab-bar {
  border-bottom: 1px solid var(--ui-border);
  padding: 0 1.5rem;
  display: flex;
  gap: 0;
}
.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 0.25rem;
  margin-right: 1.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
  color: var(--ui-text-muted);
}
.tab-active {
  border-bottom-color: #ff4070;
  color: white;
}

/* ── Drop zone ── */
.drop-zone {
  border: 2px dashed var(--ui-border);
  border-radius: 0.75rem;
  padding: 1.25rem 1.5rem;
  transition: all 0.2s;
  cursor: pointer;
}
.drop-zone:hover {
  border-color: var(--ui-border-accented);
  background: rgba(255, 255, 255, 0.01);
}
.drop-active {
  border-color: #ff4070;
  background: rgba(255, 64, 112, 0.04);
}
.drop-icon {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background: rgba(255, 64, 112, 0.1);
  border: 1px solid rgba(255, 64, 112, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ff4070;
  flex-shrink: 0;
}

/* ── Filter bar ── */
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
}
.filter-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}
.filter-pills {
  display: flex;
  gap: 2px;
  background: var(--ui-bg);
  border-radius: 0.375rem;
  padding: 2px;
}
.filter-pill {
  padding: 0.25rem 0.625rem;
  border-radius: 0.3rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ui-text-dimmed);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.filter-pill:hover {
  color: var(--ui-text-muted);
}
.filter-pill--active {
  background: rgba(255, 64, 112, 0.12);
  color: #ff4070;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.filter-divider {
  width: 1px;
  height: 1.25rem;
  background: var(--ui-border);
  flex-shrink: 0;
}
.filter-creator {
  min-width: 8.5rem;
  flex-shrink: 0;
}
.filter-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}
.filter-count {
  font-size: 0.6875rem;
  font-weight: 700;
  color: var(--ui-text-muted);
  font-variant-numeric: tabular-nums;
}
.filter-count-label {
  font-weight: 500;
  color: var(--ui-text-dimmed);
}
.filter-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 0.25rem;
  color: var(--ui-text-dimmed);
  transition: all 0.12s;
}
.filter-clear:hover {
  color: #ff4070;
  background: rgba(255, 64, 112, 0.1);
}
.filtered-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 2rem;
  border: 1px dashed var(--ui-border);
  border-radius: 1rem;
  text-align: center;
}

/* ── Reel cards ── */
.reel-card {
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg-elevated);
  overflow: hidden;
  transition: all 0.2s;
}
.reel-card:hover {
  border-color: var(--ui-border-accented);
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
}
.reel-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  position: relative;
  overflow: hidden;
  background: var(--ui-bg-accented);
}
.reel-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.2s;
}
.reel-card:hover .reel-play-overlay {
  opacity: 1;
}
.reel-play-btn {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: rgba(255, 64, 112, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.reel-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--ui-border);
}

/* ── Reel groups ── */
.reel-groups {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}
.reel-group-header {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ui-text-dimmed);
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--ui-border);
  margin-bottom: 1rem;
}

/* ── Load more ── */
.load-more-wrap {
  display: flex;
  justify-content: center;
  padding-top: 0.5rem;
}
.load-more-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  cursor: pointer;
  transition: all 0.15s;
}
.load-more-btn:hover:not(:disabled) {
  border-color: var(--ui-border-accented);
  color: white;
  background: var(--ui-bg-accented);
}
.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Empty state ── */
.empty-state {
  text-align: center;
  padding: 3rem 2rem;
  border: 1px dashed var(--ui-border);
  border-radius: 1rem;
}
.empty-icon-wrap {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: rgba(255, 64, 112, 0.08);
  border: 1px solid rgba(255, 64, 112, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1rem;
  color: var(--ui-text-dimmed);
}
.empty-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: white;
}
.empty-desc {
  font-size: 0.8125rem;
  color: var(--ui-text-muted);
  margin-top: 0.25rem;
}

/* ── How to mini-guide ── */
.how-to {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--ui-border);
  text-align: left;
  max-width: 28rem;
  margin-left: auto;
  margin-right: auto;
}
.how-to-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #ff4070;
  margin-bottom: 1rem;
}
.how-to-subtitle {
  font-size: 0.75rem;
  font-weight: 600;
  color: white;
  margin-bottom: 0.75rem;
}
.how-to-subtitle-alt {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--ui-border);
}
.how-to-steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.how-to-step {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}
.how-to-num {
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  border: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--ui-text-muted);
  flex-shrink: 0;
  margin-top: 0.1rem;
}
.how-to-step-block {
  align-items: flex-start;
}
.snippet-block {
  display: block;
  margin-top: 0.5rem;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 0.6875rem;
  line-height: 1.6;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  border-radius: 0.375rem;
  padding: 0.5rem 0.625rem;
  word-break: break-all;
  white-space: pre-wrap;
}
.how-to-step p {
  font-size: 0.8125rem;
  color: var(--ui-text-muted);
  line-height: 1.5;
}
.how-to-step strong {
  color: white;
  font-weight: 600;
}

/* ── Settings ── */
.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ui-text-highlighted);
  margin-bottom: 1rem;
}
.settings-card {
  padding: 1.25rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated);
}
.settings-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ui-text-muted);
  margin-bottom: 0.375rem;
}
.settings-code {
  display: inline-block;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 0.75rem;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  user-select: all;
}

/* ── Token list ── */
.token-list {
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  overflow: hidden;
}
.token-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  transition: background 0.15s;
}
.token-row:not(:last-child) {
  border-bottom: 1px solid var(--ui-border);
}
.token-row:hover {
  background: rgba(255, 255, 255, 0.02);
}
.empty-state-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem;
  font-size: 0.875rem;
  color: var(--ui-text-muted);
  border: 1px dashed var(--ui-border);
  border-radius: 0.75rem;
}

/* ── Danger zone ── */
.danger-zone {
  padding: 1rem 1.25rem;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 0.5rem;
  background: rgba(239, 68, 68, 0.04);
}
</style>
