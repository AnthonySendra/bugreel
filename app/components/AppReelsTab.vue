<script setup lang="ts">
import type { Reel, ReelsResponse } from '~/types/app'

const props = defineProps<{
  appId: string
  workspaceId: string
  headers: Record<string, string>
  token: string | null
  sdkScriptUrl: string
}>()

const emit = defineEmits<{
  (e: 'switch-tab', tab: string): void
}>()

const headersRef = computed(() => props.headers)

const allReels = ref<Reel[]>([])
const hasMore = ref(false)
const nextBefore = ref<number | null>(null)
const loadingMore = ref(false)
const totalReelCount = ref(0)

// ── Date range filter state ──────────────────────────────────────────────────
const filterFrom = ref('')
const filterTo = ref('')
const filterStatus = ref<'open' | 'all'>('open')

/** Convert YYYY-MM-DD string to epoch ms (start of day, local time) */
function dateToEpoch(dateStr: string, endOfDay = false): number | undefined {
  if (!dateStr) return undefined
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return undefined
  if (endOfDay) {
    d.setHours(23, 59, 59, 999)
  }
  return d.getTime()
}

const fetchParams = computed(() => {
  const p: Record<string, string | number> = {}
  const from = dateToEpoch(filterFrom.value)
  const to = dateToEpoch(filterTo.value, true)
  if (from !== undefined) p.from = from
  if (to !== undefined) p.to = to
  p.status = filterStatus.value
  return p
})

const { data: reelsData, refresh: refreshReelsData } = await useFetch<ReelsResponse>(`/api/apps/${props.appId}/reels`, {
  headers: headersRef,
  params: fetchParams,
})

if (reelsData.value) {
  allReels.value = reelsData.value.items
  hasMore.value = reelsData.value.hasMore
  nextBefore.value = reelsData.value.nextBefore
  totalReelCount.value = reelsData.value.totalCount ?? 0
}

watch(reelsData, (val) => {
  if (val) {
    allReels.value = val.items
    hasMore.value = val.hasMore
    nextBefore.value = val.nextBefore
    totalReelCount.value = val.totalCount ?? 0
  }
})

// Re-fetch from scratch when date filters change (reset pagination)
watch(fetchParams, async () => {
  nextBefore.value = null
  await refreshReelsData()
  if (reelsData.value) {
    allReels.value = reelsData.value.items
    hasMore.value = reelsData.value.hasMore
    nextBefore.value = reelsData.value.nextBefore
    totalReelCount.value = reelsData.value.totalCount ?? 0
  }
})

async function refreshReels() {
  await refreshReelsData()
}

async function loadMore() {
  if (!hasMore.value || !nextBefore.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const data = await $fetch<ReelsResponse>(`/api/apps/${props.appId}/reels`, {
      headers: props.headers,
      params: { before: nextBefore.value, ...fetchParams.value },
    })
    allReels.value = [...allReels.value, ...data.items]
    hasMore.value = data.hasMore
    nextBefore.value = data.nextBefore
  } finally {
    loadingMore.value = false
  }
}

const reels = allReels

const sortedReels = computed(() =>
  [...(reels.value || [])].sort((a, b) => b.created_at - a.created_at)
)

// ── Tags helper ──────────────────────────────────────────────────────────────
function parseTags(reel: Reel): string[] {
  if (!reel.tags) return []
  if (Array.isArray(reel.tags)) return reel.tags
  try { return JSON.parse(reel.tags as any) } catch { return [] }
}

// ── Filters ──────────────────────────────────────────────────────────────────
const filterCreator = ref('all')
const filterAssignee = ref('all')
const filterTag = ref('all')

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

const assignees = computed(() => {
  const emails = new Set<string>()
  for (const reel of sortedReels.value) {
    if (reel.assigned_user_email) emails.add(reel.assigned_user_email)
  }
  return [...emails].sort()
})

const assigneeOptions = computed(() => [
  { label: 'All assignees', value: 'all' },
  ...assignees.value.map(e => ({ label: e, value: e })),
])

const showAssigneeFilter = computed(() => assignees.value.length > 0)

const allTags = computed(() => {
  const tags = new Set<string>()
  for (const reel of sortedReels.value) {
    for (const tag of parseTags(reel)) {
      tags.add(tag)
    }
  }
  return [...tags].sort()
})

const tagOptions = computed(() => [
  { label: 'All tags', value: 'all' },
  ...allTags.value.map(t => ({ label: t, value: t })),
])

