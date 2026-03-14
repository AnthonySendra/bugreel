// Strip <link rel="preload|prefetch|modulepreload"> from rrweb events.
// These cause CORS errors in the Replayer iframe because the browser tries to
// fetch external resources (fonts, RSC routes, etc.) from the recorded origin.

function isProblematicLink(node: any): boolean {
  if (!node) return false
  if (node.type !== 2 /* NodeType.Element */) return false
  if (node.tagName?.toLowerCase() !== 'link') return false
  const rel = (node.attributes?.rel || '').toLowerCase()
  return rel.includes('preload') || rel.includes('prefetch') || rel.includes('modulepreload')
}

function stripProblematicLinks(node: any): void {
  if (!node.childNodes?.length) return
  node.childNodes = node.childNodes.filter((child: any) => {
    if (isProblematicLink(child)) return false
    stripProblematicLinks(child)
    return true
  })
}

export function sanitizeRrwebEvents(events: any[]): any[] {
  return events.filter(event => {
    // Strip the synthetic end marker — it's only used for duration, not for replay
    if (event.type === 5 && event.data?.tag === 'bugreel-end') return false
    return true
  }).map(event => {
    // FullSnapshot (type 2): strip from the initial DOM tree
    if (event.type === 2) {
      const cloned = structuredClone(event)
      stripProblematicLinks(cloned.data.node)
      return cloned
    }

    // IncrementalSnapshot (type 3, source 0 = Mutation): strip from adds[]
    if (event.type === 3 && event.data?.source === 0 && event.data?.adds?.length) {
      const adds = event.data.adds.filter((add: any) => !isProblematicLink(add.node))
      if (adds.length === event.data.adds.length) return event
      return { ...event, data: { ...event.data, adds } }
    }

    return event
  })
}
