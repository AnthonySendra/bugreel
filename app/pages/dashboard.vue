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

// Auto-open modal if redirected with ?new=1
const route = useRoute()
if (route.query.new === '1') {
  isModalOpen.value = true
}

async function createWorkspace() {
  if (!newWorkspaceName.value.trim()) return
  creating.value = true
  createError.value = ''
  try {
    const ws = await $fetch<Workspace>('/api/workspaces', {
      method: 'POST',
      headers: headers.value,
      body: { name: newWorkspaceName.value.trim() },
    })
    newWorkspaceName.value = ''
    isModalOpen.value = false
    await refresh()
    if (ws?.id) router.push(`/workspace/${ws.id}`)
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

const hasWorkspaces = computed(() => (workspaces.value?.length || 0) > 0)
</script>

<template>
  <div class="min-h-screen bg-(--ui-bg) dash-page">
    <div class="max-w-4xl mx-auto px-6 py-10 space-y-10">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="dash-title">Workspaces</h1>
          <p class="text-sm text-(--ui-text-dimmed) mt-1">Organize your apps and recordings</p>
        </div>
        <div class="flex gap-3">
          <UButton
            icon="i-lucide-plus"
            label="New workspace"
            @click="isModalOpen = true"
          />
          <UButton
            icon="i-lucide-log-out"
            label="Logout"
            variant="ghost"
            color="neutral"
            @click="handleLogout"
          />
        </div>
      </div>

      <!-- Onboarding — shown when no workspaces -->
      <div v-if="!hasWorkspaces" class="onboarding-card">
        <div class="onboarding-header">
          <div class="onboarding-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526" />
              <circle cx="12" cy="8" r="6" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold text-white">Get your first bug reel</h2>
            <p class="text-sm text-(--ui-text-muted) mt-0.5">Follow these steps to start recording bugs</p>
          </div>
        </div>

        <div class="onboarding-steps">
          <!-- Step 1 -->
          <div class="onboarding-step">
            <div class="step-number step-active">1</div>
            <div class="step-content">
              <h3 class="step-title">Create a workspace</h3>
              <p class="step-desc">A workspace groups your apps and team members together.</p>
              <UButton
                label="Create workspace"
                size="sm"
                class="mt-3"
                @click="isModalOpen = true"
              />
            </div>
          </div>

          <!-- Step 2 -->
          <div class="onboarding-step step-locked">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3 class="step-title">Add an application</h3>
              <p class="step-desc">Each app has its own feed of recorded reels.</p>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="onboarding-step step-locked">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3 class="step-title">Generate an API token</h3>
              <p class="step-desc">The token connects the browser extension or the SDK to your workspace.</p>
            </div>
          </div>

          <!-- Step 4 -->
          <div class="onboarding-step step-locked">
            <div class="step-number">4</div>
            <div class="step-content">
              <h3 class="step-title">Record your first bug</h3>
              <p class="step-desc">Use the browser extension (Chrome/Firefox) or embed the SDK script tag in your app.</p>
            </div>
          </div>
        </div>

        <!-- Ad-blocker warning -->
        <div class="adblocker-warning">
          <UIcon name="i-lucide-shield-alert" class="w-4 h-4 text-amber-400 shrink-0" />
          <p class="text-xs text-(--ui-text-muted) leading-relaxed">
            <span class="font-medium text-amber-400">Ad blockers</span> can prevent the extension and SDK from connecting to Bugreel. If recording doesn't work, try disabling your ad blocker on the target site.
          </p>
        </div>
      </div>

      <!-- Workspace grid -->
      <div
        v-if="hasWorkspaces"
        class="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <button
          v-for="ws in workspaces"
          :key="ws.id"
          class="ws-card group"
          @click="router.push(`/workspace/${ws.id}`)"
        >
          <div class="ws-card-accent" />
          <div class="ws-card-body">
            <div class="ws-card-icon">
              <span>{{ ws.name[0]?.toUpperCase() || 'W' }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-white group-hover:text-bugreel-400 transition-colors truncate">
                {{ ws.name }}
              </p>
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
                Created {{ formatDate(ws.created_at) }}
              </p>
            </div>
            <UIcon name="i-lucide-chevron-right" class="w-4 h-4 text-(--ui-text-dimmed) group-hover:text-(--ui-text-muted) transition-colors shrink-0" />
          </div>
        </button>

        <!-- New workspace card -->
        <button
          class="ws-card-new group"
          @click="isModalOpen = true"
        >
          <UIcon name="i-lucide-plus" class="w-5 h-5 text-(--ui-text-dimmed) group-hover:text-bugreel-400 transition-colors" />
          <span class="text-sm text-(--ui-text-muted) group-hover:text-(--ui-text) transition-colors">New workspace</span>
        </button>
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
              autofocus
              @keyup.enter="createWorkspace"
            />
          </UFormField>

          <UAlert
            v-if="createError"
            color="error"
            variant="soft"
            :description="createError"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 w-full">
          <UButton
            label="Cancel"
            variant="outline"
            color="neutral"
            @click="isModalOpen = false"
          />
          <UButton
            label="Create"
            :loading="creating"
            :disabled="!newWorkspaceName.trim()"
            @click="createWorkspace"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.dash-title {
  font-family: 'Georgia', 'Times New Roman', serif;
  font-size: 1.75rem;
  font-weight: 700;
  color: white;
  letter-spacing: -0.03em;
}

/* ── Onboarding card ── */
.onboarding-card {
  border: 1px solid var(--ui-border);
  border-radius: 1rem;
  background: linear-gradient(135deg, rgba(255, 64, 112, 0.04) 0%, transparent 60%);
  overflow: hidden;
}
.onboarding-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 1.75rem;
  border-bottom: 1px solid var(--ui-border);
}
.onboarding-icon {
  width: 3rem;
  height: 3rem;
  border-radius: 0.75rem;
  background: linear-gradient(135deg, #ff4070 0%, #ed1050 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}
.onboarding-steps {
  padding: 1.25rem 1.75rem 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.onboarding-step {
  display: flex;
  gap: 1rem;
  padding: 1rem 0;
  position: relative;
}
.onboarding-step:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 0.875rem;
  top: 2.75rem;
  bottom: 0;
  width: 1px;
  background: var(--ui-border);
}
.step-number {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  border: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ui-text-muted);
  flex-shrink: 0;
  background: var(--ui-bg);
}
.step-number.step-active {
  border-color: #ff4070;
  color: #ff4070;
  box-shadow: 0 0 0 3px rgba(255, 64, 112, 0.15);
}
.step-content {
  flex: 1;
  padding-top: 0.1rem;
}
.step-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: white;
}
.step-locked .step-title {
  color: var(--ui-text-muted);
}
.step-desc {
  font-size: 0.8125rem;
  color: var(--ui-text-dimmed);
  margin-top: 0.125rem;
  line-height: 1.5;
}

/* ── Ad-blocker warning ── */
.adblocker-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.875rem 1.25rem;
  margin: 0 1.75rem 1.5rem;
  border-radius: 0.5rem;
  background: rgba(251, 191, 36, 0.05);
  border: 1px solid rgba(251, 191, 36, 0.15);
}

/* ── Workspace cards ── */
.ws-card {
  position: relative;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  background: var(--ui-bg-elevated);
  overflow: hidden;
  transition: all 0.2s;
  text-align: left;
}
.ws-card:hover {
  border-color: var(--ui-border-accented);
  box-shadow: 0 0 0 1px rgba(255, 64, 112, 0.1), 0 4px 20px rgba(0, 0, 0, 0.2);
}
.ws-card-accent {
  height: 2px;
  background: linear-gradient(90deg, #ff4070, #ff5888);
}
.ws-card-body {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
}
.ws-card-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  background: linear-gradient(135deg, #ff4070, #ed1050);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ws-card-icon span {
  color: white;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1;
}
.ws-card-new {
  border: 2px dashed var(--ui-border);
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 1.5rem;
  transition: all 0.2s;
  background: transparent;
}
.ws-card-new:hover {
  border-color: var(--ui-border-accented);
  background: rgba(255, 255, 255, 0.02);
}
</style>
