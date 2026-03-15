/**
 * content.js — Injected at document_start on every page load.
 *
 * Architecture:
 *  - Console capture  : inline <script> in page context → postMessage → content script
 *  - DOM capture      : rrweb injected as page-context <script src> (bypasses Firefox
 *                       XRay vision so React/Vue/etc. value setters are visible)
 *  - Periodic flush   : rrweb events are sent to background.js every 3 s so that
 *                       full-page navigations don't lose data. On each new page load
 *                       the content script auto-resumes recording if one is active.
 *  - Font inlining    : content script fetches fonts (has <all_urls> permission) and
 *                       injects a <style> before rrweb takes its snapshot
 *  - Network capture  : background.js (webRequest API)
 */

// ── 1. Console interceptor (page context) ────────────────────────────────────

(function injectConsoleInterceptor() {
  const script = document.createElement('script');
  script.textContent = `(function () {
    const METHODS = ['log', 'info', 'warn', 'error', 'debug', 'table', 'trace'];
    const original = {};

    function serialize(arg) {
      if (arg === null || arg === undefined) return String(arg);
      if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg;
      try { return JSON.parse(JSON.stringify(arg)); } catch (_) { return String(arg); }
    }

    METHODS.forEach(function (method) {
      original[method] = console[method].bind(console);
      console[method] = function () {
        const args = Array.prototype.slice.call(arguments).map(serialize);
        try { window.postMessage({ __bugreel_type: 'console', level: method, args: args }, '*'); } catch (_) {}
        original[method].apply(console, arguments);
      };
    });

    window.addEventListener('error', function (e) {
      window.postMessage({ __bugreel_type: 'console', level: 'error', args: ['Uncaught ' + e.message, e.filename + ':' + e.lineno + ':' + e.colno] }, '*');
    });

    window.addEventListener('unhandledrejection', function (e) {
      window.postMessage({ __bugreel_type: 'console', level: 'error', args: ['Unhandled Promise Rejection:', String(e.reason)] }, '*');
    });
  })();`;
  document.documentElement.appendChild(script);
  script.remove();
})();

// ── 2. Inject rrweb + recorder into PAGE context ─────────────────────────────
// rrweb runs as a real page script so it sees React/Vue native value setters
// without Firefox's XRay wrapping.
//
// Periodic flush: every 3 s, the page-context script sends accumulated events
// as a 'batch' postMessage. The content script relays them to background.js.
// This way, a full-page navigation only loses at most 3 s of events — the rest
// are already safe in the persistent background script.

(function injectPageRecorder() {
  const rrwebScript = document.createElement('script');
  rrwebScript.src = browser.runtime.getURL('lib/rrweb.min.js');
  document.documentElement.appendChild(rrwebScript);

  const ctrl = document.createElement('script');
  ctrl.textContent = `(function () {
    let stopFn = null;
    let rrwebEvents = [];
    let flushTimer = null;

    function flushBatch() {
      if (rrwebEvents.length === 0) return;
      window.postMessage({ __bugreel_type: 'batch', events: rrwebEvents.splice(0) }, '*');
    }

    window.addEventListener('__bugreel_start__', function (e) {
      rrwebEvents = [];
      if (!window.rrweb) {
        window.dispatchEvent(new CustomEvent('__bugreel_error__', { detail: 'rrweb not loaded' }));
        return;
      }
      try {
        stopFn = window.rrweb.record({
          emit: function (event) { rrwebEvents.push(event); },
          checkoutEveryNth: 200,
          // No masking except passwords — we want all input values
          maskInputOptions: { password: true },
          // Capture programmatic value changes (React setState, etc.)
          userTriggeredOnInput: false,
          inlineStylesheet: true,
        });
        // Flush to background every 3 s so page navigations don't lose data
        flushTimer = setInterval(flushBatch, 3000);
      } catch (err) {
        window.dispatchEvent(new CustomEvent('__bugreel_error__', { detail: String(err) }));
      }
    });

    window.addEventListener('__bugreel_stop__', function () {
      // Clear the periodic timer first to avoid a race with the final flush
      clearInterval(flushTimer);
      flushTimer = null;
      if (stopFn) { stopFn(); stopFn = null; }
      // Final flush: send all remaining events
      window.postMessage({ __bugreel_type: 'data', events: rrwebEvents.splice(0) }, '*');
    });
  })();`;
  document.documentElement.appendChild(ctrl);
  ctrl.remove();
})();

