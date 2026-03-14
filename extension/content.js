/**
 * content.js — Injected at document_start.
 *
 * Architecture:
 *  - Console capture  : inline <script> in page context → CustomEvent → content script
 *  - DOM capture      : rrweb injected as page-context <script src> (bypasses Firefox
 *                       XRay vision so React/Vue/etc. value setters are visible)
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

(function injectPageRecorder() {
  // Step 2a: load rrweb as a page script
  const rrwebScript = document.createElement('script');
  rrwebScript.src = browser.runtime.getURL('lib/rrweb.min.js');
  document.documentElement.appendChild(rrwebScript);

  // Step 2b: inject the recorder controller (listens for CustomEvents from content script)
  const ctrl = document.createElement('script');
  ctrl.textContent = `(function () {
    let stopFn = null;
    let rrwebEvents = [];

    window.addEventListener('__jam_start__', function (e) {
      rrwebEvents = [];
      if (!window.rrweb) {
        window.dispatchEvent(new CustomEvent('__jam_error__', { detail: 'rrweb not loaded' }));
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
      } catch (err) {
        window.dispatchEvent(new CustomEvent('__jam_error__', { detail: String(err) }));
      }
    });

    window.addEventListener('__jam_stop__', function () {
      if (stopFn) { stopFn(); stopFn = null; }
      window.postMessage({ __bugreel_type: 'data', events: rrwebEvents }, '*');
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

// ── 4. Console events (from page context) ────────────────────────────────────

window.addEventListener('message', (e) => {
  if (!e.data || !e.data.__bugreel_type) return;
  if (e.data.__bugreel_type === 'console') {
    if (!isRecording) return;
    consoleEvents.push({ time: Date.now() - startTime, level: e.data.level, args: e.data.args });
  }
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

  document.getElementById('__jam_fonts__')?.remove();
  const style = document.createElement('style');
  style.id = '__jam_fonts__';
  style.textContent = inlinedParts.join('\n');
  document.head.appendChild(style);
}

// ── 6. Message handler (from popup.js) ───────────────────────────────────────

browser.runtime.onMessage.addListener((message) => {
  switch (message.action) {

    case 'startRecording': {
      if (isRecording) return Promise.resolve({ success: true });
      isRecording = true;
      consoleEvents = [];
      startTime = message.startTime;

      // Inline fonts first, then tell the page-context recorder to start
      return inlineFonts().then(() => {
        window.dispatchEvent(new CustomEvent('__jam_start__'));
        return { success: true };
      });
    }

    case 'stopRecording': {
      if (!isRecording) return Promise.resolve({ rrwebEvents: [], consoleEvents: [] });
      isRecording = false;

      return new Promise((resolve) => {
        function onData(e) {
          if (!e.data || e.data.__bugreel_type !== 'data') return;
          window.removeEventListener('message', onData);
          resolve({ rrwebEvents: e.data.events || [], consoleEvents: [...consoleEvents] });
          consoleEvents = [];
        }
        window.addEventListener('message', onData);
        window.dispatchEvent(new CustomEvent('__jam_stop__'));
      });
    }

    case 'getState': {
      return Promise.resolve({ isRecording });
    }
  }
});
