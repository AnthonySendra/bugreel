<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'workspace' })

const route = useRoute()
const { token, user: currentUser } = useAuth()
const workspaceId = route.params.id as string

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

interface App { id: string; name: string; created_at: number }
interface Member { id: string; email: string; created_at: number }

interface Workspace { id: string; name: string; role: 'owner' | 'member' }

const { data: workspaces } = await useFetch<Workspace[]>('/api/workspaces', { headers })
const workspace = computed(() => workspaces.value?.find(w => w.id === workspaceId))
const isOwner = computed(() => workspace.value?.role === 'owner')

const { data: apps, refresh: refreshApps } = await useFetch<App[]>(`/api/workspaces/${workspaceId}/apps`, { headers })
const { data: membersData, refresh: refreshMembers } = await useFetch<{ owner: { id: string; email: string }; members: Member[] }>(`/api/workspaces/${workspaceId}/members`, { headers })
const members = computed(() => membersData.value?.members || [])
const ownerEmail = computed(() => membersData.value?.owner?.email || '')

// ── Rename workspace ─────────────────────────────────────────────────────────
const editWsName = ref('')
const editWsLoading = ref(false)
const editWsSaved = ref(false)

watch(workspace, (ws) => {
  if (ws && !editWsName.value) editWsName.value = ws.name
}, { immediate: true })

async function renameWorkspace() {
  if (!editWsName.value.trim() || editWsLoading.value) return
  editWsLoading.value = true
  editWsSaved.value = false
  try {
    await $fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: headers.value,
      body: { name: editWsName.value.trim() },
    })
    editWsSaved.value = true
    // Refresh workspace list in layout
    await refreshNuxtData()
    setTimeout(() => { editWsSaved.value = false }, 2000)
  } finally {
    editWsLoading.value = false
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const validTabs = ['apps', 'team', 'settings'] as const
const initialTab = validTabs.includes(route.hash.slice(1) as any) ? route.hash.slice(1) : 'apps'
const activeTab = ref(initialTab)

watch(activeTab, (tab) => {
  const hash = tab === 'apps' ? '' : `#${tab}`
  navigateTo({ hash }, { replace: true })
})

const tabs = computed(() => {
  const items = [
    { key: 'apps', label: 'Applications', icon: 'i-lucide-layout-grid' },
    { key: 'team', label: 'Team', icon: 'i-lucide-users' },
  ]
  if (isOwner.value) {
    items.push({ key: 'settings', label: 'Settings', icon: 'i-lucide-settings' })
  }
  return items
})

// ── Onboarding state ─────────────────────────────────────────────────────────
const hasApps = computed(() => (apps.value?.length || 0) > 0)
const onboardingStep = computed(() => {
  if (!hasApps.value) return 2
  return 3
})
const showOnboarding = computed(() => onboardingStep.value <= 3)

// ── New app modal ─────────────────────────────────────────────────────────────
const newAppModalOpen = ref(false)
const newAppName = ref('')
const newAppLoading = ref(false)
const newAppError = ref('')

async function createApp() {
  if (!newAppName.value.trim()) return
  newAppLoading.value = true
  newAppError.value = ''
  try {
    const data = await $fetch<{ id: string; name: string; created_at: number }>(
      `/api/workspaces/${workspaceId}/apps`,
      { method: 'POST', body: { name: newAppName.value }, headers: headers.value }
    )
    newAppModalOpen.value = false
    newAppName.value = ''
    await refreshApps()
    await navigateTo(`/workspace/${workspaceId}/app/${data.id}`)
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

// ── Delete workspace ─────────────────────────────────────────────────────────
const deleteWsModalOpen = ref(false)
const deleteWsLoading = ref(false)
const deleteWsConfirm = ref('')

async function deleteWorkspace() {
  deleteWsLoading.value = true
  try {
    await $fetch(`/api/workspaces/${workspaceId}`, {
      method: 'DELETE',
      headers: headers.value,
    })
    await navigateTo('/dashboard')
  } finally {
    deleteWsLoading.value = false
  }
}

function closeDeleteWsModal() {
  deleteWsModalOpen.value = false
  deleteWsConfirm.value = ''
}

// ── Team ──────────────────────────────────────────────────────────────────────
const inviteEmail = ref('')
const inviteLoading = ref(false)
const inviteError = ref('')

async function inviteMember() {
  if (!inviteEmail.value.trim()) return
  inviteLoading.value = true
  inviteError.value = ''
  try {
    await $fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      body: { email: inviteEmail.value },
      headers: headers.value,
    })
    inviteEmail.value = ''
    await refreshMembers()
  } catch (e: any) {
    inviteError.value = e?.data?.message || 'Failed to add member'
  } finally {
    inviteLoading.value = false
  }
}

const removingMemberId = ref<string | null>(null)

async function removeMember(userId: string) {
  removingMemberId.value = userId
  try {
    await $fetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
      headers: headers.value,
    })
    await refreshMembers()
  } finally {
    removingMemberId.value = null
  }
}

