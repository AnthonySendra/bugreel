<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'workspace' })

const route = useRoute()
const { token } = useAuth()
const appId = route.params.appId as string

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

const sdkScriptUrl = import.meta.client ? `${window.location.origin}/sdk/recorder.js` : '/sdk/recorder.js'

// ── Tabs ─────────────────────────────────────────────────────────────────────
const validTabs = ['reels', 'tokens', 'integrations', 'settings'] as const
type AppTab = typeof validTabs[number]
const initialTab = validTabs.includes(route.hash.slice(1) as any) ? (route.hash.slice(1) as AppTab) : 'reels'
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
      <button class="tab-btn" :class="{ 'tab-active': activeTab === 'integrations' }" @click="activeTab = 'integrations'">
        <UIcon name="i-lucide-plug" class="w-4 h-4" />
        Integrations
      </button>
      <button class="tab-btn" :class="{ 'tab-active': activeTab === 'settings' }" @click="activeTab = 'settings'">
        <UIcon name="i-lucide-settings" class="w-4 h-4" />
        Settings
      </button>
    </nav>

    <!-- Reels content -->
    <AppReelsTab
      v-if="activeTab === 'reels'"
      :appId="appId"
      :workspaceId="(route.params.id as string)"
      :headers="headers"
      :token="token"
      :sdkScriptUrl="sdkScriptUrl"
      @switch-tab="activeTab = $event as AppTab"
    />

    <!-- API Tokens content -->
    <div v-if="activeTab === 'tokens'" class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto">
      <AppTokensTab :appId="appId" :headers="headers" />
    </div>

    <!-- Integrations content -->
    <div v-if="activeTab === 'integrations'" class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto">
      <AppIntegrationsTab :appId="appId" :workspaceId="(route.params.id as string)" :headers="headers" />
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

/* ── Danger zone ── */
.danger-zone {
  padding: 1rem 1.25rem;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 0.5rem;
  background: rgba(239, 68, 68, 0.04);
}
</style>
