<script setup lang="ts">
const props = defineProps<{
  appId: string
  workspaceId: string
  headers: Record<string, string>
}>()

type Provider = 'linear' | 'jira'

interface Integration {
  provider: Provider
  config: Record<string, string>
  teamOrProject?: string
}

// ── State ───────────────────────────────────────────────────────────────────
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const removing = ref(false)
const error = ref('')
const testSuccess = ref(false)

const currentIntegration = ref<Integration | null>(null)
const selectedProvider = ref<Provider | null>(null)

// Linear fields
const linearApiKey = ref('')
const linearTeams = ref<{ label: string; value: string }[]>([])
const linearSelectedTeam = ref('')

// Jira fields
const jiraSiteUrl = ref('')
const jiraEmail = ref('')
const jiraApiToken = ref('')
const jiraProjects = ref<{ label: string; value: string }[]>([])
const jiraSelectedProject = ref('')
const jiraIssueTypes = ref<{ label: string; value: string }[]>([])
const jiraSelectedIssueType = ref('')

// ── Computed ─────────────────────────────────────────────────────────────────
const baseUrl = computed(() => `/api/workspaces/${props.workspaceId}/apps/${props.appId}/integration`)

const canTest = computed(() => {
  if (selectedProvider.value === 'linear') return !!linearApiKey.value.trim()
  if (selectedProvider.value === 'jira') return !!jiraSiteUrl.value.trim() && !!jiraEmail.value.trim() && !!jiraApiToken.value.trim()
  return false
})

const canSave = computed(() => {
  if (selectedProvider.value === 'linear') return !!linearApiKey.value.trim() && !!linearSelectedTeam.value
  if (selectedProvider.value === 'jira') return !!jiraSiteUrl.value.trim() && !!jiraEmail.value.trim() && !!jiraApiToken.value.trim() && !!jiraSelectedProject.value && !!jiraSelectedIssueType.value
  return false
})

// ── Load current integration ────────────────────────────────────────────────
async function loadIntegration() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<Integration | null>(baseUrl.value, {
      headers: props.headers,
    })
    if (data?.provider && data.config) {
      currentIntegration.value = {
        provider: data.provider,
        config: data.config,
        teamOrProject: data.provider === 'linear'
          ? data.config.teamName
          : data.config.projectName || data.config.projectKey,
      }
    } else {
      currentIntegration.value = null
    }
  } catch (e: any) {
    if (e?.statusCode !== 404) {
      error.value = e?.data?.message || e?.message || 'Failed to load integration'
    }
    currentIntegration.value = null
  } finally {
    loading.value = false
  }
}

// ── Test connection ─────────────────────────────────────────────────────────
async function testConnection() {
  testing.value = true
  error.value = ''
  testSuccess.value = false
  try {
    const body: Record<string, any> = { provider: selectedProvider.value }
    if (selectedProvider.value === 'linear') {
      body.config = { apiKey: linearApiKey.value.trim() }
    } else {
      body.config = {
        siteUrl: jiraSiteUrl.value.trim(),
        email: jiraEmail.value.trim(),
        apiToken: jiraApiToken.value.trim(),
      }
    }

    const res = await $fetch<{ teams?: any[]; projects?: any[] }>(baseUrl.value, {
      method: 'POST',
      headers: props.headers,
      body,
    })

    const data = res as any
    if (data.ok === false) {
      error.value = data.error || 'Connection test failed'
      return
    }
    if (selectedProvider.value === 'linear' && data.teams) {
      linearTeams.value = data.teams.map((t: any) => ({ label: t.name, value: t.id }))
      if (linearTeams.value.length === 1) linearSelectedTeam.value = linearTeams.value[0].value
    }
    if (selectedProvider.value === 'jira' && data.projects) {
      jiraProjects.value = data.projects.map((p: any) => ({ label: `${p.key} — ${p.name}`, value: p.key }))
      if (jiraProjects.value.length === 1) jiraSelectedProject.value = jiraProjects.value[0].value
    }
    testSuccess.value = true
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Connection test failed'
  } finally {
    testing.value = false
  }
}

