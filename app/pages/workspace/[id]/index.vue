<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'workspace' })

const route = useRoute()
const { token, user: currentUser } = useAuth()
const workspaceId = route.params.id as string

const headers = computed(() =>
  token.value ? { Authorization: `Bearer ${token.value}` } : {}
)

interface App { id: string; name: string; created_at: number }
interface ApiToken { id: string; name: string; created_at: number; created_by_email: string | null }

interface Member { id: string; email: string; created_at: number }

const { data: apps, refresh: refreshApps } = await useFetch<App[]>(`/api/workspaces/${workspaceId}/apps`, { headers })
const { data: apiTokens, refresh: refreshTokens } = await useFetch<ApiToken[]>(`/api/workspaces/${workspaceId}/tokens`, { headers })
const { data: members, refresh: refreshMembers } = await useFetch<Member[]>(`/api/workspaces/${workspaceId}/members`, { headers })

// ── Tabs ──────────────────────────────────────────────────────────────────────
const activeTab = ref('apps')
const tabs = [
  { key: 'apps', label: 'Applications' },
  { key: 'team', label: 'Team' },
  { key: 'settings', label: 'Settings' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function formatDate(ts: number) {
  return new Date(ts).toLocaleString()
}

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

// ── Tokens ────────────────────────────────────────────────────────────────────
interface TokenRow { id: string; name: string; date: string; createdBy: string }

const tokenRows = computed<TokenRow[]>(() =>
  (apiTokens.value || []).map(t => ({
    id: t.id,
    name: t.name,
    date: formatDate(t.created_at),
    createdBy: t.created_by_email || '—',
  }))
)

const UButton = resolveComponent('UButton')

const tokenColumns: TableColumn<TokenRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'createdBy', header: 'Created by' },
  { accessorKey: 'date', header: 'Created' },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h(UButton, {
      icon: 'i-lucide-trash-2',
      size: 'xs',
      color: 'error',
      variant: 'ghost',
      onClick: () => confirmDeleteToken(row.original),
    }),
  },
]

const tokenModalOpen = ref(false)
const newTokenName = ref('')
const newTokenLoading = ref(false)
const newTokenError = ref('')
const createdToken = ref<string | null>(null)
const copiedToken = ref(false)
const copiedUrlAppId = ref<string | null>(null)

const origin = import.meta.client ? window.location.origin : ''

function connectUrl(appId: string, token: string) {
  return `${origin}/api/apps/${appId}/reels?token=${token}`
}

async function copyUrl(appId: string, url: string) {
  await navigator.clipboard.writeText(url)
  copiedUrlAppId.value = appId
  setTimeout(() => { copiedUrlAppId.value = null }, 2000)
}

async function createToken() {
  if (!newTokenName.value.trim()) return
  newTokenLoading.value = true
  newTokenError.value = ''
  try {
    const data = await $fetch<{ id: string; name: string; token: string; created_at: number }>(
      `/api/workspaces/${workspaceId}/tokens`,
      { method: 'POST', body: { name: newTokenName.value }, headers: headers.value }
    )
    createdToken.value = data.token
    newTokenName.value = ''
    await refreshTokens()
  } catch (e: any) {
    newTokenError.value = e?.data?.message || 'Failed to create token'
  } finally {
    newTokenLoading.value = false
  }
}

const deleteModalOpen = ref(false)
const tokenToDelete = ref<TokenRow | null>(null)
const deleteLoading = ref(false)

function confirmDeleteToken(row: TokenRow) {
  tokenToDelete.value = row
  deleteModalOpen.value = true
}

