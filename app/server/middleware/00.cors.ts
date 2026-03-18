export default defineEventHandler((event) => {
  const path = event.path

  // CORS headers for API routes used by SDK/extension.
  // Static files (/sdk/*) get CORS via Nitro route rules
  // in nuxt.config.ts (route rules are baked into the build and apply even
  // when Nitro serves static assets directly, bypassing middleware).
  if (
    path.startsWith('/api/apps/') ||
    path.startsWith('/api/ingest/')
  ) {
    setResponseHeaders(event, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })

    // Handle preflight
    if (event.method === 'OPTIONS') {
      setResponseStatus(event, 204)
      return ''
    }
  }
})
