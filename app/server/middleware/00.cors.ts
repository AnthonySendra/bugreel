export default defineEventHandler((event) => {
  const path = event.path

  // CORS headers for SDK, recorder libs, and API endpoints used by SDK/extension
  if (
    path.startsWith('/sdk/') ||
    path.startsWith('/recorder-lib/') ||
    path.startsWith('/api/recorder-lib/') ||
    path.startsWith('/api/apps/')
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
