<script setup lang="ts">
const { token, logout, isLoggedIn } = useAuth()
const router = useRouter()
const route = useRoute()

// If not logged in, redirect to login
if (!isLoggedIn.value) {
  router.push('/login')
}

const resending = ref(false)
const resendSuccess = ref(false)
const resendError = ref('')
const verifying = ref(false)
const verifyError = ref('')

// Get user email from JWT
function getEmail(): string {
  if (!token.value) return ''
  try {
    const payload = JSON.parse(atob(token.value.split('.')[1]))
    return payload.email || ''
  } catch {
    return ''
  }
}

const email = getEmail()

async function resendEmail() {
  resending.value = true
  resendSuccess.value = false
  resendError.value = ''
  try {
    await $fetch('/api/auth/resend-verification', {
      method: 'POST',
      body: { email },
    })
    resendSuccess.value = true
  } catch (e: any) {
    resendError.value = e?.data?.message || 'Failed to resend email'
  } finally {
    resending.value = false
  }
}

// Handle ?token=xxx from email link
async function verifyToken(verificationToken: string) {
  verifying.value = true
  verifyError.value = ''
  try {
    await $fetch('/api/auth/verify-email', {
      method: 'POST',
      body: { token: verificationToken },
    })
    router.push('/dashboard')
  } catch (e: any) {
    verifyError.value = e?.data?.message || 'Verification failed'
    verifying.value = false
  }
}

// Check if there's a verification token in the URL
const verificationToken = route.query.token as string | undefined
if (verificationToken) {
  verifyToken(verificationToken)
}

// Poll to check if email has been verified (user clicked link in another tab)
let pollTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  pollTimer = setInterval(async () => {
    if (!token.value) return
    try {
      const me = await $fetch<{ email_verified: boolean }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      if (me.email_verified) {
        clearInterval(pollTimer)
        router.push('/dashboard')
      }
    } catch {
      // ignore
    }
  }, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

function handleLogout() {
  logout()
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold text-white">bugreel</h1>
        <p class="text-neutral-400">Verify your email</p>
      </div>

      <!-- Verifying token from URL -->
      <UCard v-if="verifying">
        <div class="flex items-center justify-center gap-3 py-4">
          <UIcon name="i-lucide-loader-circle" class="w-5 h-5 animate-spin text-bugreel-400" />
          <span class="text-sm text-(--ui-text-muted)">Verifying your email…</span>
        </div>
      </UCard>

      <!-- Main verify-email card -->
      <UCard v-else>
        <div class="space-y-4">
          <div class="verify-icon-wrap">
            <UIcon name="i-lucide-mail" class="w-8 h-8" />
          </div>

          <p class="text-sm text-(--ui-text-muted) text-center">
            We sent a verification link to
            <span class="font-medium text-(--ui-text)">{{ email }}</span>.
            Check your inbox and click the link to activate your account.
          </p>

          <UAlert
            v-if="verifyError"
            color="error"
            variant="soft"
            :description="verifyError"
          />

          <UAlert
            v-if="resendSuccess"
            color="success"
            variant="soft"
            description="Verification email sent! Check your inbox."
          />

          <UAlert
            v-if="resendError"
            color="error"
            variant="soft"
            :description="resendError"
          />

          <div class="flex flex-col gap-2">
            <UButton
              label="Resend verification email"
              variant="outline"
              class="w-full justify-center"
              :loading="resending"
              @click="resendEmail"
            />
            <UButton
              label="Logout"
              variant="ghost"
              color="neutral"
              class="w-full justify-center"
              @click="handleLogout"
            />
          </div>

          <p class="text-xs text-(--ui-text-dimmed) text-center">
            This page will automatically redirect once your email is verified.
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.verify-icon-wrap {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 1rem;
  background: rgba(255, 64, 112, 0.08);
  border: 1px solid rgba(255, 64, 112, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
  color: #ff4070;
}
</style>
