export default defineNuxtRouteMiddleware(async (to) => {
  const { isLoggedIn, token } = useAuth()
  if (!isLoggedIn.value) return navigateTo('/login')

  // Check email verification status
  if (to.path !== '/verify-email') {
    try {
      const me = await $fetch<{ email_verified: boolean }>('/api/auth/me', {
        headers: token.value ? { Authorization: `Bearer ${token.value}` } : {},
      })
      if (!me.email_verified) return navigateTo('/verify-email')
    } catch {
      // If /api/auth/me fails (e.g. email not configured), let through
    }
  }
})