// ── 3. Navigation tracker (page context) ─────────────────────────────────────
// Monkey-patches history.pushState/replaceState to emit postMessage events.
// popstate/hashchange are already reachable from page context.

(function injectNavigationTracker() {
  const script = document.createElement('script');
  script.textContent = `(function () {
    function emitNav(url) {
      try {
        var resolved = url ? new URL(String(url), location.href).href : location.href;
        window.postMessage({ __bugreel_type: 'navigate', url: resolved }, '*');
      } catch (_) {}
    }
    var origPush    = history.pushState.bind(history);
    var origReplace = history.replaceState.bind(history);
    history.pushState = function() { origPush.apply(history, arguments); emitNav(arguments[2]); };
    history.replaceState = function() { origReplace.apply(history, arguments); emitNav(arguments[2]); };
    window.addEventListener('popstate',   function() { emitNav(location.href); });
    window.addEventListener('hashchange', function() { emitNav(location.href); });
  })();`;
  document.documentElement.appendChild(script);
  script.remove();
})();

// ── 4. State ──────────────────────────────────────────────────────────────────

let isRecording = false;
let consoleEvents = [];
let interactionEvents = [];
let startTime = null;
const inputDebounceTimers = new WeakMap();

// Resolves the pending stopRecording promise once the final flush reaches background.
let pendingStopResolve = null;

// ── 5. Relay page-context messages to background ──────────────────────────────

window.addEventListener('message', (e) => {
  if (!e.data || !e.data.__bugreel_type) return;

  if (e.data.__bugreel_type === 'console') {
    if (!isRecording) return;
    consoleEvents.push({ time: Date.now() - startTime, level: e.data.level, args: e.data.args });
  }

  if (e.data.__bugreel_type === 'navigate') {
    if (!isRecording) return;
    interactionEvents.push({ time: Date.now() - startTime, type: 'navigate', url: e.data.url });
  }

  // Periodic flush batch: relay to background.js for safe keeping
  if (e.data.__bugreel_type === 'batch') {
    if (!isRecording) return;
    const consoleBatch = consoleEvents.splice(0);
    const interactionBatch = interactionEvents.splice(0);
    browser.runtime.sendMessage({
      action: 'flushEvents',
      rrwebEvents: e.data.events,
      consoleEvents: consoleBatch,
      interactionEvents: interactionBatch,
    }).catch(() => {});
  }

  // Final data after __bugreel_stop__ — relay to background then resolve the stop promise
  if (e.data.__bugreel_type === 'data') {
    const consoleBatch = consoleEvents.splice(0);
    const interactionBatch = interactionEvents.splice(0);
    browser.runtime.sendMessage({
      action: 'flushEvents',
      rrwebEvents: e.data.events || [],
      consoleEvents: consoleBatch,
      interactionEvents: interactionBatch,
    }).then(() => {
      if (pendingStopResolve) { pendingStopResolve({ success: true }); pendingStopResolve = null; }
    }).catch(() => {
      if (pendingStopResolve) { pendingStopResolve({ success: true }); pendingStopResolve = null; }
    });
  }
});

// ── 6. Interaction capture (click + input) ────────────────────────────────────

function getInteractionLabel(el) {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    el.getAttribute('name') ||
    el.id ||
    el.textContent?.trim() ||
    ''
  ).trim().slice(0, 80);
}

document.addEventListener('click', (e) => {
  if (!isRecording) return;
  const el = e.target;
  // Walk up to find the nearest <a> so link clicks capture the destination URL
  const link = el.closest ? el.closest('a[href]') : null;
  if (link) {
    interactionEvents.push({
      time: Date.now() - startTime,
      type: 'click',
      target: 'a',
      label: (link.textContent?.trim() || link.getAttribute('aria-label') || '').slice(0, 80),
      href: link.href,
    });
  } else {
    interactionEvents.push({
      time: Date.now() - startTime,
      type: 'click',
      target: el.tagName?.toLowerCase() || 'unknown',
      label: getInteractionLabel(el),
    });
  }
}, true);

