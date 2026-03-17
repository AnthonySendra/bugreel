<script setup lang="ts">
const { login } = useAuth()
const router = useRouter()

const state = reactive({
  email: '',
  password: '',
})

const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    const data = await $fetch<{ token: string; user: { id: string; email: string; email_verified: boolean } }>('/api/auth/register', {
      method: 'POST',
      body: { email: state.email, password: state.password },
    })
    login(data.token)
    router.push(data.user.email_verified ? '/dashboard' : '/verify-email')
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Registration failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center space-y-2">
        <h1 class="text-3xl font-bold text-white">
          bugreel
        </h1>
        <p class="text-neutral-400">
          Create your account
        </p>
      </div>

      <UCard>
        <form class="space-y-4" @submit.prevent="onSubmit">
          <UFormField label="Email" name="email">
            <UInput
              v-model="state.email"
              type="email"
              placeholder="you@example.com"
              required
              class="w-full"
            />
          </UFormField>

          <UFormField label="Password" name="password">
            <UInput
              v-model="state.password"
              type="password"
              placeholder="••••••••"
              required
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            :description="error"
          />

          <UButton
            type="submit"
            class="w-full justify-center"
            :loading="loading"
            label="Create account"
          />
        </form>
      </UCard>

      <p class="text-center text-sm text-neutral-400">
        Already have an account?
        <UButton to="/login" variant="link" label="Sign in" />
      </p>
    </div>
  </div>
</template>
