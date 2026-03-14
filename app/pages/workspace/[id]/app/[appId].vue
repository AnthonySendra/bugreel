<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'workspace' })

const route = useRoute()
const { token } = useAuth()
const appId = route.params.appId as string

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

interface Reel { id: string; filename: string; original_name: string | null; size: number | null; created_at: number; uploaded_by_email: string | null }

const { data: reels, refresh: refreshReels } = await useFetch<Reel[]>(`/api/apps/${appId}/reels`, { headers })

// ── Tabs ──────────────────────────────────────────────────────────────────────
const activeTab = ref('reels')
const tabs = [{ key: 'reels', label: 'Reels' }]

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
  <div class="flex flex-col flex-1">

    <!-- Tab bar -->
    <nav class="border-b border-(--ui-border) px-6 flex gap-0">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="py-4 px-1 mr-6 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === tab.key
          ? 'border-white text-white'
          : 'border-transparent text-(--ui-text-muted) hover:text-(--ui-text)'"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- Content -->
    <div class="flex-1 px-10 py-10 w-full max-w-6xl mx-auto space-y-6">

      <!-- Drop zone -->
      <div
        class="rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all cursor-pointer"
        :class="isDragging
          ? 'border-primary-500 bg-primary-500/5'
          : 'border-(--ui-border) hover:border-(--ui-border-accented) bg-(--ui-bg-elevated)/40'"
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
        <div v-else class="space-y-1">
          <p class="text-sm text-(--ui-text-muted)">
            Drop a <code class="text-(--ui-text) font-mono">.reel</code> file here
            or <span class="text-primary-400 hover:text-primary-300">click to browse</span>
          </p>
        </div>
        <UAlert v-if="uploadError" color="error" variant="soft" :description="uploadError" class="mt-4 text-left" />
      </div>

      <!-- Empty state -->
      <div v-if="sortedReels.length === 0" class="text-center py-16 text-(--ui-text-muted) text-sm">
        No recordings yet. Push a <code class="font-mono text-(--ui-text)">.reel</code> from the extension or upload one above.
      </div>

      <!-- Reels grid -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="reel in sortedReels"
          :key="reel.id"
          class="rounded-xl border border-(--ui-border) bg-(--ui-bg-elevated) hover:border-(--ui-border-accented) flex flex-col overflow-hidden transition-all group relative"
        >
          <!-- Thumbnail (clickable → opens viewer) -->
          <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="aspect-video w-full block">
            <ReelThumbnail :reel-id="reel.id" :token="token" />
          </NuxtLink>

          <!-- Info row -->
          <div class="px-4 py-3 flex items-center gap-2 border-t border-(--ui-border)">
            <NuxtLink :to="`/reel/${reel.id}`" target="_blank" class="flex-1 min-w-0">
              <p class="text-sm font-medium text-(--ui-text-highlighted) group-hover:text-white transition-colors truncate">
                {{ reel.original_name || reel.filename }}
              </p>
              <p class="text-xs text-(--ui-text-dimmed)">
                {{ formatSize(reel.size) }} · {{ timeAgo(reel.created_at) }}
                <template v-if="reel.uploaded_by_email"> · {{ reel.uploaded_by_email }}</template>
              </p>
            </NuxtLink>
            <!-- Delete button -->
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              @click="confirmDelete(reel, $event)"
            />
          </div>
        </div>
      </div>

    </div>
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

  </div>
</template>
