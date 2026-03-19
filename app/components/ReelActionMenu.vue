<script setup lang="ts">
interface Props {
  reelId: string
  reelName?: string | null
  status?: string | null
  assignedUserId?: string | null
  tags?: string[] | null
  workspaceId?: string
  headers?: Record<string, string>
  size?: 'xs' | 'sm'
}

const props = withDefaults(defineProps<Props>(), {
  reelName: null,
  status: 'open',
  assignedUserId: null,
  tags: null,
  workspaceId: undefined,
  headers: () => ({}),
  size: 'xs',
})

const emit = defineEmits<{
  updated: []
  deleted: []
}>()

// ── Rename ──────────────────────────────────────────────────────────────────
const renameModalOpen = ref(false)
const renameValue = ref('')
const renameLoading = ref(false)

function openRename() {
  renameValue.value = props.reelName || ''
  renameModalOpen.value = true
}

async function renameReel() {
  if (!renameValue.value.trim() || renameLoading.value) return
  renameLoading.value = true
  try {
    await $fetch(`/api/reels/${props.reelId}`, {
      method: 'PATCH',
      headers: props.headers,
      body: { name: renameValue.value.trim() },
    })
    renameModalOpen.value = false
    emit('updated')
  } catch (err) {
    console.error('[bugreel] Rename failed', err)
  } finally {
    renameLoading.value = false
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────
const deleteModalOpen = ref(false)
const deleteLoading = ref(false)

async function deleteReel() {
  if (deleteLoading.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/reels/${props.reelId}`, {
      method: 'DELETE',
      headers: props.headers,
    })
    deleteModalOpen.value = false
    emit('deleted')
  } catch (err) {
    console.error('[bugreel] Delete failed', err)
  } finally {
    deleteLoading.value = false
  }
}

// ── Mark as done ────────────────────────────────────────────────────────────
const markingDone = ref(false)
const isDone = computed(() => props.status === 'done')

async function markAsDone() {
  if (markingDone.value || isDone.value) return
  markingDone.value = true
  try {
    await $fetch(`/api/reels/${props.reelId}/done`, {
      method: 'POST',
      headers: props.headers,
    })
    emit('updated')
  } catch (err) {
    console.error('[bugreel] Mark as done failed', err)
  } finally {
    markingDone.value = false
  }
}

// ── Share ────────────────────────────────────────────────────────────────────
const shareFeedback = ref(false)

async function shareReel() {
  try {
    const data = await $fetch<{ shareToken: string }>(`/api/reels/${props.reelId}/share`, {
      method: 'POST',
      headers: props.headers,
    })
    const shareUrl = `${window.location.origin}/share/${data.shareToken}`
    await navigator.clipboard.writeText(shareUrl)
    shareFeedback.value = true
    setTimeout(() => { shareFeedback.value = false }, 2000)
    emit('updated')
  } catch (e: any) {
    console.error('Failed to share reel:', e)
  }
}

// ── Assign ──────────────────────────────────────────────────────────────────
const assignModalOpen = ref(false)
const assignLoading = ref(false)
const assignSelectedUserId = ref<string | null>(null)
const workspaceMembers = ref<{ id: string; email: string }[]>([])
const membersLoading = ref(false)

function openAssign() {
  assignSelectedUserId.value = props.assignedUserId || null
  assignModalOpen.value = true
  fetchMembers()
}

async function fetchMembers() {
  if (workspaceMembers.value.length > 0 || !props.workspaceId) return
  membersLoading.value = true
  try {
    const data = await $fetch<{ id: string; email: string }[]>(`/api/workspaces/${props.workspaceId}/members`, {
      headers: props.headers,
    })
    workspaceMembers.value = data
  } catch (e: any) {
    console.error('Failed to fetch members:', e)
  } finally {
    membersLoading.value = false
  }
}

const assigneeSelectOptions = computed(() => [
  { label: 'Unassigned', value: '__unassigned__' },
  ...workspaceMembers.value.map(m => ({ label: m.email, value: m.id })),
])

const assignSelectModel = computed({
  get: () => assignSelectedUserId.value || '__unassigned__',
  set: (val: string) => { assignSelectedUserId.value = val === '__unassigned__' ? null : val },
})

async function saveAssignment() {
  assignLoading.value = true
  try {
    await $fetch(`/api/reels/${props.reelId}`, {
      method: 'PATCH',
      headers: props.headers,
      body: { assignedTo: assignSelectedUserId.value },
    })
    assignModalOpen.value = false
    emit('updated')
  } catch (err) {
    console.error('[bugreel] Assign failed', err)
  } finally {
    assignLoading.value = false
  }
}

// ── Tags ────────────────────────────────────────────────────────────────────
const tagsModalOpen = ref(false)
const editTags = ref<string[]>([])
const tagInput = ref('')
const tagsLoading = ref(false)

function openTags() {
  editTags.value = [...(props.tags || [])]
  tagInput.value = ''
  tagsModalOpen.value = true
}

function addTag() {
  const tag = tagInput.value.trim().slice(0, 30)
  if (!tag || editTags.value.includes(tag) || editTags.value.length >= 10) return
  editTags.value.push(tag)
  tagInput.value = ''
}

function removeTag(tag: string) {
  editTags.value = editTags.value.filter(t => t !== tag)
}

async function saveTags() {
  tagsLoading.value = true
  try {
    await $fetch(`/api/reels/${props.reelId}`, {
      method: 'PATCH',
      headers: props.headers,
      body: { tags: editTags.value },
    })
    tagsModalOpen.value = false
    emit('updated')
  } catch (err) {
    console.error('[bugreel] Tags save failed', err)
  } finally {
    tagsLoading.value = false
  }
}

// ── Menu items ──────────────────────────────────────────────────────────────
const menuItems = computed(() => {
  const shareLabel = shareFeedback.value ? 'Link copied!' : 'Share link'
  return [[
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openRename() },
    { label: 'Assign', icon: 'i-lucide-user-plus', onSelect: () => openAssign() },
    { label: 'Tags', icon: 'i-lucide-tags', onSelect: () => openTags() },
    { label: shareLabel, icon: 'i-lucide-share-2', onSelect: () => shareReel() },
    {
      label: isDone.value ? 'Done' : markingDone.value ? 'Marking\u2026' : 'Mark as done',
      icon: 'i-lucide-circle-check',
      disabled: isDone.value || markingDone.value,
      onSelect: () => markAsDone(),
    },
  ], [
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { deleteModalOpen.value = true } },
  ]]
})
</script>

<template>
  <UDropdownMenu :items="menuItems">
    <UButton icon="i-lucide-ellipsis-vertical" :size="size" color="neutral" variant="ghost" @click.prevent.stop />
  </UDropdownMenu>

  <!-- Rename modal -->
  <UModal v-model:open="renameModalOpen" title="Rename recording">
    <template #body>
      <UInput v-model="renameValue" placeholder="Recording name" autofocus @keydown.enter="renameReel" />
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="outline" @click="renameModalOpen = false" />
        <UButton label="Rename" :loading="renameLoading" :disabled="!renameValue.trim()" @click="renameReel" />
      </div>
    </template>
  </UModal>

  <!-- Delete modal -->
  <UModal v-model:open="deleteModalOpen" title="Delete recording">
    <template #body>
      <p class="text-sm text-(--ui-text-muted)">
        Are you sure you want to delete
        <span class="font-medium text-(--ui-text)">{{ reelName || 'this recording' }}</span>?
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

  <!-- Assign modal -->
  <UModal v-model:open="assignModalOpen" title="Assign recording">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-(--ui-text-muted)">
          Assign <span class="font-medium text-(--ui-text)">{{ reelName || 'this recording' }}</span> to a team member.
        </p>
        <div v-if="membersLoading" class="flex items-center gap-2 text-(--ui-text-dimmed) text-sm">
          <UIcon name="i-lucide-loader-circle" class="w-4 h-4 animate-spin" />
          Loading members...
        </div>
        <USelectMenu
          v-else
          v-model="assignSelectModel"
          :items="assigneeSelectOptions"
          value-key="value"
          class="w-full"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="outline" @click="assignModalOpen = false" />
        <UButton label="Save" :loading="assignLoading" @click="saveAssignment" />
      </div>
    </template>
  </UModal>

  <!-- Tags modal -->
  <UModal v-model:open="tagsModalOpen" title="Edit tags">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-(--ui-text-muted)">
          Tags for <span class="font-medium text-(--ui-text)">{{ reelName || 'this recording' }}</span>
        </p>
        <div v-if="editTags.length" class="tags-edit">
          <span v-for="tag in editTags" :key="tag" class="tag-editable">
            {{ tag }}
            <button class="tag-remove" @click="removeTag(tag)">
              <UIcon name="i-lucide-x" class="w-2.5 h-2.5" />
            </button>
          </span>
        </div>
        <div v-if="editTags.length < 10" class="flex gap-2">
          <UInput
            v-model="tagInput"
            placeholder="Add a tag..."
            class="flex-1"
            :maxlength="30"
            @keyup.enter="addTag"
          />
          <UButton label="Add" size="sm" :disabled="!tagInput.trim()" @click="addTag" />
        </div>
        <p v-if="editTags.length >= 10" class="text-xs text-(--ui-text-dimmed)">Maximum 10 tags reached.</p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton label="Cancel" color="neutral" variant="outline" @click="tagsModalOpen = false" />
        <UButton label="Save" :loading="tagsLoading" @click="saveTags" />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.tags-edit {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.tag-editable {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ui-text-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.tag-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ui-text-dimmed);
  transition: color 0.12s;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.tag-remove:hover {
  color: #ff4070;
}
</style>