const showTagFilter = computed(() => allTags.value.length > 0)

const filteredReels = computed(() => {
  let list = sortedReels.value

  if (filterCreator.value !== 'all') {
    list = list.filter(r => r.uploaded_by_email === filterCreator.value)
  }

  if (filterAssignee.value !== 'all') {
    list = list.filter(r => r.assigned_user_email === filterAssignee.value)
  }

  if (filterTag.value !== 'all') {
    list = list.filter(r => parseTags(r).includes(filterTag.value))
  }

  return list
})

const hasActiveFilters = computed(() =>
  filterFrom.value !== '' ||
  filterTo.value !== '' ||
  filterCreator.value !== 'all' ||
  filterAssignee.value !== 'all' ||
  filterTag.value !== 'all' ||
  filterStatus.value !== 'open'
)

function clearFilters() {
  filterFrom.value = ''
  filterTo.value = ''
  filterCreator.value = 'all'
  filterAssignee.value = 'all'
  filterTag.value = 'all'
  filterStatus.value = 'open'
}

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

// ── Delete all done reels ─────────────────────────────────────────────────────
const deleteAllDoneModalOpen = ref(false)
const deleteAllDoneLoading = ref(false)

const doneReelCount = computed(() => filteredReels.value.filter(r => r.status === 'done').length)

