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
        try {
          window.dispatchEvent(new CustomEvent('__bugreel_console__', { detail: { level: method, args } }));
        } catch (_) {}
        original[method].apply(console, arguments);
      };
    });
    window.addEventListener('error', function (e) {
      window.dispatchEvent(new CustomEvent('__bugreel_console__', {
        detail: { level: 'error', args: ['Uncaught ' + e.message, e.filename + ':' + e.lineno + ':' + e.colno] }
      }));
    });
    window.addEventListener('unhandledrejection', function (e) {
      window.dispatchEvent(new CustomEvent('__bugreel_console__', {
        detail: { level: 'error', args: ['Unhandled Promise Rejection:', String(e.reason)] }
      }));
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
      window.dispatchEvent(new CustomEvent('__bugreel_data__', { detail: { rrwebEvents } }));
      rrwebEvents = [];
    });
  })();`;
  document.documentElement.appendChild(ctrl);
  ctrl.remove();
})();

// ── 3. State ──────────────────────────────────────────────────────────────────

let isRecording = false;
let consoleEvents = [];
let startTime = null;

// ── 4. Console events ─────────────────────────────────────────────────────────

window.addEventListener('__bugreel_console__', (e) => {
  if (!isRecording) return;
  consoleEvents.push({ time: Date.now() - startTime, level: e.detail.level, args: e.detail.args });
});

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
      window.addEventListener('__bugreel_data__', async (e) => {
        const htmlSnapshot = await captureHTMLSnapshot();
        sendResponse({ rrwebEvents: e.detail.rrwebEvents, consoleEvents: [...consoleEvents], htmlSnapshot });
        consoleEvents = [];
      }, { once: true });
      window.dispatchEvent(new CustomEvent('__bugreel_stop__'));
      return true; // async
    }
    case 'getState': {
      sendResponse({ isRecording });
      return true;
    }
  }
});
