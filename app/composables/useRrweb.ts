let loadPromise: Promise<void> | null = null

export function useRrweb(): Promise<void> {
  if (!import.meta.client) return Promise.resolve()
  if ((window as any).rrweb) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = new Promise<void>((resolve, reject) => {
    // Load CSS
    if (!document.querySelector('link[href="/rrweb.css"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/rrweb.css'
      document.head.appendChild(link)
    }

    const script = document.createElement('script')
    script.src = '/rrweb.umd.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load rrweb'))
    document.head.appendChild(script)
  })

  return loadPromise
}