async function deleteAllDoneReels() {
  deleteAllDoneLoading.value = true
  try {
    await $fetch(`/api/apps/${props.appId}/reels-done`, {
      method: 'DELETE',
      headers: props.headers,
    })
    deleteAllDoneModalOpen.value = false
    await refreshReels()
  } finally {
    deleteAllDoneLoading.value = false
  }
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
    await $fetch(`/api/apps/${props.appId}/reels`, {
      method: 'POST',
      body: formData,
      headers: props.headers,
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
  <div class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto space-y-6">

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

    <!-- Filter bar -->
    <div v-if="totalReelCount > 0" class="filter-bar">
      <div class="filter-left">
        <div class="filter-status-toggle">
          <button
            class="filter-status-btn"
            :class="{ 'filter-status-btn-active': filterStatus === 'open' }"
            @click="filterStatus = 'open'"
          >Open</button>
          <button
            class="filter-status-btn"
            :class="{ 'filter-status-btn-active': filterStatus === 'all' }"
            @click="filterStatus = 'all'"
          >All</button>
        </div>
        <div class="filter-divider" />
        <div class="filter-date-range">
          <label class="filter-date-label">From</label>
          <input
            v-model="filterFrom"
            type="date"
            class="filter-date-input"
            :max="filterTo || undefined"
          />
          <label class="filter-date-label">To</label>
          <input
            v-model="filterTo"
            type="date"
            class="filter-date-input"
            :min="filterFrom || undefined"
          />
        </div>
      </div>

      <div class="filter-right">
        <UButton
          v-if="filterStatus === 'all' && doneReelCount > 0"
          label="Delete all done"
          icon="i-lucide-trash-2"
          variant="soft"
          color="error"
          size="xs"
          @click="deleteAllDoneModalOpen = true"
        />
        <div v-if="filterStatus === 'all' && doneReelCount > 0" class="filter-divider" />
        <USelectMenu
          v-if="showCreatorFilter"
          v-model="filterCreator"
          :items="creatorOptions"
          value-key="value"
          class="filter-creator"
          size="xs"
        />
        <div v-if="showCreatorFilter" class="filter-divider" />
        <USelectMenu
          v-if="showAssigneeFilter"
          v-model="filterAssignee"
          :items="assigneeOptions"
          value-key="value"
          class="filter-creator"
          size="xs"
        />
        <div v-if="showAssigneeFilter" class="filter-divider" />
        <USelectMenu
          v-if="showTagFilter"
          v-model="filterTag"
          :items="tagOptions"
          value-key="value"
          class="filter-creator"
          size="xs"
        />
        <div v-if="showTagFilter" class="filter-divider" />
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
    <div v-if="totalReelCount === 0" class="empty-state">
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
            <p>Go to the <button class="text-bugreel-400 hover:text-bugreel-300 underline underline-offset-2 font-medium transition-colors" @click="emit('switch-tab', 'tokens')">API Tokens</button> tab and create a token — copy the <strong>endpoint URL</strong></p>
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
      <UButton label="Clear filters" icon="i-lucide-x" variant="link" color="neutral" class="mt-2" @click="clearFilters" />
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
            <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="reel-thumb">
              <ReelThumbnail :reelId="reel.id" :token="token" />
              <div class="reel-play-overlay">
                <div class="reel-play-btn">
                  <UIcon v-if="reel.is_screenshot" name="i-lucide-camera" class="w-5 h-5 text-white" />
                  <UIcon v-else name="i-lucide-play" class="w-5 h-5 text-white ml-0.5" />
                </div>
              </div>
              <div v-if="reel.status === 'done'" class="reel-done-badge">
                <UIcon name="i-lucide-circle-check" class="w-3 h-3" />
                Done
              </div>
              <div v-if="reel.share_token" class="reel-share-badge">
                <UIcon name="i-lucide-share-2" class="w-3 h-3" />
              </div>
            </NuxtLink>

            <div class="reel-info">
              <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="flex-1 min-w-0">
                <p class="text-sm font-medium text-(--ui-text-highlighted) group-hover:text-white transition-colors truncate">
                  {{ reel.original_name || reel.filename }}
                </p>
                <div v-if="parseTags(reel).length" class="reel-tags">
                  <span v-for="tag in parseTags(reel)" :key="tag" class="reel-tag">{{ tag }}</span>
                </div>
                <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
                  {{ formatSize(reel.size) }} · {{ timeAgo(reel.created_at) }}
                  <template v-if="reel.reporter_name || reel.uploaded_by_email"> · {{ reel.reporter_name || reel.uploaded_by_email }}</template>
                </p>
              </NuxtLink>
              <div
                v-if="reel.assigned_user_email"
                class="reel-assignee"
                :title="reel.assigned_user_email"
              >
                {{ reel.assigned_user_email[0].toUpperCase() }}
              </div>
              <div class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <ReelActionMenu
                  :reel-id="reel.id"
                  :reel-name="reel.original_name || reel.filename"
                  :status="reel.status"
                  :assigned-user-id="reel.assigned_user_id"
                  :tags="parseTags(reel)"
                  :workspace-id="props.workspaceId"
                  :headers="props.headers"
                  @updated="refreshReels()"
                  @deleted="refreshReels()"
                />
              </div>
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

    <!-- Delete all done reels modal -->
    <UModal v-model:open="deleteAllDoneModalOpen" title="Delete all done reels">
      <template #body>
        <p class="text-sm text-(--ui-text-muted)">
          Delete all done reels? This will permanently remove {{ doneReelCount }} recording{{ doneReelCount !== 1 ? 's' : '' }}. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteAllDoneModalOpen = false" />
          <UButton label="Delete" color="error" :loading="deleteAllDoneLoading" @click="deleteAllDoneReels" />
        </div>
      </template>
    </UModal>

  </div>
</template>

<style scoped>
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
  min-width: 0;
}
.filter-date-range {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.filter-date-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--ui-text-dimmed);
  white-space: nowrap;
}
.filter-date-input {
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  outline: none;
  transition: border-color 0.12s;
  width: 8.5rem;
}
.filter-date-input:focus {
  border-color: #ff4070;
}
.filter-date-input::-webkit-calendar-picker-indicator {
  filter: invert(0.6);
  cursor: pointer;
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
/* ── Status filter toggle ── */
.filter-status-toggle {
  display: flex;
  border-radius: 0.375rem;
  overflow: hidden;
  border: 1px solid var(--ui-border);
}
.filter-status-btn {
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0.25rem 0.625rem;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg);
  transition: all 0.12s;
  cursor: pointer;
  border: none;
  outline: none;
}
.filter-status-btn:hover {
  color: var(--ui-text-muted);
}
.filter-status-btn-active {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-accented);
  font-weight: 600;
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
.reel-done-badge {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  color: #22c55e;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  padding: 0.2rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(34, 197, 94, 0.25);
  z-index: 1;
}
.reel-share-badge {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  font-size: 0.625rem;
  color: #60a5fa;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  border-radius: 0.375rem;
  border: 1px solid rgba(96, 165, 250, 0.25);
  z-index: 1;
}
.reel-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--ui-border);
}
.reel-assignee {
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  background: rgba(255, 64, 112, 0.15);
  border: 1px solid rgba(255, 64, 112, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  font-weight: 700;
  color: #ff4070;
  flex-shrink: 0;
}

/* ── Tags ── */
.reel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.25rem;
}
.reel-tag {
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ui-text-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
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
</style>
