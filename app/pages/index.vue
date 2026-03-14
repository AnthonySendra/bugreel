<template>
  <div class="min-h-screen flex flex-col items-center justify-center gap-8 px-4">
    <div class="text-center space-y-4">
      <h1 class="text-6xl font-bold tracking-tight text-white">
        bugreel
      </h1>
      <p class="text-xl text-neutral-400">
        Self-hosted bug recording. No SaaS, no tracking.
      </p>
    </div>
    <div class="flex gap-4">
      <UButton
        to="/register"
        size="lg"
        label="Get started"
      />
      <UButton
        to="/login"
        size="lg"
        variant="outline"
        label="Sign in"
      />
    </div>
  </div>
</template>