</script>

<template>
  <div class="flex flex-col flex-1 ws-page">

    <!-- Tab bar -->
    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ 'tab-active': activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <UIcon :name="tab.icon" class="w-4 h-4" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- Content -->
    <div class="flex-1 px-10 py-8 w-full max-w-5xl mx-auto">

      <!-- ── Onboarding banner ── -->
      <div v-if="showOnboarding" class="onboard-banner">
        <div class="onboard-progress">
          <div class="onboard-progress-fill" :style="{ width: `${((onboardingStep - 1) / 3) * 100}%` }" />
        </div>
        <div class="onboard-body">
          <div class="onboard-left">
            <p class="onboard-label">Getting started</p>
            <h3 class="onboard-heading">
              <template v-if="onboardingStep === 2">Create your first application</template>
              <template v-else>Generate an API token</template>
            </h3>
            <p class="onboard-desc">
              <template v-if="onboardingStep === 2">An application is where your recorded reels will appear. Think of it as a project.</template>
              <template v-else>Open your app and go to the <strong class="text-white">API Tokens</strong> tab to create a token, then use it with the browser extension or SDK.</template>
            </p>
          </div>
          <div class="onboard-actions">
            <UButton
              v-if="onboardingStep === 2"
              label="Create app"
              icon="i-lucide-plus"
              @click="newAppModalOpen = true"
            />
            <UButton
              v-else-if="apps?.length"
              label="Go to app"
              icon="i-lucide-key-round"
              @click="navigateTo(`/workspace/${workspaceId}/app/${apps[0].id}#tokens`)"
            />
          </div>
        </div>
        <div class="onboard-steps-row">
          <div
            v-for="s in 3"
            :key="s"
            class="onboard-dot"
            :class="{ 'dot-done': s < onboardingStep, 'dot-current': s === onboardingStep }"
          />
        </div>
      </div>

      <!-- ── Applications tab ── -->
      <template v-if="activeTab === 'apps'">
        <div class="section-header">
          <h1 class="section-title">Applications</h1>
          <UButton v-if="isOwner" label="New app" icon="i-lucide-plus" size="sm" @click="newAppModalOpen = true" />
        </div>

        <div v-if="!hasApps" class="empty-state">
          <div class="empty-icon">
            <UIcon name="i-lucide-layout-grid" class="w-8 h-8" />
          </div>
          <p class="empty-title">No applications yet</p>
          <p class="empty-desc">Create your first app to start collecting bug recordings.</p>
          <UButton label="Create application" icon="i-lucide-plus" class="mt-4" @click="newAppModalOpen = true" />
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="app in apps"
            :key="app.id"
            class="app-card group"
            @click="navigateTo(`/workspace/${workspaceId}/app/${app.id}`)"
          >
            <div class="app-card-accent" />
            <div class="app-card-body">
              <div class="app-card-icon">
                <UIcon name="i-lucide-box" class="w-4.5 h-4.5 text-bugreel-400" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold text-white group-hover:text-bugreel-400 transition-colors truncate">
                  {{ app.name }}
                </p>
                <p class="text-xs text-(--ui-text-dimmed) mt-0.5">{{ timeAgo(app.created_at) }}</p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
          </button>
        </div>
      </template>

      <!-- ── Team tab ── -->
      <template v-if="activeTab === 'team'">
        <div class="section-header">
          <div>
            <h1 class="section-title">Team</h1>
            <p class="text-sm text-(--ui-text-muted) mt-1">Manage who has access to this workspace.</p>
          </div>
        </div>

        <div class="space-y-5">
          <!-- Add member (owner only) -->
          <template v-if="isOwner">
            <div class="flex gap-2">
              <UInput
                v-model="inviteEmail"
                placeholder="colleague@example.com"
                class="flex-1"
                @keyup.enter="inviteMember"
              />
              <UButton label="Add" :loading="inviteLoading" :disabled="!inviteEmail.trim()" @click="inviteMember" />
            </div>
            <UAlert v-if="inviteError" color="error" variant="soft" :description="inviteError" />
          </template>

          <!-- Members list -->
          <div class="members-list">
            <!-- Owner -->
            <div class="member-row">
              <div class="member-avatar member-avatar-owner">
                <span>{{ ownerEmail?.[0]?.toUpperCase() }}</span>
              </div>
              <span class="text-sm text-(--ui-text) flex-1">{{ ownerEmail }}</span>
              <span class="member-badge">Owner</span>
            </div>

            <!-- Members -->
            <div
              v-for="member in members"
              :key="member.id"
              class="member-row group"
            >
              <div class="member-avatar">
                <span>{{ member.email[0].toUpperCase() }}</span>
              </div>
              <span class="text-sm text-(--ui-text) flex-1">{{ member.email }}</span>
              <UButton
                v-if="isOwner"
                icon="i-lucide-x"
                size="xs"
                color="error"
                variant="ghost"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                :loading="removingMemberId === member.id"
                @click="removeMember(member.id)"
              />
            </div>

            <!-- Empty -->
            <div v-if="!members?.length" class="px-4 py-8 text-center text-sm text-(--ui-text-muted)">
              No members yet. Add teammates by email above.
            </div>
          </div>
        </div>
      </template>

      <!-- ── Settings tab ── -->
      <template v-if="activeTab === 'settings'">
        <div class="space-y-10">

          <!-- General -->
          <div>
            <div class="section-header">
              <div>
                <h2 class="section-title text-lg!">General</h2>
                <p class="text-sm text-(--ui-text-muted) mt-1">Workspace settings and identity.</p>
              </div>
            </div>
            <div class="settings-card space-y-4">
              <div>
                <label class="settings-label">Workspace ID</label>
                <code class="settings-code">{{ workspaceId }}</code>
              </div>
              <div>
                <label class="settings-label">Workspace name</label>
                <div class="flex items-center gap-2">
                  <UInput v-model="editWsName" placeholder="Workspace name" class="flex-1" @keyup.enter="renameWorkspace" />
                  <UButton
                    :label="editWsSaved ? 'Saved' : 'Save'"
                    :icon="editWsSaved ? 'i-lucide-check' : undefined"
                    size="sm"
                    :loading="editWsLoading"
                    :disabled="!editWsName.trim() || editWsName.trim() === workspace?.name"
                    @click="renameWorkspace"
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
                  <p class="text-sm font-medium text-(--ui-text)">Delete this workspace</p>
                  <p class="text-xs text-(--ui-text-dimmed) mt-0.5">All apps, reels, tokens, and members will be permanently deleted.</p>
                </div>
                <UButton label="Delete workspace" color="error" variant="soft" size="sm" icon="i-lucide-trash-2" @click="deleteWsModalOpen = true" />
              </div>
            </div>
          </div>

        </div>
      </template>
    </div>

    <!-- New app modal -->
    <UModal v-model:open="newAppModalOpen" title="Create application" @close="closeNewAppModal">
      <template #body>
        <div class="space-y-4">
          <UFormField label="Application name">
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

    <!-- Delete workspace modal -->
    <UModal v-model:open="deleteWsModalOpen" title="Delete workspace" @close="closeDeleteWsModal">
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-(--ui-text-muted)">
            This will permanently delete this workspace and <strong class="text-(--ui-text)">all its apps, reels, tokens, and members</strong>. This action cannot be undone.
          </p>
          <UFormField label="Type DELETE to confirm">
            <UInput v-model="deleteWsConfirm" placeholder="DELETE" class="w-full" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="closeDeleteWsModal" />
          <UButton label="Delete forever" color="error" :loading="deleteWsLoading" :disabled="deleteWsConfirm !== 'DELETE'" @click="deleteWorkspace" />
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
.tab-btn:hover {
  color: var(--ui-text);
}
.tab-active {
  border-bottom-color: #ff4070;
  color: white;
}

