export interface ApiToken { id: string; name: string; created_at: number; created_by_email: string | null }

export function useAppTokens(appId: string, headers: ComputedRef<Record<string, string>>) {
  const { data: apiTokens, refresh: refreshTokens } = useFetch<ApiToken[]>(`/api/apps/${appId}/tokens`, { headers })

  const tokenModalOpen = ref(false)
  const newTokenName = ref('')
  const newTokenLoading = ref(false)
  const newTokenError = ref('')
  const createdToken = ref<string | null>(null)
  const copiedToken = ref(false)
  const copiedEndpoint = ref(false)
  const copiedSnippet = ref(false)

  const origin = import.meta.client ? window.location.origin : ''

  const endpointUrl = computed(() => {
    if (!createdToken.value) return ''
    return `${origin}/api/ingest?token=${createdToken.value}`
  })

  const sdkSnippetText = computed(() => {
    if (!endpointUrl.value) return ''
    return '<script src="' + origin + '/sdk/recorder.js" data-endpoint="' + endpointUrl.value + '"></' + 'script>'
  })

  async function copyTokenValue(val: string) {
    await navigator.clipboard.writeText(val)
    copiedToken.value = true
    setTimeout(() => { copiedToken.value = false }, 2000)
  }

  async function copyEndpoint() {
    await navigator.clipboard.writeText(endpointUrl.value)
    copiedEndpoint.value = true
    setTimeout(() => { copiedEndpoint.value = false }, 2000)
  }

  async function copySnippetText() {
    await navigator.clipboard.writeText(sdkSnippetText.value)
    copiedSnippet.value = true
    setTimeout(() => { copiedSnippet.value = false }, 2000)
  }

  async function createToken() {
    if (!newTokenName.value.trim()) return
    newTokenLoading.value = true
    newTokenError.value = ''
    try {
      const data = await $fetch<{ id: string; name: string; token: string; created_at: number }>(
        `/api/apps/${appId}/tokens`,
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

  function closeTokenModal() {
    tokenModalOpen.value = false
    createdToken.value = null
    newTokenName.value = ''
    newTokenError.value = ''
    copiedToken.value = false
    copiedEndpoint.value = false
    copiedSnippet.value = false
  }

  const deleteTokenModalOpen = ref(false)
  const tokenToDelete = ref<ApiToken | null>(null)
  const deleteTokenLoading = ref(false)

  function confirmDeleteToken(t: ApiToken) {
    tokenToDelete.value = t
    deleteTokenModalOpen.value = true
  }

  async function deleteToken() {
    if (!tokenToDelete.value) return
    deleteTokenLoading.value = true
    try {
      await $fetch(`/api/apps/${appId}/tokens/${tokenToDelete.value.id}`, {
        method: 'DELETE',
        headers: headers.value,
      })
      deleteTokenModalOpen.value = false
      tokenToDelete.value = null
      await refreshTokens()
    } finally {
      deleteTokenLoading.value = false
    }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString()
  }

  return {
    apiTokens,
    refreshTokens,
    tokenModalOpen,
    newTokenName,
    newTokenLoading,
    newTokenError,
    createdToken,
    copiedToken,
    copiedEndpoint,
    copiedSnippet,
    endpointUrl,
    sdkSnippetText,
    copyTokenValue,
    copyEndpoint,
    copySnippetText,
    createToken,
    closeTokenModal,
    deleteTokenModalOpen,
    tokenToDelete,
    deleteTokenLoading,
    confirmDeleteToken,
    deleteToken,
    formatDate,
  }
}
