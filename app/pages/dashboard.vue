<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { token, logout } = useAuth()
const router = useRouter()

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

interface Workspace {
  id: string
  name: string
  created_at: number
}

const { data: workspaces, refresh } = await useFetch<Workspace[]>('/api/workspaces', {
  headers,
})

const isModalOpen = ref(false)
const newWorkspaceName = ref('')
const creating = ref(false)
const createError = ref('')

async function createWorkspace() {
  if (!newWorkspaceName.value.trim()) return
  creating.value = true
  createError.value = ''
  try {
    await $fetch('/api/workspaces', {
      method: 'POST',
      headers: headers.value,
      body: { name: newWorkspaceName.value.trim() },
    })
    newWorkspaceName.value = ''
    isModalOpen.value = false
    await refresh()
  } catch (e: any) {
    createError.value = e?.data?.message || e?.message || 'Failed to create workspace'
  } finally {
    creating.value = false
  }
}

function handleLogout() {
  logout()
  router.push('/')
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString()
}
</script>

<template>
  <div class="min-h-screen p-6">
    <div class="max-w-5xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-white">
          Workspaces
        </h1>
        <div class="flex gap-3">
          <UButton
            label="New workspace"
            @click="isModalOpen = true"
          />
          <UButton
            label="Logout"
            variant="outline"
            color="neutral"
            @click="handleLogout"
          />
        </div>
      </div>

      <!-- Workspace grid -->
      <div
        v-if="workspaces && workspaces.length > 0"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <UCard
          v-for="ws in workspaces"
          :key="ws.id"
          class="cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
          @click="router.push(`/workspace/${ws.id}`)"
        >
          <div class="space-y-1">
            <p class="font-semibold text-white">
              {{ ws.name }}
            </p>
            <p class="text-sm text-neutral-400">
              Created {{ formatDate(ws.created_at) }}
            </p>
          </div>
        </UCard>
      </div>

      <div v-else class="text-center py-16 text-neutral-400">
        <p class="text-lg">
          No workspaces yet.
        </p>
        <p class="text-sm mt-1">
          Create one to get started.
        </p>
      </div>
    </div>

    <!-- New workspace modal -->
    <UModal v-model:open="isModalOpen" title="New workspace">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Workspace name" name="name">
            <UInput
              v-model="newWorkspaceName"
              placeholder="My project"
              class="w-full"
              @keyup.enter="createWorkspace"
            />
          </UFormField>

          <UAlert
            v-if="createError"
            color="error"
            variant="soft"
            :description="createError"
          />

          <div class="flex justify-end gap-3">
            <UButton
              label="Cancel"
              variant="outline"
              color="neutral"
              @click="isModalOpen = false"
            />
            <UButton
              label="Create"
              :loading="creating"
              @click="createWorkspace"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