// ── Fetch Jira issue types when project is selected ─────────────────────────
async function fetchJiraIssueTypes() {
  if (!jiraSelectedProject.value) return
  jiraIssueTypes.value = []
  jiraSelectedIssueType.value = ''
  try {
    const res = await $fetch<any>(baseUrl.value, {
      method: 'POST',
      headers: props.headers,
      body: {
        provider: 'jira',
        config: {
          siteUrl: jiraSiteUrl.value.trim(),
          email: jiraEmail.value.trim(),
          apiToken: jiraApiToken.value.trim(),
          projectKey: jiraSelectedProject.value,
        },
      },
    })
    if (res.issueTypes?.length) {
      jiraIssueTypes.value = res.issueTypes.map((t: any) => ({ label: t.name, value: t.id }))
      // Auto-select "Bug" if available, otherwise first
      const bug = jiraIssueTypes.value.find(t => t.label.toLowerCase() === 'bug')
      jiraSelectedIssueType.value = bug ? bug.value : jiraIssueTypes.value[0].value
    }
  } catch { /* ignore */ }
}

watch(() => jiraSelectedProject.value, (val) => {
  if (val) fetchJiraIssueTypes()
})

// ── Save integration ────────────────────────────────────────────────────────
async function saveIntegration() {
  saving.value = true
  error.value = ''
  try {
    const body: Record<string, any> = { provider: selectedProvider.value }
    if (selectedProvider.value === 'linear') {
      body.config = {
        apiKey: linearApiKey.value.trim(),
        teamId: linearSelectedTeam.value,
        teamName: linearTeams.value.find(t => t.value === linearSelectedTeam.value)?.label,
      }
    } else {
      body.config = {
        siteUrl: jiraSiteUrl.value.trim(),
        email: jiraEmail.value.trim(),
        apiToken: jiraApiToken.value.trim(),
        projectKey: jiraSelectedProject.value,
        projectName: jiraProjects.value.find(p => p.value === jiraSelectedProject.value)?.label,
        issueTypeId: jiraSelectedIssueType.value,
        issueTypeName: jiraIssueTypes.value.find(t => t.value === jiraSelectedIssueType.value)?.label,
      }
    }

    await $fetch(baseUrl.value, {
      method: 'PUT',
      headers: props.headers,
      body,
    })

    await loadIntegration()
    resetForm()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Failed to save integration'
  } finally {
    saving.value = false
  }
}

