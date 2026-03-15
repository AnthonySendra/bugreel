/**
 * BugreelRecorder SDK
 *
 * Embed a record button on any website without a browser extension.
 * Captures DOM (rrweb), console, network (fetch + XHR), and interactions.
 *
 * ── Quick start ────────────────────────────────────────────────────────────
 *
 * Auto-init via data attributes (recommended):
 *
 *   <script
 *     src="https://your-bugreel.com/sdk/recorder.js"
 *     data-host="https://your-bugreel.com"
 *     data-app-id="your-app-id"
 *     data-token="your-api-token"
 *   ></script>
 *
 * Manual init:
 *
 *   <script src="https://your-bugreel.com/sdk/recorder.js"></script>
 *   <script>
 *     BugreelRecorder.init({
 *       host:  'https://your-bugreel.com',
 *       appId: 'your-app-id',
 *       token: 'your-api-token',
 *     });
 *   </script>
 *
 * Programmatic control (no widget):
 *
 *   BugreelRecorder.init({ host, appId, token, widget: false });
 *   BugreelRecorder.start();
 *   BugreelRecorder.stop();
 *
 * ── Differences vs the browser extension ──────────────────────────────────
 *
 *  + Runs without any extension install
 *  + Can capture response bodies (fetch / XHR interceptors)
 *  – Network capture limited to same JS context (no background webRequest)
 *  – Cross-page recording not supported (single-page session only)
 */