async function deleteToken() {
  if (!tokenToDelete.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/workspaces/${workspaceId}/tokens/${tokenToDelete.value.id}`, {
      method: 'DELETE',
      headers: headers.value,
    })
    deleteModalOpen.value = false
    tokenToDelete.value = null
    await refreshTokens()
  } finally {
    deleteLoading.value = false
  }
}

function closeTokenModal() {
  tokenModalOpen.value = false
  createdToken.value = null
  newTokenName.value = ''
  newTokenError.value = ''
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

async function copyToken(val: string) {
  await navigator.clipboard.writeText(val)
  copiedToken.value = true
  setTimeout(() => { copiedToken.value = false }, 2000)
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
    <div class="flex-1 px-10 py-10 w-full max-w-6xl mx-auto">

      <!-- ── Applications tab ── -->
      <template v-if="activeTab === 'apps'">
        <h1 class="text-2xl font-bold text-(--ui-text-highlighted) mb-6">Applications</h1>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">

          <!-- Create app card -->
          <button
            class="h-24 rounded-lg border-2 border-dashed border-(--ui-border) hover:border-(--ui-border-accented) flex items-center justify-center gap-2 transition-colors group cursor-pointer"
            @click="newAppModalOpen = true"
          >
            <UIcon name="i-lucide-plus" class="w-4 h-4 text-(--ui-text-muted)" />
            <span class="text-sm text-(--ui-text-muted) group-hover:text-(--ui-text) transition-colors">Create application</span>
          </button>

          <!-- App cards -->
          <button
            v-for="app in apps"
            :key="app.id"
            class="h-24 rounded-lg border border-(--ui-border) bg-(--ui-bg-elevated) hover:border-(--ui-border-accented) flex flex-col overflow-hidden transition-all cursor-pointer text-left group"
            @click="navigateTo(`/workspace/${workspaceId}/app/${app.id}`)"
          >
            <div class="h-0.5 w-full bg-gradient-to-r from-primary-500 to-primary-400" />
            <div class="flex-1 px-4 flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-(--ui-bg-accented) border border-(--ui-border) flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-layout-grid" class="w-4 h-4 text-(--ui-text-muted)" />
              </div>
              <div class="space-y-0.5 min-w-0">
                <p class="text-sm font-semibold text-(--ui-text-highlighted) group-hover:text-white transition-colors truncate">
                  {{ app.name }}
                </p>
                <p class="text-xs text-(--ui-text-dimmed)">{{ timeAgo(app.created_at) }}</p>
              </div>
            </div>
          </button>

        </div>
      </template>

      <!-- ── Team tab ── -->
      <template v-if="activeTab === 'team'">
        <div class="space-y-6">
          <div>
            <h2 class="text-2xl font-bold text-(--ui-text-highlighted) mb-1">Team</h2>
            <p class="text-sm text-(--ui-text-muted)">Manage who has access to this workspace.</p>
          </div>

          <!-- Add member -->
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

          <!-- Members list -->
          <div class="rounded-xl border border-(--ui-border) divide-y divide-(--ui-border) overflow-hidden">
            <!-- Owner -->
            <div class="flex items-center gap-3 px-4 py-3 bg-(--ui-bg-elevated)">
              <div class="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0">
                <span class="text-white text-xs font-bold">{{ currentUser?.email?.[0]?.toUpperCase() }}</span>
              </div>
              <span class="text-sm text-(--ui-text) flex-1">{{ currentUser?.email }}</span>
              <span class="text-xs text-(--ui-text-dimmed) bg-(--ui-bg-accented) px-2 py-0.5 rounded-full">Owner</span>
            </div>

            <!-- Members -->
            <div
              v-for="member in members"
              :key="member.id"
              class="flex items-center gap-3 px-4 py-3 hover:bg-(--ui-bg-elevated)/50 transition-colors group"
            >
              <div class="w-8 h-8 rounded-full bg-(--ui-bg-accented) border border-(--ui-border) flex items-center justify-center shrink-0">
                <span class="text-xs font-medium text-(--ui-text-muted)">{{ member.email[0].toUpperCase() }}</span>
              </div>
              <span class="text-sm text-(--ui-text) flex-1">{{ member.email }}</span>
              <UButton
                icon="i-lucide-x"
                size="xs"
                color="error"
                variant="ghost"
                class="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                :loading="removingMemberId === member.id"
                @click="removeMember(member.id)"
              />
            </div>

            <!-- Empty -->
            <div v-if="!members?.length" class="px-4 py-6 text-center text-sm text-(--ui-text-muted)">
              No members yet. Add teammates by email above.
            </div>
          </div>
        </div>
      </template>

      <!-- ── Settings tab ── -->
      <template v-if="activeTab === 'settings'">
        <div class="space-y-10">

          <!-- API Tokens -->
          <div>
            <div class="flex items-start justify-between mb-5">
              <div>
                <h2 class="text-lg font-semibold text-(--ui-text-highlighted)">API Tokens</h2>
                <p class="text-sm text-(--ui-text-muted) mt-1">
                  Tokens allow the browser extension to push recordings to this workspace.
                </p>
              </div>
              <UButton label="New token" icon="i-lucide-plus" size="sm" @click="tokenModalOpen = true" />
            </div>

            <div v-if="tokenRows.length === 0" class="text-sm text-(--ui-text-muted) py-8 text-center border border-dashed border-(--ui-border) rounded-xl">
              No API tokens yet.
            </div>
            <UTable v-else :data="tokenRows" :columns="tokenColumns" />
          </div>

          <!-- Workspace ID -->
          <div>
            <h2 class="text-lg font-semibold text-(--ui-text-highlighted) mb-1">Workspace ID</h2>
            <p class="text-sm text-(--ui-text-muted) mb-3">Required in the extension alongside the API token.</p>
            <code class="block text-sm font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-4 py-3 rounded-lg text-(--ui-text) break-all select-all">{{ workspaceId }}</code>
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

    <!-- New token modal -->
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
                <UButton :icon="copiedToken ? 'i-lucide-check' : 'i-lucide-copy'" size="sm" variant="outline" @click="copyToken(createdToken!)" />
              </div>
            </div>

            <!-- Extension URLs per app -->
            <div v-if="apps?.length">
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2">Extension endpoint URLs</p>
              <div class="space-y-2">
                <div v-for="app in apps" :key="app.id" class="flex items-center gap-2">
                  <span class="text-xs text-(--ui-text-dimmed) shrink-0 w-24 truncate" :title="app.name">{{ app.name }}</span>
                  <code class="flex-1 text-xs font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-2 py-1.5 rounded-md text-(--ui-text-muted) truncate">{{ connectUrl(app.id, createdToken!) }}</code>
                  <UButton
                    :icon="copiedUrlAppId === app.id ? 'i-lucide-check' : 'i-lucide-copy'"
                    size="xs"
                    variant="ghost"
                    class="shrink-0"
                    @click="copyUrl(app.id, connectUrl(app.id, createdToken!))"
                  />
                </div>
              </div>
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
    <UModal v-model:open="deleteModalOpen" title="Delete API token">
      <template #body>
        <p class="text-sm text-(--ui-text-muted)">
          Are you sure you want to delete the token
          <span class="font-medium text-(--ui-text)">{{ tokenToDelete?.name }}</span>?
          Any extension using it will stop working.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteModalOpen = false" />
          <UButton label="Delete" color="error" :loading="deleteLoading" @click="deleteToken" />
        </div>
      </template>
    </UModal>
  </div>
</template>
