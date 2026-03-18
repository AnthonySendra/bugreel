export default defineNuxtConfig({
  runtimeConfig: {
    // JWT signing secret — REQUIRED in production (set NUXT_JWT_SECRET)
    jwtSecret: '',

    // S3-compatible storage (all optional — falls back to local disk when not set)
    // Env vars: NUXT_S3_REGION, NUXT_S3_ENDPOINT, NUXT_S3_BUCKET,
    //           NUXT_S3_ACCESS_KEY_ID, NUXT_S3_SECRET_ACCESS_KEY
    s3Region: '',          // e.g. "us-east-1" or "auto" for Cloudflare R2
    s3Endpoint: '',        // custom endpoint for R2 / MinIO (leave empty for AWS)
    s3Bucket: '',          // bucket name
    s3AccessKeyId: '',
    s3SecretAccessKey: '',

    // Email (all optional — when NUXT_EMAIL_PROVIDER is empty, email is disabled
    // and features like email verification are skipped)
    // NUXT_EMAIL_PROVIDER: 'smtp' | 'resend' | 'console' | '' (disabled)
    // NUXT_EMAIL_FROM: sender address, e.g. "Bugreel <noreply@example.com>"
    // SMTP: NUXT_EMAIL_SMTP_HOST, NUXT_EMAIL_SMTP_PORT, NUXT_EMAIL_SMTP_USER, NUXT_EMAIL_SMTP_PASS
    // Resend: NUXT_EMAIL_RESEND_API_KEY
    // NUXT_PUBLIC_BASE_URL: public URL for links in emails (default: http://localhost:7777)
    public: {
      baseUrl: '',
    },
  },
  modules: ['@nuxt/ui'],
  ui: {
    theme: {
      colors: ['bugreel'],
    },
  },
  css: ['~/assets/css/main.css'],
  devServer: { port: 7777, host: '::' },
  vite: {
    server: {
      cors: true,
    },
  },
  colorMode: { preference: 'dark' },
  nitro: {
    experimental: {
      wasm: false,
    },
    externals: {
      inline: [],
    },
    routeRules: {
      '/sdk/**': {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
      },
      '/workspace/**': { ssr: false },
      '/dashboard/**': { ssr: false },
      '/reel/**': { ssr: false },
    },
  },
})