window.addEventListener('popstate', () => {
  if (!isRecording) return;
  interactionEvents.push({ time: Date.now() - startTime, type: 'navigate', url: location.href });
});
window.addEventListener('hashchange', () => {
  if (!isRecording) return;
  interactionEvents.push({ time: Date.now() - startTime, type: 'navigate', url: location.href });
});

document.addEventListener('input', (e) => {
  if (!isRecording) return;
  const el = e.target;
  if (inputDebounceTimers.has(el)) clearTimeout(inputDebounceTimers.get(el));
  const t = setTimeout(() => {
    const isPassword = el.type === 'password';
    interactionEvents.push({
      time: Date.now() - startTime,
      type: 'input',
      target: el.tagName?.toLowerCase() || 'input',
      label: getInteractionLabel(el),
      value: isPassword ? '••••••' : (el.value || '').slice(0, 200),
    });
    inputDebounceTimers.delete(el);
  }, 600);
  inputDebounceTimers.set(el, t);
}, true);

// ── 7. Font inlining (content script has <all_urls> fetch permission) ─────────

async function inlineFonts() {
  const rules = [];
  for (const sheet of document.styleSheets) {
    let cssRules;
    try { cssRules = sheet.cssRules; } catch (_) { continue; }
    for (const rule of cssRules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) rules.push(rule);
    }
  }
  if (rules.length === 0) return;

  const inlinedParts = await Promise.all(
    rules.map(async (rule) => {
      let cssText = rule.cssText;
      const matches = [...cssText.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g)];
      for (const [fullMatch, url] of matches) {
        try {
          const abs = new URL(url, document.baseURI).href;
          const resp = await fetch(abs);
          const blob = await resp.blob();
          const base64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result);
            reader.readAsDataURL(blob);
          });
          cssText = cssText.replace(fullMatch, `url("${base64}")`);
        } catch (_) { /* unresolvable font — leave as-is */ }
      }
      return cssText;
    })
  );

  document.getElementById('__bugreel_fonts__')?.remove();
  const style = document.createElement('style');
  style.id = '__bugreel_fonts__';
  style.textContent = inlinedParts.join('\n');
  document.head.appendChild(style);
}

// ── 8. Auto-resume recording on page load ─────────────────────────────────────
// When the user navigates to a new page during an active recording, this new
// content script instance auto-starts rrweb so the recording continues seamlessly.

browser.runtime.sendMessage({ action: 'getState' }).then((state) => {
  // background only returns isRecording=true if this tab is the one being recorded
  if (state && state.isRecording) {
    isRecording = true;
    startTime = state.startTime;
    inlineFonts().then(() => {
      window.dispatchEvent(new CustomEvent('__bugreel_start__'));
    });
  }
}).catch(() => {});

// ── 9. pagehide: best-effort flush before the page is destroyed ───────────────
// Stops rrweb on this page and sends remaining events to background.
// isRecording intentionally stays true — the next page will auto-resume.

window.addEventListener('pagehide', () => {
  if (!isRecording) return;
  window.dispatchEvent(new CustomEvent('__bugreel_stop__'));
  // The 'data' message handler above will relay events to background.
  // Whether it completes depends on Firefox timing, but the periodic flush
  // (every 3 s) already covers most of the events.
});

// ── 10. Message handler (from popup.js) ───────────────────────────────────────

browser.runtime.onMessage.addListener((message) => {
  switch (message.action) {

    case 'startRecording': {
      if (isRecording) return Promise.resolve({ success: true });
      isRecording = true;
      consoleEvents = [];
      interactionEvents = [];
      startTime = message.startTime;

      return inlineFonts().then(() => {
        window.dispatchEvent(new CustomEvent('__bugreel_start__'));
        return { success: true };
      });
    }

    case 'stopRecording': {
      if (!isRecording) return Promise.resolve({ success: true });
      isRecording = false;

      // Dispatch stop to page context. The page-context script will send a
      // final 'data' postMessage. The message handler above relays it to
      // background.js then resolves this promise.
      return new Promise((resolve) => {
        pendingStopResolve = resolve;
        window.dispatchEvent(new CustomEvent('__bugreel_stop__'));
      });
    }

    case 'getState': {
      return Promise.resolve({ isRecording });
    }
  }
});