(function (global, doc) {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────

  var state = {
    isRecording: false,
    startTime: null,
    rrwebStopFn: null,
    rrwebEvents: [],
    consoleEvents: [],
    networkEvents: [],
    interactionEvents: [],
  };

  var cfg = {};
  var _timerInterval = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (doc.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = doc.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      doc.head.appendChild(s);
    });
  }

  function serialize(arg) {
    if (arg === null || arg === undefined) return String(arg);
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') return arg;
    try { return JSON.parse(JSON.stringify(arg)); } catch (_) { return String(arg); }
  }

  function formatDuration(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
  }

  // ── Console interception ───────────────────────────────────────────────────
  // The SDK runs in page context — no need for inline <script> injection
  // (unlike the extension which must bypass Firefox XRay vision).

  var _origConsole = {};
  var CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'table', 'trace'];

  function setupConsole() {
    CONSOLE_METHODS.forEach(function (m) {
      _origConsole[m] = (console[m] || function () {}).bind(console);
      console[m] = function () {
        if (state.isRecording) {
          state.consoleEvents.push({
            time: Date.now() - state.startTime,
            level: m,
            args: Array.prototype.slice.call(arguments).map(serialize),
          });
        }
        return _origConsole[m].apply(console, arguments);
      };
    });

    global.addEventListener('error', function (e) {
      if (!state.isRecording) return;
      state.consoleEvents.push({
        time: Date.now() - state.startTime,
        level: 'error',
        args: ['Uncaught ' + e.message, (e.filename || '') + ':' + e.lineno],
      });
    });

    global.addEventListener('unhandledrejection', function (e) {
      if (!state.isRecording) return;
      state.consoleEvents.push({
        time: Date.now() - state.startTime,
        level: 'error',
        args: ['Unhandled Promise Rejection:', String(e.reason)],
      });
    });
  }

  // ── Network interception (fetch + XHR) ────────────────────────────────────
  // Advantage over the extension: we can capture response bodies here.
  // We capture the response as text for JSON responses (truncated to 5 KB).

  var _origFetch = global.fetch ? global.fetch.bind(global) : null;
  var _origXHROpen = XMLHttpRequest.prototype.open;
  var _origXHRSend = XMLHttpRequest.prototype.send;

  function setupNetwork() {
    if (_origFetch) {
      global.fetch = function (input, init) {
        var t0 = Date.now();
        var url = typeof input === 'string' ? input
          : (input && input.url) ? input.url : String(input);
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

        return _origFetch(input, init).then(
          function (response) {
            if (!state.isRecording) return response;
            var entry = {
              time: t0 - state.startTime,
              url: url, method: method,
              status: response.status,
              duration: Date.now() - t0,
              type: 'fetch',
            };
            // Capture JSON response bodies (non-destructively via clone)
            var ct = response.headers.get('content-type') || '';
            if (ct.indexOf('application/json') !== -1) {
              response.clone().text().then(function (body) {
                entry.responseBody = body.slice(0, 5000);
              }).catch(function () {});
            }
            state.networkEvents.push(entry);
            return response;
          },
          function (err) {
            if (state.isRecording) {
              state.networkEvents.push({
                time: t0 - state.startTime,
                url: url, method: method,
                error: String(err),
                duration: Date.now() - t0,
                type: 'fetch',
              });
            }
            throw err;
          }
        );
      };
    }

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__br_method = method ? method.toUpperCase() : 'GET';
      this.__br_url = url;
      return _origXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (state.isRecording) {
        var xhr = this;
        var t0 = Date.now();
        xhr.addEventListener('loadend', function () {
          var entry = {
            time: t0 - state.startTime,
            url: xhr.__br_url,
            method: xhr.__br_method,
            status: xhr.status,
            duration: Date.now() - t0,
            type: 'xhr',
          };
          var ct = xhr.getResponseHeader('content-type') || '';
          if (ct.indexOf('application/json') !== -1 && typeof xhr.responseText === 'string') {
            entry.responseBody = xhr.responseText.slice(0, 5000);
          }
          state.networkEvents.push(entry);
        });
      }
      return _origXHRSend.apply(this, arguments);
    };
  }

  // ── Interaction capture ────────────────────────────────────────────────────

  function getLabel(el) {
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      el.getAttribute('alt') ||
      el.getAttribute('name') ||
      el.id ||
      (el.textContent || '').trim()
    ).trim().slice(0, 80);
  }

  function onClickCapture(e) {
    if (!state.isRecording) return;
    var el = e.target;
    // Skip clicks on the widget itself
    if (el.closest && el.closest('#__bugreel_widget__')) return;
    var link = el.closest ? el.closest('a[href]') : null;
    if (link) {
      state.interactionEvents.push({
        time: Date.now() - state.startTime,
        type: 'click', target: 'a',
        label: ((link.textContent || '').trim() || link.getAttribute('aria-label') || '').slice(0, 80),
        href: link.href,
      });
    } else {
      state.interactionEvents.push({
        time: Date.now() - state.startTime,
        type: 'click',
        target: (el.tagName || 'unknown').toLowerCase(),
        label: getLabel(el),
      });
    }
  }

  var _inputTimers = new WeakMap();

  function onInputCapture(e) {
    if (!state.isRecording) return;
    var el = e.target;
    if (_inputTimers.has(el)) clearTimeout(_inputTimers.get(el));
    _inputTimers.set(el, setTimeout(function () {
      state.interactionEvents.push({
        time: Date.now() - state.startTime,
        type: 'input',
        target: (el.tagName || 'input').toLowerCase(),
        label: getLabel(el),
        value: el.type === 'password' ? '••••••' : (el.value || '').slice(0, 200),
      });
      _inputTimers.delete(el);
    }, 600));
  }

  function setupInteractions() {
    doc.addEventListener('click', onClickCapture, true);
    doc.addEventListener('input', onInputCapture, true);
    global.addEventListener('popstate', function () {
      if (!state.isRecording) return;
      state.interactionEvents.push({ time: Date.now() - state.startTime, type: 'navigate', url: location.href });
    });
    global.addEventListener('hashchange', function () {
      if (!state.isRecording) return;
      state.interactionEvents.push({ time: Date.now() - state.startTime, type: 'navigate', url: location.href });
    });
  }

  // ── rrweb ──────────────────────────────────────────────────────────────────

  function startRrweb() {
    if (!global.rrweb) { console.warn('[bugreel] rrweb not loaded'); return; }
    state.rrwebStopFn = global.rrweb.record({
      emit: function (event) { state.rrwebEvents.push(event); },
      checkoutEveryNth: 200,
      maskInputOptions: { password: true },
      userTriggeredOnInput: false,
      inlineStylesheet: true,
    });
  }

  // ── Widget ─────────────────────────────────────────────────────────────────

  var WIDGET_ID = '__bugreel_widget__';

  function createWidget() {
    if (doc.getElementById(WIDGET_ID)) return;
    var wrap = doc.createElement('div');
    wrap.id = WIDGET_ID;
    wrap.innerHTML = [
      '<style>',
      '#__br_btn{',
        'position:fixed;bottom:20px;right:20px;z-index:2147483647;',
        'display:flex;align-items:center;gap:7px;',
        'padding:9px 15px;border-radius:8px;border:none;cursor:pointer;',
        'font-size:13px;font-weight:600;color:#fff;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
        'background:#e53e3e;box-shadow:0 2px 12px rgba(0,0,0,.3);',
        'transition:background .15s,transform .1s;user-select:none;',
      '}',
      '#__br_btn:hover{background:#c53030}',
      '#__br_btn:active{transform:scale(.97)}',
      '#__br_btn.br-recording{background:#1a1a1a;border:1px solid #444}',
      '#__br_btn.br-recording:hover{background:#2d2d2d}',
      '#__br_btn.br-saving{background:#1a1a1a;border:1px solid #444;opacity:.65;cursor:default}',
      '#__br_dot{width:8px;height:8px;border-radius:50%;background:#fff;flex-shrink:0}',
      '#__br_btn.br-recording #__br_dot{',
        'background:#e53e3e;box-shadow:0 0 5px #e53e3e;',
        'animation:__br_pulse 1.2s ease-in-out infinite',
      '}',
      '@keyframes __br_pulse{0%,100%{opacity:1}50%{opacity:.3}}',
      '</style>',
      '<button id="__br_btn">',
        '<span id="__br_dot"></span>',
        '<span id="__br_label">⏺ Record Bug</span>',
      '</button>',
    ].join('');
    doc.body.appendChild(wrap);
    doc.getElementById('__br_btn').addEventListener('click', function () {
      if (state.isRecording) SDK.stop(); else SDK.start();
    });
  }

  function setWidget(cls, label) {
    var btn = doc.getElementById('__br_btn');
    var lbl = doc.getElementById('__br_label');
    if (!btn) return;
    btn.className = cls ? 'br-' + cls : '';
    btn.disabled = cls === 'saving';
    if (label !== undefined) lbl.textContent = label;
  }

  function startTimer() {
    _timerInterval = setInterval(function () {
      setWidget('recording', '⏹ ' + formatDuration(Date.now() - state.startTime));
    }, 500);
  }

  function stopTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async function compressAndUpload(recording) {
    var json = JSON.stringify(recording);
    var encoded = new TextEncoder().encode(json);
    var body;

    if (global.fflate) {
      body = global.fflate.gzipSync(encoded, { level: 6 });
    } else if (typeof CompressionStream !== 'undefined') {
      var cs = new CompressionStream('gzip');
      var writer = cs.writable.getWriter();
      var reader = cs.readable.getReader();
      var chunks = [];
      writer.write(encoded);
      writer.close();
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(chunk.value);
      }
      var total = chunks.reduce(function (n, c) { return n + c.length; }, 0);
      body = new Uint8Array(total);
      var off = 0;
      chunks.forEach(function (c) { body.set(c, off); off += c.length; });
    } else {
      body = encoded; // no compression fallback
    }

    var filename = 'bug-' + new Date(recording.meta.recordedAt)
      .toISOString().slice(0, 19).replace(/:/g, '-') + '.reel';
    var base = cfg.host.replace(/\/$/, '') + '/api/apps/' + cfg.appId;
    var auth = { 'Authorization': 'Bearer ' + cfg.token };

    var storageRes = await _origFetch(base + '/storage', { headers: auth });
    if (!storageRes.ok) throw new Error('Storage check failed: ' + storageRes.status);
    var storageData = await storageRes.json();

    if (storageData.storage === 's3') {
      var urlRes = await _origFetch(base + '/upload-url', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
        body: JSON.stringify({ originalName: filename }),
      });
      if (!urlRes.ok) throw new Error('Upload URL failed: ' + urlRes.status);
      var urlData = await urlRes.json();
      var putRes = await _origFetch(urlData.uploadUrl, {
        method: 'PUT',
        body: body,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (!putRes.ok) throw new Error('S3 upload failed: ' + putRes.status);
    } else {
      var form = new FormData();
      form.append('file', new Blob([body], { type: 'application/octet-stream' }), filename);
      var uploadRes = await _origFetch(base + '/reels', {
        method: 'POST',
        headers: auth,
        body: form,
      });
      if (!uploadRes.ok) throw new Error('Upload failed: ' + uploadRes.status);
    }
  }

  function downloadLocally(recording) {
    var blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = 'bug-' + new Date(recording.meta.recordedAt)
      .toISOString().slice(0, 19).replace(/:/g, '-') + '.reel';
    doc.body.appendChild(a);
    a.click();
    doc.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  var SDK = {

    /**
     * Initialise the SDK. Must be called before start()/stop().
     * @param {object} options
     * @param {string} options.host     - Base URL of the bugreel server
     * @param {string} options.appId   - App ID (from workspace settings)
     * @param {string} options.token   - API token (from workspace settings)
     * @param {boolean} [options.widget=true] - Show the floating record button
     */
    init: function (options) {
      cfg = Object.assign({ host: '', appId: '', token: '', widget: true }, options);

      setupConsole();
      setupNetwork();
      setupInteractions();

      if (cfg.widget === false) return this;

      // Load rrweb + fflate from the configured host, then mount the widget
      var base = cfg.host.replace(/\/$/, '');
      Promise.all([
        loadScript(base + '/recorder-lib/rrweb.min.js'),
        loadScript(base + '/recorder-lib/fflate.min.js'),
      ]).then(function () {
        if (doc.body) {
          createWidget();
        } else {
          doc.addEventListener('DOMContentLoaded', createWidget);
        }
      }).catch(function (err) {
        console.warn('[bugreel] Could not load dependencies:', err);
      });

      return this;
    },

    /** Start recording programmatically. */
    start: function () {
      if (state.isRecording) return this;
      state.isRecording = true;
      state.startTime = Date.now();
      state.rrwebEvents = [];
      state.consoleEvents = [];
      state.networkEvents = [];
      state.interactionEvents = [];
      startRrweb();
      if (cfg.widget !== false) {
        startTimer();
        setWidget('recording', '⏹ 0s');
      }
      return this;
    },

    /** Stop recording, compress, and upload (or download locally if no API config). */
    stop: async function () {
      if (!state.isRecording) return;
      state.isRecording = false;
      stopTimer();
      if (state.rrwebStopFn) { state.rrwebStopFn(); state.rrwebStopFn = null; }

      if (cfg.widget !== false) setWidget('saving', '⏳ Saving…');

      var rrwebEvents = state.rrwebEvents.slice();
      var duration = rrwebEvents.length > 1
        ? rrwebEvents[rrwebEvents.length - 1].timestamp - rrwebEvents[0].timestamp
        : Date.now() - state.startTime;

      var recording = {
        version: '1.0',
        meta: {
          url: location.href,
          title: doc.title,
          recordedAt: new Date(state.startTime).toISOString(),
          duration: duration,
          userAgent: navigator.userAgent,
          source: 'sdk',
        },
        rrwebEvents: rrwebEvents,
        consoleEvents: state.consoleEvents.slice(),
        networkEvents: state.networkEvents.slice(),
        interactionEvents: state.interactionEvents.slice(),
      };

      state.rrwebEvents = [];
      state.consoleEvents = [];
      state.networkEvents = [];
      state.interactionEvents = [];

      if (cfg.host && cfg.appId && cfg.token) {
        try {
          await compressAndUpload(recording);
          if (cfg.widget !== false) {
            setWidget('', '✓ Uploaded!');
            setTimeout(function () { setWidget('', '⏺ Record Bug'); }, 3000);
          }
        } catch (err) {
          console.error('[bugreel] Upload failed:', err);
          if (cfg.widget !== false) {
            setWidget('', '✗ Failed — retrying download');
            setTimeout(function () { setWidget('', '⏺ Record Bug'); }, 3000);
          }
          downloadLocally(recording);
        }
      } else {
        downloadLocally(recording);
        if (cfg.widget !== false) setWidget('', '⏺ Record Bug');
      }
    },
  };

  // ── Auto-init from data attributes ────────────────────────────────────────

  var currentScript = doc.currentScript;
  if (currentScript) {
    var autoHost  = currentScript.getAttribute('data-host');
    var autoAppId = currentScript.getAttribute('data-app-id');
    var autoToken = currentScript.getAttribute('data-token');
    if (autoHost) {
      SDK.init({ host: autoHost, appId: autoAppId || '', token: autoToken || '' });
    }
  }

  global.BugreelRecorder = SDK;

}(window, document));