// ── Remove integration ──────────────────────────────────────────────────────
async function removeIntegration() {
  removing.value = true
  error.value = ''
  try {
    await $fetch(baseUrl.value, {
      method: 'PUT',
      headers: props.headers,
      body: { provider: null },
    })
    currentIntegration.value = null
    resetForm()
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Failed to remove integration'
  } finally {
    removing.value = false
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function selectProvider(provider: Provider) {
  selectedProvider.value = provider
  error.value = ''
  testSuccess.value = false
  linearTeams.value = []
  linearSelectedTeam.value = ''
  jiraProjects.value = []
  jiraSelectedProject.value = ''
  jiraIssueTypes.value = []
  jiraSelectedIssueType.value = ''
}

function resetForm() {
  selectedProvider.value = null
  linearApiKey.value = ''
  linearTeams.value = []
  linearSelectedTeam.value = ''
  jiraSiteUrl.value = ''
  jiraEmail.value = ''
  jiraApiToken.value = ''
  jiraProjects.value = []
  jiraSelectedProject.value = ''
  jiraIssueTypes.value = []
  jiraSelectedIssueType.value = ''
  testSuccess.value = false
  error.value = ''
}

function startReconfigure() {
  if (currentIntegration.value) {
    selectedProvider.value = currentIntegration.value.provider
  }
  currentIntegration.value = null
}

// ── Webhook / Notifications ─────────────────────────────────────────────────
const webhookLoading = ref(true)
const webhookSaving = ref(false)
const webhookTesting = ref(false)
const webhookRemoving = ref(false)
const webhookError = ref('')
const webhookSuccess = ref('')

const webhookUrl = ref('')
const webhookEvents = reactive({
  new_reel: true,
  new_comment: true,
  reel_done: true,
})

interface WebhookConfig {
  url: string
  events: string[]
}

const currentWebhook = ref<WebhookConfig | null>(null)

const webhookBaseUrl = computed(() => `/api/workspaces/${props.workspaceId}/apps/${props.appId}/webhook`)

async function loadWebhook() {
  webhookLoading.value = true
  webhookError.value = ''
  try {
    const data = await $fetch<any>(webhookBaseUrl.value, {
      headers: props.headers,
    })
    const url = data?.url || data?.webhookUrl
    const events = data?.events || data?.webhookEvents
    if (url) {
      currentWebhook.value = { url, events: events || [] }
      webhookUrl.value = url
      webhookEvents.new_reel = events?.includes('new_reel') ?? true
      webhookEvents.new_comment = events?.includes('new_comment') ?? true
      webhookEvents.reel_done = events?.includes('reel_done') ?? true
    } else {
      currentWebhook.value = null
    }
  } catch (e: any) {
    if (e?.statusCode !== 404) {
      webhookError.value = e?.data?.message || e?.message || 'Failed to load webhook config'
    }
    currentWebhook.value = null
  } finally {
    webhookLoading.value = false
  }
}

async function saveWebhook() {
  if (!webhookUrl.value.trim()) return
  webhookSaving.value = true
  webhookError.value = ''
  webhookSuccess.value = ''
  try {
    const selectedEvents = Object.entries(webhookEvents)
      .filter(([, v]) => v)
      .map(([k]) => k)
    await $fetch(webhookBaseUrl.value, {
      method: 'PUT',
      headers: props.headers,
      body: { url: webhookUrl.value.trim(), events: selectedEvents },
    })
    await loadWebhook()
    webhookTestSuccess.value = false
  } catch (e: any) {
    webhookError.value = e?.data?.message || e?.message || 'Failed to save webhook'
  } finally {
    webhookSaving.value = false
  }
}

const webhookTestSuccess = ref(false)

async function testWebhook() {
  if (!webhookUrl.value.trim()) return
  webhookTesting.value = true
  webhookError.value = ''
  webhookSuccess.value = ''
  webhookTestSuccess.value = false
  try {
    // Save config first so the server knows the URL
    const selectedEvents = Object.entries(webhookEvents)
      .filter(([, v]) => v)
      .map(([k]) => k)
    await $fetch(webhookBaseUrl.value, {
      method: 'PUT',
      headers: props.headers,
      body: { url: webhookUrl.value.trim(), events: selectedEvents },
    })
    // Send test payload via server (avoids CORS issues)
    await $fetch(`${webhookBaseUrl.value}-test`, {
      method: 'POST',
      headers: props.headers,
    })
    webhookTestSuccess.value = true
  } catch (e: any) {
    webhookError.value = e?.data?.message || e?.message || 'Test webhook failed'
  } finally {
    webhookTesting.value = false
  }
}

async function removeWebhook() {
  webhookRemoving.value = true
  webhookError.value = ''
  webhookSuccess.value = ''
  try {
    await $fetch(webhookBaseUrl.value, {
      method: 'PUT',
      headers: props.headers,
      body: { url: null },
    })
    currentWebhook.value = null
    webhookUrl.value = ''
    webhookEvents.new_reel = true
    webhookEvents.new_comment = true
    webhookEvents.reel_done = true
    webhookTestSuccess.value = false
  } catch (e: any) {
    webhookError.value = e?.data?.message || e?.message || 'Failed to remove webhook'
  } finally {
    webhookRemoving.value = false
  }
}

onMounted(() => {
  loadIntegration()
  loadWebhook()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-lg font-semibold text-(--ui-text-highlighted) mb-1">Integrations</h1>
        <p class="text-sm text-(--ui-text-muted)">
          Connect a project tracker to automatically create issues from bug reels.
        </p>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="settings-card space-y-4">
      <div class="h-4 w-48 rounded bg-(--ui-bg) animate-pulse" />
      <div class="h-10 w-full rounded bg-(--ui-bg) animate-pulse" />
      <div class="h-10 w-full rounded bg-(--ui-bg) animate-pulse" />
    </div>

    <!-- Connected state -->
    <div v-else-if="currentIntegration && !selectedProvider" class="space-y-6">
      <div class="settings-card space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Linear / Jira logo -->
            <svg v-if="currentIntegration.provider === 'linear'" class="w-5 h-5" viewBox="0 0 100 100" fill="currentColor"><path d="M1.22541 61.5228c-.97437 2.2107.67508 4.8855 3.04498 4.8855 1.21745 0 2.33584-.684 2.88498-1.7683l28.8001-56.8116c1.2869-2.53813-.5765-5.4844-3.3628-5.3155-1.2207.0739-2.2928.8074-2.8271 1.934L1.22541 61.5228ZM21.9282 73.128c-1.4791 2.233.3765 5.2066 3.0523 4.8953 1.1506-.1338 2.1375-.882 2.618-1.989L52.7999 17.2246c1.0832-2.4997-.7741-5.2246-3.4633-5.0863-1.1696.0602-2.1942.7877-2.7232 1.9257L21.9282 73.128ZM42.2913 84.8795c-1.7076 2.2335.1916 5.3702 3.0732 5.0835 1.1086-.1103 2.0758-.8327 2.5766-1.9252L73.34 37.0486c.996-2.1724-.4606-4.6742-2.8268-4.8519-1.1968-.0898-2.3344.5326-2.9695 1.6189L42.2913 84.8795ZM62.8382 96.4565c-1.6501 2.1877.1247 5.2645 2.9523 5.0555.948-.0701 1.8124-.552 2.3135-1.2913.0461-.068.0909-.1377.1344-.2088L98.0547 37.2924c1.0035-2.1909-.4511-4.7088-2.835-4.8987-1.2057-.0961-2.358.5291-2.9928 1.6229L62.8382 96.4565Z"/></svg>
            <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53ZM6.77 7.17c0 2.4 1.96 4.35 4.34 4.35h1.78v1.7c0 2.4 1.97 4.35 4.35 4.35V7.99a.84.84 0 0 0-.84-.82H6.77ZM2 12.31c0 2.4 1.97 4.35 4.35 4.36h1.78v1.7c.01 2.39 1.97 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.84L2 12.31Z"/></svg>
            <div>
              <p class="text-sm font-medium text-(--ui-text)">
                {{ currentIntegration.provider === 'linear' ? 'Linear' : 'Jira' }}
              </p>
              <p v-if="currentIntegration.teamOrProject" class="text-xs text-(--ui-text-dimmed) mt-0.5">
                {{ currentIntegration.provider === 'linear' ? 'Team' : 'Project' }}: {{ currentIntegration.teamOrProject }}
              </p>
            </div>
          </div>
          <UBadge label="Connected" color="success" variant="subtle" />
        </div>
      </div>

      <div class="flex gap-2">
        <UButton
          label="Reconfigure"
          icon="i-lucide-settings"
          size="sm"
          variant="outline"
          color="neutral"
          @click="startReconfigure"
        />
        <UButton
          label="Remove integration"
          icon="i-lucide-trash-2"
          size="sm"
          variant="soft"
          color="error"
          :loading="removing"
          @click="removeIntegration"
        />
      </div>
    </div>

    <!-- Provider selection + configuration -->
    <template v-else-if="!loading">
      <!-- Provider cards -->
      <div>
        <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-3">Choose a provider</p>
        <div class="grid grid-cols-2 gap-3 max-w-md">
          <button
            class="provider-card"
            :class="{ 'provider-card-active': selectedProvider === 'linear' }"
            @click="selectProvider('linear')"
          >
            <svg class="w-5 h-5" viewBox="0 0 100 100" fill="currentColor"><path d="M1.22541 61.5228c-.97437 2.2107.67508 4.8855 3.04498 4.8855 1.21745 0 2.33584-.684 2.88498-1.7683l28.8001-56.8116c1.2869-2.53813-.5765-5.4844-3.3628-5.3155-1.2207.0739-2.2928.8074-2.8271 1.934L1.22541 61.5228ZM21.9282 73.128c-1.4791 2.233.3765 5.2066 3.0523 4.8953 1.1506-.1338 2.1375-.882 2.618-1.989L52.7999 17.2246c1.0832-2.4997-.7741-5.2246-3.4633-5.0863-1.1696.0602-2.1942.7877-2.7232 1.9257L21.9282 73.128ZM42.2913 84.8795c-1.7076 2.2335.1916 5.3702 3.0732 5.0835 1.1086-.1103 2.0758-.8327 2.5766-1.9252L73.34 37.0486c.996-2.1724-.4606-4.6742-2.8268-4.8519-1.1968-.0898-2.3344.5326-2.9695 1.6189L42.2913 84.8795ZM62.8382 96.4565c-1.6501 2.1877.1247 5.2645 2.9523 5.0555.948-.0701 1.8124-.552 2.3135-1.2913.0461-.068.0909-.1377.1344-.2088L98.0547 37.2924c1.0035-2.1909-.4511-4.7088-2.835-4.8987-1.2057-.0961-2.358.5291-2.9928 1.6229L62.8382 96.4565Z"/></svg>
            <span class="text-sm font-medium">Linear</span>
          </button>
          <button
            class="provider-card"
            :class="{ 'provider-card-active': selectedProvider === 'jira' }"
            @click="selectProvider('jira')"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53ZM6.77 7.17c0 2.4 1.96 4.35 4.34 4.35h1.78v1.7c0 2.4 1.97 4.35 4.35 4.35V7.99a.84.84 0 0 0-.84-.82H6.77ZM2 12.31c0 2.4 1.97 4.35 4.35 4.36h1.78v1.7c.01 2.39 1.97 4.34 4.35 4.34v-9.57a.84.84 0 0 0-.84-.84L2 12.31Z"/></svg>
            <span class="text-sm font-medium">Jira</span>
          </button>
        </div>
      </div>

      <!-- Linear form -->
      <div v-if="selectedProvider === 'linear'" class="settings-card space-y-4">
        <UFormField label="API Key">
          <UInput
            v-model="linearApiKey"
            type="password"
            placeholder="lin_api_..."
            class="w-full"
          />
        </UFormField>

        <div class="flex items-center gap-2">
          <UButton
            label="Test connection"
            icon="i-lucide-zap"
            size="sm"
            variant="outline"
            color="neutral"
            :loading="testing"
            :disabled="!canTest"
            @click="testConnection"
          />
          <UBadge v-if="testSuccess" label="Connection successful" color="success" variant="subtle" />
        </div>

        <UFormField v-if="linearTeams.length" label="Team">
          <USelect
            v-model="linearSelectedTeam"
            :items="linearTeams"
            placeholder="Select a team"
            class="w-full"
          />
        </UFormField>

        <div v-if="linearTeams.length" class="flex justify-end">
          <UButton
            label="Save"
            icon="i-lucide-check"
            size="sm"
            :loading="saving"
            :disabled="!canSave"
            @click="saveIntegration"
          />
        </div>
      </div>

      <!-- Jira form -->
      <div v-if="selectedProvider === 'jira'" class="settings-card space-y-4">
        <UFormField label="Site URL">
          <UInput
            v-model="jiraSiteUrl"
            placeholder="mycompany.atlassian.net"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Email">
          <UInput
            v-model="jiraEmail"
            type="email"
            placeholder="you@company.com"
            class="w-full"
          />
        </UFormField>

        <UFormField label="API Token">
          <UInput
            v-model="jiraApiToken"
            type="password"
            placeholder="Your Jira API token"
            class="w-full"
          />
        </UFormField>

        <div class="flex items-center gap-2">
          <UButton
            label="Test connection"
            icon="i-lucide-zap"
            size="sm"
            variant="outline"
            color="neutral"
            :loading="testing"
            :disabled="!canTest"
            @click="testConnection"
          />
          <UBadge v-if="testSuccess" label="Connection successful" color="success" variant="subtle" />
        </div>

        <UFormField v-if="jiraProjects.length" label="Project">
          <USelect
            v-model="jiraSelectedProject"
            :items="jiraProjects"
            placeholder="Select a project"
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="jiraIssueTypes.length" label="Issue type">
          <USelect
            v-model="jiraSelectedIssueType"
            :items="jiraIssueTypes"
            placeholder="Select an issue type"
            class="w-full"
          />
        </UFormField>

        <div v-if="jiraProjects.length" class="flex justify-end">
          <UButton
            label="Save"
            icon="i-lucide-check"
            size="sm"
            :loading="saving"
            :disabled="!canSave"
            @click="saveIntegration"
          />
        </div>
      </div>
    </template>

    <!-- Error alert -->
    <UAlert v-if="error" color="error" variant="soft" :description="error" />

    <!-- ── Notifications (Webhook) ─────────────────────────────────────────── -->
    <div class="section-divider">
      <span class="section-divider-label">Notifications</span>
    </div>

    <!-- Webhook loading skeleton -->
    <div v-if="webhookLoading" class="settings-card space-y-4">
      <div class="h-4 w-48 rounded bg-(--ui-bg) animate-pulse" />
      <div class="h-10 w-full rounded bg-(--ui-bg) animate-pulse" />
    </div>

    <!-- Webhook connected state -->
    <div v-else-if="currentWebhook" class="space-y-4">
      <div class="settings-card space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-(--ui-text-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <div>
              <p class="text-sm font-medium text-(--ui-text)">Webhook</p>
              <p class="text-xs text-(--ui-text-dimmed) mt-0.5 font-mono truncate">{{ currentWebhook.url }}</p>
            </div>
          </div>
          <UBadge label="Connected" color="success" variant="subtle" />
        </div>
        <div class="flex flex-wrap gap-2 text-xs text-(--ui-text-muted)">
          <span v-if="currentWebhook.events?.includes('new_reel')" class="webhook-event-tag">New recording</span>
          <span v-if="currentWebhook.events?.includes('new_comment')" class="webhook-event-tag">New comment</span>
          <span v-if="currentWebhook.events?.includes('reel_done')" class="webhook-event-tag">Reel marked done</span>
        </div>
      </div>

      <div class="flex gap-2">
        <UButton
          label="Reconfigure"
          icon="i-lucide-settings"
          size="sm"
          variant="outline"
          color="neutral"
          @click="currentWebhook = null"
        />
        <UButton
          label="Remove"
          icon="i-lucide-trash-2"
          size="sm"
          variant="soft"
          color="error"
          :loading="webhookRemoving"
          @click="removeWebhook"
        />
      </div>
    </div>

    <!-- Webhook configuration form -->
    <div v-else class="settings-card space-y-4">
      <p class="text-sm text-(--ui-text-muted)">
        Receive notifications via Slack, Discord, Mattermost, or any webhook-compatible service.
      </p>

      <UFormField label="Webhook URL">
        <UInput
          v-model="webhookUrl"
          placeholder="https://hooks.slack.com/..."
          class="w-full"
        />
      </UFormField>

      <div>
        <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2">Events</p>
        <div class="flex flex-col gap-2">
          <UCheckbox
            v-model="webhookEvents.new_reel"
            label="New recording"
          />
          <UCheckbox
            v-model="webhookEvents.new_comment"
            label="New comment"
          />
          <UCheckbox
            v-model="webhookEvents.reel_done"
            label="Reel marked done"
          />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <UButton
          label="Test webhook"
          icon="i-lucide-zap"
          size="sm"
          variant="outline"
          color="neutral"
          :loading="webhookTesting"
          :disabled="!webhookUrl.trim()"
          @click="testWebhook"
        />
        <UBadge v-if="webhookTestSuccess" label="Test successful" color="success" variant="subtle" />
      </div>

      <div v-if="webhookTestSuccess" class="flex justify-end">
        <UButton
          label="Save"
          icon="i-lucide-check"
          size="sm"
          :loading="webhookSaving"
          @click="saveWebhook"
        />
      </div>
    </div>

    <!-- Webhook error alert -->
    <UAlert v-if="webhookError" color="error" variant="soft" :description="webhookError" />
  </div>
</template>

<style scoped>
.settings-card {
  padding: 1.25rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated);
}

.provider-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.25rem 1rem;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  transition: all 0.15s;
  cursor: pointer;
}

.provider-card:hover {
  border-color: var(--ui-text-dimmed);
  color: var(--ui-text);
}

.provider-card-active {
  border-color: #ff4070;
  color: white;
  background: rgba(255, 64, 112, 0.06);
}

.section-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.section-divider::before,
.section-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--ui-border);
}

.section-divider-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ui-text-muted);
  white-space: nowrap;
}

.webhook-event-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  font-size: 0.6875rem;
}
</style>
