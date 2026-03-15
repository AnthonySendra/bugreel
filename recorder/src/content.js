/**
 * content.js — shared content script (Firefox MV2 + Chrome MV3)
 *
 * Firefox XRay vision: content scripts cannot see JS properties set by page
 * scripts (e.g. React overriding input.value). To bypass this, rrweb is
 * injected as a real page script via <script src>, so it runs in full page
 * context alongside the framework.
 */

const ext = typeof browser !== 'undefined' ? browser : chrome;

// ── 1. Console interceptor (injected into page context) ──────────────────────

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
        try { window.postMessage({ __bugreel_type: 'console', level: method, args }, '*'); } catch (_) {}
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

// ── 2. Inject rrweb + recorder into page context ──────────────────────────────

(function injectPageRecorder() {
  const rrwebScript = document.createElement('script');
  rrwebScript.src = ext.runtime.getURL('lib/rrweb.min.js');
  document.documentElement.appendChild(rrwebScript);

  const ctrl = document.createElement('script');
  ctrl.textContent = `(function () {
    let stopFn = null;
    let rrwebEvents = [];

    window.addEventListener('__bugreel_start__', function () {
      rrwebEvents = [];
      if (!window.rrweb) {
        window.dispatchEvent(new CustomEvent('__bugreel_error__', { detail: 'rrweb not loaded' }));
        return;
      }
      try {
        stopFn = window.rrweb.record({
          emit: function (event) { rrwebEvents.push(event); },
          checkoutEveryNth: 200,
          maskInputOptions: { password: true },
          userTriggeredOnInput: false,
          inlineStylesheet: true,
          // inlineImages uses canvas.toDataURL() which Firefox blocks via
          // anti-fingerprinting, causing rrweb to crash before setting up observers.
          // collectFonts is redundant — inlineFonts() already handles this.
          slimDOMOptions: {
            script: true,
            comment: true,
            headFavicon: false,
            headWhitespace: true,
            headMetaDescKeywords: true,
            headMetaSocial: true,
            headMetaRobots: true,
            headMetaHttpEquiv: true,
            headMetaAuthorship: true,
            headMetaVerification: true,
          },
        });
      } catch (err) {
        window.dispatchEvent(new CustomEvent('__bugreel_error__', { detail: String(err) }));
      }
    });

    window.addEventListener('__bugreel_stop__', function () {
      if (stopFn) { stopFn(); stopFn = null; }
      // Synthetic end marker so lastTs always reflects the real stop time,
      // even on static pages where rrweb emits no incremental events.
      if (rrwebEvents.length > 0) {
        rrwebEvents.push({ type: 5, timestamp: Date.now(), data: { tag: 'bugreel-end', payload: {} } });
      }
      // postMessage clones data at call time — avoids Firefox XRay lazy evaluation on CustomEvent.detail
      window.postMessage({ __bugreel_type: 'data', events: rrwebEvents }, '*');
      rrwebEvents = [];
    });
  })();`;
  document.documentElement.appendChild(ctrl);
  ctrl.remove();
})();

// ── 3. Navigation tracker (page context) ─────────────────────────────────────

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

// ── 5. Messages from page context (console + data + navigate) ─────────────────

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

// ── 5. Font inlining (content script has <all_urls> fetch permission) ─────────

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

  const parts = await Promise.all(rules.map(async (rule) => {
    let text = rule.cssText;
    for (const [full, url] of [...text.matchAll(/url\(['"]?([^'")\s]+)['"]?\)/g)]) {
      try {
        const abs = new URL(url, document.baseURI).href;
        const blob = await (await fetch(abs)).blob();
        const b64 = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.readAsDataURL(blob);
        });
        text = text.replace(full, `url("${b64}")`);
      } catch (_) {}
    }
    return text;
  }));

  document.getElementById('__bugreel_fonts__')?.remove();
  const style = document.createElement('style');
  style.id = '__bugreel_fonts__';
  style.textContent = parts.join('\n');
  document.head.appendChild(style);
}

// ── 6. HTML snapshot ──────────────────────────────────────────────────────────

async function captureHTMLSnapshot() {
  try {
    const clone = document.documentElement.cloneNode(true);

    // Remove scripts and noscript
    clone.querySelectorAll('script, noscript').forEach(el => el.remove());

    // Remove preload/prefetch/modulepreload link elements
    clone.querySelectorAll('link[rel]').forEach(link => {
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      if (/preload|prefetch|modulepreload/.test(rel)) link.remove();
    });

    // Inline external stylesheets (content script has <all_urls> fetch permission)
    const externalLinks = [...clone.querySelectorAll('link[rel~="stylesheet"]')];
    await Promise.all(externalLinks.map(async (link) => {
      const href = link.getAttribute('href');
      if (!href) { link.remove(); return; }
      try {
        const abs = new URL(href, document.baseURI).href;
        const text = await (await fetch(abs)).text();
        const style = document.createElement('style');
        style.textContent = text;
        link.replaceWith(style);
      } catch (_) {
        link.remove();
      }
    }));

    // Add <base> so relative image/font URLs still resolve
    const head = clone.querySelector('head');
    if (head && !clone.querySelector('base')) {
      const base = document.createElement('base');
      base.href = location.href;
      head.insertBefore(base, head.firstChild);
    }

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  } catch (_) {
    return null;
  }
}

// ── 7. Message handler ────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'startRecording': {
      if (isRecording) { sendResponse({ success: true }); return true; }
      isRecording = true;
      consoleEvents = [];
      interactionEvents = [];
      startTime = message.startTime;
      inlineFonts().then(() => {
        window.dispatchEvent(new CustomEvent('__bugreel_start__'));
        sendResponse({ success: true });
      });
      return true; // async
    }
    case 'stopRecording': {
      if (!isRecording) { sendResponse({ rrwebEvents: [], consoleEvents: [], htmlSnapshot: null }); return true; }
      isRecording = false;
      function onBugreelData(e) {
        if (!e.data || e.data.__bugreel_type !== 'data') return;
        window.removeEventListener('message', onBugreelData);
        captureHTMLSnapshot().then((htmlSnapshot) => {
          sendResponse({ rrwebEvents: e.data.events || [], consoleEvents: [...consoleEvents], interactionEvents: [...interactionEvents], htmlSnapshot });
          consoleEvents = [];
          interactionEvents = [];
        });
      }
      window.addEventListener('message', onBugreelData);
      window.dispatchEvent(new CustomEvent('__bugreel_stop__'));
      return true; // async
    }
    case 'getState': {
      sendResponse({ isRecording });
      return true;
    }
  }
});
