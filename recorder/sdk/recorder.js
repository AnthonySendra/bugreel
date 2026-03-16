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
 *     data-endpoint="https://your-bugreel.com/api/apps/APP_ID/reels?token=API_TOKEN"
 *   ></script>
 *
 * Manual init:
 *
 *   <script src="https://your-bugreel.com/sdk/recorder.js"></script>
 *   <script>
 *     BugreelRecorder.init({
 *       endpoint: 'https://your-bugreel.com/api/apps/APP_ID/reels?token=API_TOKEN',
 *     });
 *   </script>
 *
 * Identify the reporter (recommended):
 *
 *   BugreelRecorder.identify({ email: 'user@example.com', name: 'Alice' });
 *
 * If identify() is not called, the widget will prompt the user for their
 * email before uploading. The identity is stored in localStorage.
 *
 * Programmatic control (no widget):
 *
 *   BugreelRecorder.init({ endpoint: '...', widget: false });
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
  var _perfObserver = null;
  var _perfNetworkEvents = [];
  var _perfStartTime = 0;
  var _reporter = { email: null, name: null };
  var STORAGE_KEY = '__bugreel_reporter__';
  var _pendingBodyReads = []; // Promises for async response.clone().text()
  var _capturedBodies = {};   // url -> { requestBody, responseBody, status, method, ... }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      // Check if already loaded
      if (doc.querySelector('script[data-bugreel-src="' + src + '"]')) { resolve(); return; }
      // Try <script> tag first, fall back to fetch+eval for cross-origin
      var s = doc.createElement('script');
      s.src = src;
      s.setAttribute('data-bugreel-src', src);
      s.onload = resolve;
      s.onerror = function () {
        s.remove();
        // Fallback: fetch + eval (works cross-origin with CORS headers)
        fetch(src).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        }).then(function (code) {
          var s2 = doc.createElement('script');
          s2.setAttribute('data-bugreel-src', src);
          s2.textContent = code;
          doc.head.appendChild(s2);
          resolve();
        }).catch(function () {
          reject(new Error('Failed to load ' + src));
        });
      };
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

  // Re-wrapped each time recording starts to survive framework overwrites (Vite HMR, etc.)
  var _origFetch = null;
  var _origXHROpen = null;
  var _origXHRSend = null;
  var _origSetHeader = null;

  function setupNetwork() {
    // no-op — patching is now done in patchNetwork(), called at start() time
  }

  function patchNetwork() {
    // ── Capture current natives (skip if already our wrapper) ──
    var curFetch = global.fetch;
    if (curFetch && curFetch.__br) _origFetch = curFetch.__br_orig;
    else _origFetch = curFetch ? curFetch.bind(global) : null;

    var curOpen = XMLHttpRequest.prototype.open;
    if (curOpen && curOpen.__br) _origXHROpen = curOpen.__br_orig;
    else _origXHROpen = curOpen;

    var curSend = XMLHttpRequest.prototype.send;
    if (curSend && curSend.__br) _origXHRSend = curSend.__br_orig;
    else _origXHRSend = curSend;

    var curSetH = XMLHttpRequest.prototype.setRequestHeader;
    if (curSetH && curSetH.__br) _origSetHeader = curSetH.__br_orig;
    else _origSetHeader = curSetH;

    // ── Wrap fetch ──
    if (_origFetch) {
      var fetchWrapper = function (input, init) {
        var t0 = Date.now();
        var url = typeof input === 'string' ? input
          : (input && input.url) ? input.url : String(input);
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

        // Request body
        var reqBody = null;
        try {
          var rawBody = (init && init.body) || (input && input.body) || null;
          if (rawBody && typeof rawBody === 'string') reqBody = rawBody.slice(0, 5000);
          else if (rawBody && typeof rawBody === 'object' && !(rawBody instanceof Blob) && !(rawBody instanceof ArrayBuffer) && !(rawBody instanceof FormData)) {
            reqBody = JSON.stringify(rawBody).slice(0, 5000);
          }
        } catch (_) {}

        // Request headers
        var reqHeaders = [];
        try {
          var hdrs = (init && init.headers) || (input && input.headers) || null;
          if (hdrs) {
            if (hdrs instanceof Headers) hdrs.forEach(function (v, k) { reqHeaders.push({ name: k, value: v }); });
            else if (Array.isArray(hdrs)) hdrs.forEach(function (h) { reqHeaders.push({ name: h[0], value: h[1] }); });
            else Object.keys(hdrs).forEach(function (k) { reqHeaders.push({ name: k, value: hdrs[k] }); });
          }
        } catch (_) {}

        return _origFetch(input, init).then(
          function (response) {
            if (!state.isRecording) return response;
            var now = Date.now();
            var entry = {
              time: t0 - state.startTime,
              endTime: now - state.startTime,
              url: url, method: method,
              status: response.status,
              statusLine: response.status + ' ' + response.statusText,
              duration: now - t0,
              type: 'fetch',
            };
            if (reqBody) entry.requestBody = reqBody;
            if (reqHeaders.length) entry.requestHeaders = reqHeaders;

            // Response headers
            var resHeaders = [];
            try { response.headers.forEach(function (v, k) { resHeaders.push({ name: k, value: v }); }); } catch (_) {}
            if (resHeaders.length) entry.responseHeaders = resHeaders;

            // Response body
            var ct = response.headers.get('content-type') || '';
            if (ct.indexOf('json') !== -1 || ct.indexOf('text/') !== -1 || ct.indexOf('xml') !== -1 || ct.indexOf('html') !== -1) {
              var bodyPromise = response.clone().text().then(function (body) {
                entry.responseBody = body.slice(0, 10000);

              }).catch(function () {});
              _pendingBodyReads.push(bodyPromise);
            }
            state.networkEvents.push(entry);
            return response;
          },
          function (err) {
            if (state.isRecording) {
              var now = Date.now();
              var errEntry = {
                time: t0 - state.startTime, endTime: now - state.startTime,
                url: url, method: method, error: String(err),
                duration: now - t0, type: 'fetch',
              };
              if (reqBody) errEntry.requestBody = reqBody;
              if (reqHeaders.length) errEntry.requestHeaders = reqHeaders;
              state.networkEvents.push(errEntry);
            }
            throw err;
          }
        );
      };
      fetchWrapper.__br = true;
      fetchWrapper.__br_orig = _origFetch;
      global.fetch = fetchWrapper;
    }

    // ── Wrap XHR.open ──
    var openWrapper = function (method, url) {
      this.__br_method = method ? method.toUpperCase() : 'GET';
      this.__br_url = url;
      return _origXHROpen.apply(this, arguments);
    };
    openWrapper.__br = true;
    openWrapper.__br_orig = _origXHROpen;
    XMLHttpRequest.prototype.open = openWrapper;

    // ── Wrap XHR.setRequestHeader ──
    var setHWrapper = function (name, value) {
      if (!this.__br_reqHeaders) this.__br_reqHeaders = [];
      this.__br_reqHeaders.push({ name: name, value: value });
      return _origSetHeader.apply(this, arguments);
    };
    setHWrapper.__br = true;
    setHWrapper.__br_orig = _origSetHeader;
    XMLHttpRequest.prototype.setRequestHeader = setHWrapper;

    // ── Wrap XHR.send ──
    var sendWrapper = function (body) {
      var xhr = this;
      var t0 = Date.now();
      var reqBody = null;
      try {
        if (body && typeof body === 'string') reqBody = body.slice(0, 5000);
        else if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof FormData)) {
          reqBody = JSON.stringify(body).slice(0, 5000);
        }
      } catch (_) {}

      xhr.addEventListener('loadend', function () {
        if (!state.isRecording) return;
        var now = Date.now();
        var entry = {
          time: t0 - state.startTime, endTime: now - state.startTime,
          url: xhr.__br_url, method: xhr.__br_method,
          status: xhr.status, statusLine: xhr.status + ' ' + xhr.statusText,
          duration: now - t0, type: 'xhr',
        };
        if (reqBody) entry.requestBody = reqBody;
        if (xhr.__br_reqHeaders && xhr.__br_reqHeaders.length) entry.requestHeaders = xhr.__br_reqHeaders;

        // Response headers
        var resHeaders = [];
        try {
          var allH = xhr.getAllResponseHeaders() || '';
          allH.split('\r\n').forEach(function (line) {
            var idx = line.indexOf(':');
            if (idx > 0) resHeaders.push({ name: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() });
          });
        } catch (_) {}
        if (resHeaders.length) entry.responseHeaders = resHeaders;

        // Response body
        var ct = '';
        try { ct = xhr.getResponseHeader('content-type') || ''; } catch (_) {}
        if ((ct.indexOf('json') !== -1 || ct.indexOf('text/') !== -1 || ct.indexOf('xml') !== -1) && typeof xhr.responseText === 'string') {
          entry.responseBody = xhr.responseText.slice(0, 10000);
        }
        state.networkEvents.push(entry);
      });
      return _origXHRSend.apply(this, arguments);
    };
    sendWrapper.__br = true;
    sendWrapper.__br_orig = _origXHRSend;
    XMLHttpRequest.prototype.send = sendWrapper;

  }

  // ── Response prototype interception ─────────────────────────────────────
  // Frameworks (Nuxt/ofetch) may cache the native fetch reference before our
  // monkey-patch.  By wrapping Response.prototype.json/text we capture the
  // response body regardless of *how* the request was made.

  var _origResJson = Response.prototype.json;
  var _origResText = Response.prototype.text;

  Response.prototype.json = function () {
    var resp = this;
    return _origResJson.call(this).then(function (data) {
      if (state.isRecording && resp.url) {
        try {
          var key = resp.url.split('?')[0]; // normalise
          if (!_capturedBodies[key]) _capturedBodies[key] = {};
          _capturedBodies[key].responseBody = JSON.stringify(data).slice(0, 10000);
          _capturedBodies[key].status = resp.status;
          _capturedBodies[key].statusText = resp.statusText;
        } catch (_) {}
      }
      return data;
    });
  };

  Response.prototype.text = function () {
    var resp = this;
    return _origResText.call(this).then(function (text) {
      if (state.isRecording && resp.url) {
        try {
          var ct = '';
          try { ct = resp.headers.get('content-type') || ''; } catch (_) {}
          // Only capture text-based responses
          if (ct.indexOf('json') !== -1 || ct.indexOf('text/') !== -1 || ct.indexOf('xml') !== -1) {
            var key = resp.url.split('?')[0];
            if (!_capturedBodies[key]) _capturedBodies[key] = {};
            _capturedBodies[key].responseBody = text.slice(0, 10000);
            _capturedBodies[key].status = resp.status;
            _capturedBodies[key].statusText = resp.statusText;
          }
        } catch (_) {}
      }
      return text;
    });
  };

  // Also intercept Request constructor to capture request bodies
  // ofetch builds Request objects — we can read the body from there
  var _origRequest = global.Request;
  if (_origRequest) {
    global.Request = function (input, init) {
      var req = new _origRequest(input, init);
      if (state.isRecording && init && init.body) {
        try {
          var url = typeof input === 'string' ? input : (input.url || String(input));
          var key = url.split('?')[0];
          if (!_capturedBodies[key]) _capturedBodies[key] = {};
          var b = init.body;
          if (typeof b === 'string') _capturedBodies[key].requestBody = b.slice(0, 5000);
          else if (b && typeof b === 'object' && !(b instanceof Blob) && !(b instanceof ArrayBuffer) && !(b instanceof FormData) && !(b instanceof ReadableStream)) {
            _capturedBodies[key].requestBody = JSON.stringify(b).slice(0, 5000);
          }
          _capturedBodies[key].method = (init.method || 'GET').toUpperCase();

          // Capture request headers
          if (init.headers) {
            var hdrs = [];
            if (init.headers instanceof Headers) init.headers.forEach(function (v, k) { hdrs.push({ name: k, value: v }); });
            else if (typeof init.headers === 'object') Object.keys(init.headers).forEach(function (k) { hdrs.push({ name: k, value: init.headers[k] }); });
            if (hdrs.length) _capturedBodies[key].requestHeaders = hdrs;
          }
        } catch (_) {}
      }
      return req;
    };
    global.Request.prototype = _origRequest.prototype;
    Object.keys(_origRequest).forEach(function (k) { try { global.Request[k] = _origRequest[k]; } catch (_) {} });
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
        'transition:background .15s,transform .1s,opacity .2s;user-select:none;',
        'opacity:.45;',
      '}',
      '#__br_btn:hover{background:#c53030;opacity:1}',
      '#__br_btn:active{transform:scale(.97)}',
      '#__br_btn.br-recording{background:#1a1a1a;border:1px solid #444;opacity:1}',
      '#__br_btn.br-recording:hover{background:#2d2d2d}',
      '#__br_btn.br-saving{background:#1a1a1a;border:1px solid #444;opacity:.65;cursor:default}',
      '</style>',
      '<button id="__br_btn">',
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

  // ── Reporter identity ──────────────────────────────────────────────────
  // Load saved reporter from localStorage
  function loadReporter() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed.email) _reporter.email = parsed.email;
        if (parsed.name) _reporter.name = parsed.name;
      }
    } catch (_) {}
  }

  function saveReporter() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_reporter));
    } catch (_) {}
  }

  // Prompt the user for their email before uploading (fallback when identify() not called)
  function promptReporter() {
    return new Promise(function (resolve) {
      if (_reporter.email) { resolve(); return; }

      var overlay = doc.createElement('div');
      overlay.id = '__bugreel_reporter_overlay__';
      var styles = [
        'position:fixed;inset:0;z-index:2147483647;',
        'display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      ].join('');

      overlay.innerHTML = [
        '<div style="' + styles + '">',
        '<div style="background:#1a1a1f;border:1px solid #333;border-radius:12px;padding:24px;width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">',
          '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px">Who\'s reporting this bug?</div>',
          '<div style="font-size:12px;color:#888;margin-bottom:16px">So the team knows who recorded it</div>',
          '<input id="__br_email" type="email" placeholder="your@email.com" style="',
            'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
            'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
            'outline:none;margin-bottom:10px;',
          '"/>',
          '<input id="__br_name" type="text" placeholder="Name (optional)" style="',
            'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
            'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
            'outline:none;margin-bottom:16px;',
          '"/>',
          '<div style="display:flex;gap:8px;justify-content:flex-end">',
            '<button id="__br_skip" style="padding:8px 16px;border-radius:6px;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:13px">Skip</button>',
            '<button id="__br_save" style="padding:8px 16px;border-radius:6px;border:none;background:#e53e3e;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Save & Upload</button>',
          '</div>',
        '</div>',
        '</div>',
      ].join('');

      doc.body.appendChild(overlay);

      var emailInput = doc.getElementById('__br_email');
      var nameInput = doc.getElementById('__br_name');
      emailInput.focus();

      function finish(withData) {
        if (withData) {
          var email = emailInput.value.trim();
          var name = nameInput.value.trim();
          if (email) {
            _reporter.email = email;
            _reporter.name = name || null;
            saveReporter();
          }
        }
        overlay.remove();
        resolve();
      }

      doc.getElementById('__br_save').addEventListener('click', function () { finish(true); });
      doc.getElementById('__br_skip').addEventListener('click', function () { finish(false); });
      emailInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') finish(true);
      });
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') finish(true);
      });
    });
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
      var urlPayload = { originalName: filename };
      if (_reporter.email) urlPayload.reporter_email = _reporter.email;
      if (_reporter.name) urlPayload.reporter_name = _reporter.name;
      var urlRes = await _origFetch(base + '/upload-url', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
        body: JSON.stringify(urlPayload),
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
      if (_reporter.email) form.append('reporter_email', _reporter.email);
      if (_reporter.name) form.append('reporter_name', _reporter.name);
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
     * @param {string} options.endpoint - Endpoint URL from workspace settings
     *   (format: https://host/api/apps/{appId}/reels?token={token})
     * @param {boolean} [options.widget=true] - Show the floating record button
     */
    init: function (options) {
      cfg = Object.assign({ host: '', appId: '', token: '', widget: true }, options);

      // Parse endpoint URL into host, appId, token
      if (cfg.endpoint) {
        try {
          var url = new URL(cfg.endpoint);
          cfg.token = url.searchParams.get('token') || '';
          var match = url.pathname.match(/\/api\/apps\/([^/]+)\/reels/);
          if (match) cfg.appId = match[1];
          url.search = '';
          url.pathname = '';
          cfg.host = url.origin;
        } catch (e) {
          console.warn('[bugreel] Invalid endpoint URL:', e);
        }
      }

      loadReporter();
      setupConsole();
      setupNetwork();
      setupInteractions();

      if (cfg.widget === false) return this;

      // Load rrweb + fflate from the configured host, then mount the widget
      var base = cfg.host.replace(/\/$/, '');
      Promise.all([
        loadScript(base + '/api/recorder-lib/rrweb.min.js'),
        loadScript(base + '/api/recorder-lib/fflate.min.js'),
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

    /**
     * Identify the current user. Call this so reels are attributed to the right person.
     * @param {{ email: string, name?: string }} user
     */
    identify: function (user) {
      if (user && user.email) {
        _reporter.email = user.email;
        _reporter.name = user.name || null;
        saveReporter();
      }
      return this;
    },

    /** Start recording programmatically. */
    start: function () {
      if (state.isRecording) return this;

      // (Re-)patch fetch/XHR right before recording — survives HMR / framework overwrites
      patchNetwork();

      state.isRecording = true;
      state.startTime = Date.now();
      _perfStartTime = performance.now();
      state.rrwebEvents = [];
      state.consoleEvents = [];
      state.networkEvents = [];
      state.interactionEvents = [];
      _perfNetworkEvents = [];
      _pendingBodyReads = [];
      _capturedBodies = {};

      // Start PerformanceObserver to capture ALL network requests reliably
      // (fetch/XHR interceptor misses requests from bundled code that cached fetch)
      if (global.PerformanceObserver) {
        try {
          _perfObserver = new PerformanceObserver(function (list) {
            var entries = list.getEntries();
            for (var i = 0; i < entries.length; i++) {
              var r = entries[i];
              var name = r.name || '';
              // Skip bugreel's own requests
              if (name.indexOf('/recorder-lib/') !== -1) continue;
              if (name.indexOf('/sdk/recorder') !== -1) continue;
              if (name.indexOf('/api/apps/') !== -1 && name.indexOf('/reels') !== -1) continue;
              if (name.indexOf('/api/sdk-bundle') !== -1) continue;
              var evTime = Math.round(r.startTime - _perfStartTime);
              _perfNetworkEvents.push({
                time: evTime,
                endTime: evTime + Math.round(r.duration),
                url: name,
                method: '',
                status: r.responseStatus || 0,
                duration: Math.round(r.duration),
                type: r.initiatorType || 'other',
                transferSize: r.transferSize || 0,
              });
            }
          });
          _perfObserver.observe({ type: 'resource', buffered: false });
        } catch (_) {}
      }

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

      // Stop PerformanceObserver
      if (_perfObserver) { _perfObserver.disconnect(); _perfObserver = null; }

      if (cfg.widget !== false) setWidget('saving', '⏳ Saving…');

      // Wait for all pending response body reads to complete before serializing
      if (_pendingBodyReads.length) {
        await Promise.allSettled(_pendingBodyReads);
        _pendingBodyReads = [];
      }

      var rrwebEvents = state.rrwebEvents.slice();
      var duration = rrwebEvents.length > 1
        ? rrwebEvents[rrwebEvents.length - 1].timestamp - rrwebEvents[0].timestamp
        : Date.now() - state.startTime;

      // ── Merge network events from interceptor + PerformanceObserver ──
      var intercepted = state.networkEvents.slice();
      var perfEvents = _perfNetworkEvents.slice();
      // Deduplicate: skip perf entries already caught by interceptor
      var merged = intercepted.slice();
      for (var i = 0; i < perfEvents.length; i++) {
        var pe = perfEvents[i];
        var isDup = false;
        for (var j = 0; j < intercepted.length; j++) {
          if (intercepted[j].url === pe.url && Math.abs(intercepted[j].time - pe.time) < 500) {
            if (pe.transferSize) intercepted[j].transferSize = pe.transferSize;
            isDup = true;
            break;
          }
        }
        if (!isDup) merged.push(pe);
      }
      merged.sort(function (a, b) { return a.time - b.time; });
      _perfNetworkEvents = [];

      // ── Enrich network events with captured bodies from Response.prototype ──
      var bodiesMatched = 0;
      for (var bi = 0; bi < merged.length; bi++) {
        var ev = merged[bi];
        var evUrl = ev.url || '';
        var key = evUrl.split('?')[0];
        var cap = _capturedBodies[key];
        if (cap) {
          if (cap.responseBody && !ev.responseBody) { ev.responseBody = cap.responseBody; bodiesMatched++; }
          if (cap.requestBody && !ev.requestBody) ev.requestBody = cap.requestBody;
          if (cap.requestHeaders && !ev.requestHeaders) ev.requestHeaders = cap.requestHeaders;
          if (cap.method && (!ev.method || ev.method === '')) ev.method = cap.method;
          if (cap.status && !ev.status) ev.status = cap.status;
          if (cap.statusText && !ev.statusLine) ev.statusLine = cap.status + ' ' + cap.statusText;
          // Also capture response headers from the fetch interceptor if available
          if (!ev.responseHeaders) {
            // Response.prototype doesn't give us headers easily, but the fetch wrapper might have captured them
          }
        }
      }
      _capturedBodies = {};

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
        networkEvents: merged,
        interactionEvents: state.interactionEvents.slice(),
      };

      state.rrwebEvents = [];
      state.consoleEvents = [];
      state.networkEvents = [];
      state.interactionEvents = [];

      if (cfg.host && cfg.appId && cfg.token) {
        // Ask who is reporting if not already identified
        if (!_reporter.email) await promptReporter();
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
    var autoEndpoint = currentScript.getAttribute('data-endpoint');
    if (autoEndpoint) {
      SDK.init({ endpoint: autoEndpoint });
    }
  }

  global.BugreelRecorder = SDK;

}(window, document));
