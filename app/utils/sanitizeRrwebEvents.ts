// Sanitize rrweb events for safe replay:
// 1. Strip <link rel="preload|prefetch|modulepreload"> (CORS errors)
// 2. Neutralize @font-face src urls in inlined CSS (CORS font loading)

function isProblematicLink(node: any): boolean {
  if (!node) return false
  if (node.type !== 2 /* NodeType.Element */) return false
  if (node.tagName?.toLowerCase() !== 'link') return false
  const rel = (node.attributes?.rel || '').toLowerCase()
  return rel.includes('preload') || rel.includes('prefetch') || rel.includes('modulepreload')
}

// Neutralize external url() references inside @font-face blocks.
// This prevents CORS errors when the replayer iframe tries to fetch fonts
// from the recorded origin. Fonts captured via rrweb collectFonts are
// injected separately and don't rely on these CSS rules.
function stripFontFaceBlocks(css: string): string {
  // Remove entire @font-face blocks — fonts are injected separately from base64 data
  return css.replace(/@font-face\s*\{[^}]*\}/gi, '')
}

function processNode(node: any): void {
  if (!node) return

  // Neutralize @font-face urls in _cssText (inlined stylesheets via inlineStylesheet: true)
  if (node.type === 2 /* Element */ && node.attributes?._cssText) {
    node.attributes._cssText = stripFontFaceBlocks(node.attributes._cssText)
  }

  // Also handle <style> text content
  if (node.type === 2 && node.tagName?.toLowerCase() === 'style' && node.childNodes?.length) {
    for (const child of node.childNodes) {
      if (child.type === 3 /* Text */ && child.textContent) {
        child.textContent = stripFontFaceBlocks(child.textContent)
      }
    }
  }

  // Strip problematic links + recurse
  if (node.childNodes?.length) {
    node.childNodes = node.childNodes.filter((child: any) => {
      if (isProblematicLink(child)) return false
      processNode(child)
      return true
    })
  }
}

export function sanitizeRrwebEvents(events: any[]): any[] {
  return events.filter(event => {
    // Strip the synthetic end marker — it's only used for duration, not for replay
    if (event.type === 5 && event.data?.tag === 'bugreel-end') return false
    return true
  }).map(event => {
    // FullSnapshot (type 2): process the entire DOM tree
    if (event.type === 2) {
      const cloned = structuredClone(event)
      processNode(cloned.data.node)
      return cloned
    }

    // IncrementalSnapshot (type 3, source 0 = Mutation): process adds[]
    if (event.type === 3 && event.data?.source === 0 && event.data?.adds?.length) {
      const cloned = structuredClone(event)
      cloned.data.adds = cloned.data.adds.filter((add: any) => {
        if (isProblematicLink(add.node)) return false
        processNode(add.node)
        return true
      })
      return cloned
    }

    // IncrementalSnapshot (type 3, source 8 = StyleSheetRule): leave as-is
    // IncrementalSnapshot (type 3, source 13 = AdoptedStyleSheet): leave as-is

    return event
  })
}
