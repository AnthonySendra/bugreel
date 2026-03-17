<script setup lang="ts">
const props = defineProps<{
  appId: string
  headers: Record<string, string>
}>()

const headersRef = computed(() => props.headers)

const {
  apiTokens, tokenModalOpen, newTokenName, newTokenLoading, newTokenError,
  createdToken, copiedToken, copiedEndpoint, copiedSnippet, endpointUrl,
  sdkSnippetText, copyTokenValue, copyEndpoint, copySnippetText, createToken,
  closeTokenModal, deleteTokenModalOpen, tokenToDelete, deleteTokenLoading,
  confirmDeleteToken, deleteToken, formatDate,
} = useAppTokens(props.appId, headersRef)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-start justify-between">
      <div>
        <h1 class="text-lg font-semibold text-(--ui-text-highlighted) mb-1">API Tokens</h1>
        <p class="text-sm text-(--ui-text-muted)">
          Tokens connect the browser extension or SDK to this app.
        </p>
      </div>
      <UButton label="Create token" icon="i-lucide-plus" size="sm" @click="tokenModalOpen = true" />
    </div>

    <div v-if="!apiTokens?.length" class="empty-state-sm">
      <UIcon name="i-lucide-key-round" class="w-5 h-5 text-(--ui-text-dimmed)" />
      <p>No API tokens yet</p>
    </div>

    <div v-else class="token-list">
      <div
        v-for="t in apiTokens"
        :key="t.id"
        class="token-row group"
      >
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-(--ui-text)">{{ t.name }}</p>
          <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
            Created {{ formatDate(t.created_at) }}
            <template v-if="t.created_by_email"> by {{ t.created_by_email }}</template>
          </p>
        </div>
        <UButton
          icon="i-lucide-trash-2"
          size="xs"
          color="error"
          variant="ghost"
          class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          @click="confirmDeleteToken(t)"
        />
      </div>
    </div>

    <!-- Create token modal -->
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
                <UButton :icon="copiedToken ? 'i-lucide-check' : 'i-lucide-copy'" size="xs" variant="outline" class="shrink-0" @click="copyTokenValue(createdToken!)" />
              </div>
            </div>

            <!-- Endpoint URL -->
            <div>
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2 flex items-center gap-1.5">
                Endpoint URL
                <UTooltip text="Paste this URL in the browser extension popup to connect it to this app.">
                  <UIcon name="i-lucide-circle-help" class="w-3.5 h-3.5 text-(--ui-text-dimmed) cursor-help" />
                </UTooltip>
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-2 py-1.5 rounded-md text-(--ui-text-muted) truncate">{{ endpointUrl }}</code>
                <UButton
                  :icon="copiedEndpoint ? 'i-lucide-check' : 'i-lucide-copy'"
                  size="xs"
                  variant="outline"
                  class="shrink-0"
                  @click="copyEndpoint"
                />
              </div>
            </div>

            <!-- SDK snippet -->
            <div>
              <p class="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wider mb-2 flex items-center gap-1.5">
                SDK script tag
                <UTooltip text="Add this script tag to your website HTML to embed a Record Bug button — no extension needed.">
                  <UIcon name="i-lucide-circle-help" class="w-3.5 h-3.5 text-(--ui-text-dimmed) cursor-help" />
                </UTooltip>
              </p>
              <div class="flex items-center gap-2">
                <pre class="flex-1 text-[11px] font-mono bg-(--ui-bg-elevated) border border-(--ui-border) px-2 py-1.5 rounded-md text-(--ui-text-muted) whitespace-pre-wrap break-all leading-relaxed min-w-0">{{ sdkSnippetText }}</pre>
                <UButton
                  :icon="copiedSnippet ? 'i-lucide-check' : 'i-lucide-copy'"
                  size="xs"
                  variant="outline"
                  class="shrink-0"
                  @click="copySnippetText"
                />
              </div>
            </div>

            <!-- Ad-blocker warning -->
            <div class="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
              <UIcon name="i-lucide-shield-alert" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p class="text-xs text-(--ui-text-muted) leading-relaxed">
                <span class="font-medium text-amber-400">Ad blockers</span> can prevent the extension and SDK from connecting. Disable your ad blocker on the target site if recording doesn't work.
              </p>
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
    <UModal v-model:open="deleteTokenModalOpen" title="Delete API token">
      <template #body>
        <p class="text-sm text-(--ui-text-muted)">
          Are you sure you want to delete the token
          <span class="font-medium text-(--ui-text)">{{ tokenToDelete?.name }}</span>?
          Any extension or SDK using it will stop working.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Cancel" color="neutral" variant="outline" @click="deleteTokenModalOpen = false" />
          <UButton label="Delete" color="error" :loading="deleteTokenLoading" @click="deleteToken" />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.token-list {
  border-radius: 0.75rem;
  border: 1px solid var(--ui-border);
  overflow: hidden;
}
.token-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  transition: background 0.15s;
}
.token-row:not(:last-child) {
  border-bottom: 1px solid var(--ui-border);
}
.token-row:hover {
  background: rgba(255, 255, 255, 0.02);
}
.empty-state-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem;
  font-size: 0.875rem;
  color: var(--ui-text-muted);
  border: 1px dashed var(--ui-border);
  border-radius: 0.75rem;
}
</style>
