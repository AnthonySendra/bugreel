<script setup lang="ts">
interface Workspace { id: string; name: string }
interface App { id: string; name: string; created_at: number }

const route = useRoute()
const { token, user, logout } = useAuth()
const headers = computed(() => token.value ? { Authorization: `Bearer ${token.value}` } : {})

const userMenuItems = computed(() => [[
  { label: user.value?.email || '', disabled: true },
], [
  { label: 'Log out', icon: 'i-lucide-log-out', onSelect: () => { logout(); navigateTo('/') } },
]])

const workspaceId = computed(() => route.params.id as string)
const appId = computed(() => route.params.appId as string | undefined)

const { data: workspaces } = await useFetch<Workspace[]>('/api/workspaces', { headers })
const { data: apps } = await useFetch<App[]>(
  () => `/api/workspaces/${workspaceId.value}/apps`,
  { headers, watch: [workspaceId] }
)

const workspace = computed(() => workspaces.value?.find(w => w.id === workspaceId.value))
const app = computed(() => apps.value?.find(a => a.id === appId.value))

// ── Workspace dropdown ──────────────────────────────────────────────────────
const workspaceItems = computed(() => [
  (workspaces.value || []).map(ws => ({
    label: ws.name,
    icon: ws.id === workspaceId.value ? 'i-lucide-check' : undefined,
    onSelect: () => navigateTo(`/workspace/${ws.id}`),
  })),
  [{ label: 'New workspace', icon: 'i-lucide-plus', onSelect: () => navigateTo('/dashboard?new=1') }],
])

// ── App dropdown ────────────────────────────────────────────────────────────
const newAppModalOpen = ref(false)

const appItems = computed(() => [
  (apps.value || []).map(a => ({
    label: a.name,
    icon: a.id === appId.value ? 'i-lucide-check' : undefined,
    onSelect: () => navigateTo(`/workspace/${workspaceId.value}/app/${a.id}`),
  })),
  [{ label: 'New app', icon: 'i-lucide-plus', onSelect: () => { newAppModalOpen.value = true } }],
])

// ── New app modal ───────────────────────────────────────────────────────────
const newAppName = ref('')
const newAppLoading = ref(false)
const newAppError = ref('')

async function createApp() {
  if (!newAppName.value.trim()) return
  newAppLoading.value = true
  newAppError.value = ''
  try {
    const data = await $fetch<{ id: string }>(
      `/api/workspaces/${workspaceId.value}/apps`,
      { method: 'POST', body: { name: newAppName.value }, headers: headers.value }
    )
    newAppModalOpen.value = false
    newAppName.value = ''
    await navigateTo(`/workspace/${workspaceId.value}/app/${data.id}`)
  } catch (e: any) {
    newAppError.value = e?.data?.message || 'Failed to create app'
  } finally {
    newAppLoading.value = false
  }
}

function closeNewAppModal() {
  newAppModalOpen.value = false
  newAppName.value = ''
  newAppError.value = ''
}
</script>

<template>
  <div class="min-h-screen flex flex-col bg-(--ui-bg)">

    <!-- ── Top nav ──────────────────────────────────────────────────────────── -->
    <header class="h-14 border-b border-(--ui-border) px-5 flex items-center gap-1 shrink-0">

      <!-- Logo / Home link -->
      <NuxtLink to="/dashboard" class="flex items-center shrink-0 mr-3 group" title="Home">
        <div class="w-3.5 h-3.5 rounded-full bg-bugreel-500 group-hover:bg-bugreel-400 transition-colors" />
      </NuxtLink>

      <!-- Workspace selector -->
      <UDropdownMenu :items="workspaceItems">
        <button class="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-(--ui-bg-elevated) transition-colors group cursor-pointer">
          <div class="w-6 h-6 rounded-md bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-sm">
            <span class="text-white text-xs font-bold leading-none select-none">
              {{ workspace?.name?.[0]?.toUpperCase() || 'W' }}
            </span>
          </div>
          <span class="text-sm font-medium text-(--ui-text-highlighted)">{{ workspace?.name || '…' }}</span>
          <UIcon name="i-lucide-chevrons-up-down" class="w-3.5 h-3.5 text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted) transition-colors" />
        </button>
      </UDropdownMenu>

      <!-- App level breadcrumb -->
      <template v-if="appId">
        <span class="text-(--ui-text-dimmed) text-sm px-0.5 select-none">/</span>
        <UDropdownMenu :items="appItems">
          <button class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-(--ui-bg-elevated) transition-colors group cursor-pointer">
            <span class="text-sm font-medium text-(--ui-text-highlighted)">{{ app?.name || '…' }}</span>
            <UIcon name="i-lucide-chevrons-up-down" class="w-3.5 h-3.5 text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted) transition-colors" />
          </button>
        </UDropdownMenu>
      </template>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- User menu -->
      <UDropdownMenu :items="userMenuItems">
        <button class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-sm cursor-pointer hover:opacity-90 transition-opacity">
          <span class="text-white text-xs font-bold leading-none select-none">
            {{ user?.email?.[0]?.toUpperCase() || '?' }}
          </span>
        </button>
      </UDropdownMenu>
    </header>

    <!-- ── Page content (tabs + body injected by each page) ─────────────────── -->
    <div class="flex-1">
      <slot />
    </div>

    <!-- ── Footer ────────────────────────────────────────────────────────────── -->
    <footer class="border-t border-(--ui-border) py-4 px-5 flex items-center justify-between shrink-0">
      <span class="text-xs text-(--ui-text-dimmed)">bugreel — self-hosted bug recording</span>
      <UButton href="https://github.com/AnthonySendra/bugreel" target="_blank" variant="link" color="neutral" size="xs" icon="i-lucide-github" label="GitHub" />
    </footer>

    <!-- ── New app modal ────────────────────────────────────────────────────── -->
    <UModal v-model:open="newAppModalOpen" title="Create app" @close="closeNewAppModal">
      <template #body>
        <div class="space-y-4">
          <UFormField label="App name">
            <UInput v-model="newAppName" placeholder="My App" autofocus class="w-full" @keyup.enter="createApp" />
          </UFormField>
          <UAlert v-if="newAppError" color="error" variant="soft" :description="newAppError" />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="closeNewAppModal" />
          <UButton label="Create" :loading="newAppLoading" :disabled="!newAppName.trim()" @click="createApp" />
        </div>
      </template>
    </UModal>
  </div>
</template>
