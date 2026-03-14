<script setup lang="ts">
const props = defineProps<{
  reelId: string
  token: string | null
}>()

const mount = ref<HTMLElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')

let replayer: any = null

async function init() {
  if (!mount.value) return

  try {
    await useRrweb()

    const headers: Record<string, string> = props.token
      ? { Authorization: `Bearer ${props.token}` }
      : {}

    const data = await $fetch<{ events: any[] }>(`/api/reels/${props.reelId}/thumb`, { headers })
    const events = sanitizeRrwebEvents(data.events)

    if (!events?.length) {
      status.value = 'error'
      return
    }

    // Dimensions from Meta event (type 4)
    const metaEvent = events.find((e: any) => e.type === 4)
    const pageWidth  = metaEvent?.data?.width  || 1280
    const pageHeight = metaEvent?.data?.height || 720

    // Container dimensions
    const containerW = mount.value.clientWidth  || 320
    const containerH = mount.value.clientHeight || 180
    const scale = Math.min(containerW / pageWidth, containerH / pageHeight)

    // Inner div that rrweb renders into
    const inner = document.createElement('div')
    Object.assign(inner.style, {
      width:           `${pageWidth}px`,
      height:          `${pageHeight}px`,
      transform:       `scale(${scale})`,
      transformOrigin: 'top left',
      position:        'absolute',
      pointerEvents:   'none',
    })
    mount.value.style.position = 'relative'
    mount.value.style.overflow = 'hidden'
    mount.value.appendChild(inner)

    const rrweb = (window as any).rrweb
    replayer = new rrweb.Replayer(events, {
      root: inner,
      speed: 1,
      showWarning: false,
      showDebug: false,
      triggerFocus: false,
      UNSAFE_replayCanvas: false,
      pauseAnimation: true,
      useVirtualDom: false,
    })

    // Render first frame
    replayer.pause(0)
    status.value = 'ready'
  } catch {
    status.value = 'error'
  }
}

onMounted(() => {
  init()
})

onUnmounted(() => {
  replayer?.pause?.()
  replayer = null
})
</script>

<template>
  <div ref="mount" class="reel-thumb-wrap">
    <!-- Spinner while loading -->
    <div v-if="status === 'loading'" class="reel-thumb-center">
      <UIcon name="i-lucide-loader-circle" class="w-5 h-5 animate-spin text-(--ui-text-dimmed)" />
    </div>
    <!-- Fallback on error -->
    <div v-else-if="status === 'error'" class="reel-thumb-center">
      <UIcon name="i-lucide-film" class="w-7 h-7 text-(--ui-text-dimmed)" />
    </div>
    <!-- rrweb mount is appended to `mount` div directly via JS -->
  </div>
</template>

<style scoped>
.reel-thumb-wrap {
  width: 100%;
  height: 100%;
  background: #0a0a0b;
  overflow: hidden;
}

.reel-thumb-center {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Kill pointer events on the rrweb iframe */
.reel-thumb-wrap :deep(iframe) {
  pointer-events: none;
}
.reel-thumb-wrap :deep(.replayer-wrapper) {
  pointer-events: none;
}
.reel-thumb-wrap :deep(.replayer-mouse),
.reel-thumb-wrap :deep(.replayer-mouse-tail) {
  display: none !important;
}
</style>
