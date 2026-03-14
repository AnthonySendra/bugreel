function decodeJwt(t: string): { id: string; email: string } | null {
  try {
    return JSON.parse(atob(t.split('.')[1]))
  } catch {
    return null
  }
}

export const useAuth = () => {
  const token = useCookie('bugreel_token', { maxAge: 60 * 60 * 24 * 30 })

  const user = computed(() => token.value ? decodeJwt(token.value) : null)

  const login = (t: string) => { token.value = t }
  const logout = () => { token.value = null }
  const isLoggedIn = computed(() => !!token.value)

  return { token, user, login, logout, isLoggedIn }
}