/* ── Section headers ── */
.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}
.section-title {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  letter-spacing: -0.02em;
}

/* ── App cards ── */
.app-card {
  position: relative;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  background: var(--ui-bg-elevated);
  overflow: hidden;
  transition: all 0.2s;
  text-align: left;
}
.app-card:hover {
  border-color: var(--ui-border-accented);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}
.app-card-accent {
  height: 2px;
  background: linear-gradient(90deg, #ff4070, #ff5888);
}
.app-card-body {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}
.app-card-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  background: rgba(255, 64, 112, 0.1);
  border: 1px solid rgba(255, 64, 112, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ── Members ── */
.members-list {
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  overflow: hidden;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  transition: background 0.15s;
}
.member-row:not(:last-child) {
  border-bottom: 1px solid var(--ui-border);
}
.member-row:hover {
  background: rgba(255, 255, 255, 0.02);
}
.member-avatar {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--ui-bg-accented);
  border: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.member-avatar span {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ui-text-muted);
}
.member-avatar-owner {
  background: linear-gradient(135deg, #ff4070, #ed1050);
  border: none;
}
.member-avatar-owner span {
  color: white;
}
.member-badge {
  font-size: 0.6875rem;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg-accented);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
}

/* ── Empty states ── */
.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  border: 1px dashed var(--ui-border);
  border-radius: 1rem;
}
.empty-icon {
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
/* ── Onboarding banner ── */
.onboard-banner {
  border: 1px solid var(--ui-border);
  border-radius: 0.875rem;
  background: linear-gradient(135deg, rgba(255, 64, 112, 0.05) 0%, transparent 50%);
  overflow: hidden;
  margin-bottom: 2rem;
}
.onboard-progress {
  height: 3px;
  background: var(--ui-bg-accented);
}
.onboard-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #ff4070, #ff5888);
  transition: width 0.5s ease;
}
.onboard-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.25rem 1.5rem;
}
.onboard-left {
  flex: 1;
  min-width: 0;
}
.onboard-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #ff4070;
  margin-bottom: 0.25rem;
}
.onboard-heading {
  font-size: 0.9375rem;
  font-weight: 600;
  color: white;
}
.onboard-desc {
  font-size: 0.8125rem;
  color: var(--ui-text-muted);
  margin-top: 0.25rem;
  line-height: 1.5;
}
.onboard-actions {
  flex-shrink: 0;
}
.onboard-step-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border);
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
}
.onboard-steps-row {
  display: flex;
  gap: 0.375rem;
  padding: 0 1.5rem 1rem;
}
.onboard-dot {
  width: 2rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: var(--ui-bg-accented);
  transition: all 0.3s;
}
.dot-done {
  background: #ff4070;
}
.dot-current {
  background: rgba(255, 64, 112, 0.5);
}

/* ── Settings ── */
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
