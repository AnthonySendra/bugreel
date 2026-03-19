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
 *     data-endpoint="https://your-bugreel.com/api/ingest?token=API_TOKEN"
 *   ></script>
 *
 * Manual init:
 *
 *   <script src="https://your-bugreel.com/sdk/recorder.js"></script>
 *   <script>
 *     BugreelRecorder.init({
 *       endpoint: 'https://your-bugreel.com/api/ingest?token=API_TOKEN',
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
    isPermanent: false,      // permanent recording mode
    permanentDuration: 30,   // max seconds to keep in permanent mode
    startTime: null,
    rrwebStopFn: null,
    rrwebEvents: [],
    consoleEvents: [],
    networkEvents: [],
    interactionEvents: [],
    ticketProvider: null,
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
      s.crossOrigin = 'anonymous';
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

  function formatTime(date) {
    var h = date.getHours().toString().padStart(2, '0');
    var m = date.getMinutes().toString().padStart(2, '0');
    var s = date.getSeconds().toString().padStart(2, '0');
    return h + ':' + m + ':' + s;
  }

  // Trim rrweb events to keep only the last `windowMs` milliseconds.
  // `evts` is modified in place. Returns the chosen snapshot index or -1.
  function trimEventsToWindow(evts, windowMs) {
    if (evts.length < 2) return -1;
    var lastTs = evts[evts.length - 1].timestamp;

    // Collect snapshots (type 2) with their span to the last event
    var snapshots = [];
    for (var i = 0; i < evts.length; i++) {
      if (evts[i].type === 2) {
        snapshots.push({ idx: i, span: lastTs - evts[i].timestamp });
      }
    }
    if (!snapshots.length) return -1;

    // Pick the snapshot whose span is closest to windowMs but >= windowMs
    // (i.e. the one just BEFORE the cutoff so we keep at least windowMs).
    // Fallback to the closest overall if none is >= windowMs.
    var bestSnap = null;
    for (var s = 0; s < snapshots.length; s++) {
      if (snapshots[s].span >= windowMs) {
        if (!bestSnap || snapshots[s].span < bestSnap.span) {
          bestSnap = snapshots[s];
        }
      }
    }
    if (!bestSnap) {
      // No snapshot covers the full window — pick the one with the largest span
      bestSnap = snapshots[0];
      for (var t = 1; t < snapshots.length; t++) {
        if (snapshots[t].span > bestSnap.span) bestSnap = snapshots[t];
      }
    }
    var cutIdx = bestSnap.idx;

    // Splice everything before cutIdx, keep one meta event
    if (cutIdx > 0) {
      var meta = null;
      for (var m = 0; m < cutIdx; m++) {
        if (evts[m].type === 4) {
          meta = JSON.parse(JSON.stringify(evts[m]));
          break;
        }
      }
      evts.splice(0, cutIdx);
      if (meta) {
        meta.timestamp = evts[0].timestamp;
        evts.unshift(meta);
      }
    }
    return cutIdx;
  }

  // Periodic trim during recording — keeps a buffer of 1.5× the configured duration
  // so the final trim always has enough data to cut exactly maxMs.
  function trimPermanentBuffer() {
    var maxMs = (state.permanentDuration || 10) * 1000;
    var bufferMs = maxMs * 1.5;
    trimEventsToWindow(state.rrwebEvents, bufferMs);

    // Trim all secondary data to the same buffer window
    if (state.rrwebEvents.length > 1) {
      var windowStartTs = state.rrwebEvents[0].timestamp;
      var relCutoff = windowStartTs - state.startTime;
      state.consoleEvents = state.consoleEvents.filter(function (e) { return e.time >= relCutoff; });
      state.networkEvents = state.networkEvents.filter(function (e) { return e.time >= relCutoff; });
      state.interactionEvents = state.interactionEvents.filter(function (e) { return e.time >= relCutoff; });
      // Trim PerformanceObserver network events
      _perfNetworkEvents = _perfNetworkEvents.filter(function (e) { return e.time >= relCutoff; });
      // Trim captured bodies — only keep URLs still referenced by network events
      var activeUrls = {};
      for (var i = 0; i < state.networkEvents.length; i++) {
        var u = (state.networkEvents[i].url || '').split('?')[0];
        if (u) activeUrls[u] = true;
      }
      for (var i = 0; i < _perfNetworkEvents.length; i++) {
        var u = (_perfNetworkEvents[i].url || '').split('?')[0];
        if (u) activeUrls[u] = true;
      }
      var newBodies = {};
      for (var key in _capturedBodies) {
        if (activeUrls[key]) newBodies[key] = _capturedBodies[key];
      }
      _capturedBodies = newBodies;
      // Drop resolved pending body reads
      if (_pendingBodyReads.length > 50) {
        _pendingBodyReads = _pendingBodyReads.slice(-20);
      }
    }
  }

  // Final trim at stop — cuts to exactly maxMs
  function trimPermanentFinal() {
    var maxMs = (state.permanentDuration || 10) * 1000;
    trimEventsToWindow(state.rrwebEvents, maxMs);

    // After snapshot-based trim, the recording may still be slightly over maxMs
    // because the snapshot sits before the cutoff. Hard-cap: drop rrweb events
    // from the START (after meta+snapshot) until the span is <= maxMs.
    var evts = state.rrwebEvents;
    if (evts.length > 2) {
      var lastTs = evts[evts.length - 1].timestamp;
      var cutoff = lastTs - maxMs;
      // Find first event to keep: skip meta (type 4), keep snapshot (type 2),
      // then drop incremental events (type 3) that are before cutoff.
      var firstKeep = 0;
      for (var i = 0; i < evts.length; i++) {
        if (evts[i].type === 4 || evts[i].type === 2) continue; // always keep meta+snapshot
        if (evts[i].timestamp < cutoff) {
          firstKeep = i + 1;
        } else {
          break;
        }
      }
      if (firstKeep > 0) {
        // Collect meta+snapshot events before firstKeep
        var head = [];
        for (var h = 0; h < firstKeep; h++) {
          if (evts[h].type === 4 || evts[h].type === 2) head.push(evts[h]);
        }
        evts.splice(0, firstKeep);
        for (var p = head.length - 1; p >= 0; p--) {
          evts.unshift(head[p]);
        }
        // Update meta timestamp to match the actual window start
        if (evts[0].type === 4) {
          evts[0].timestamp = cutoff;
        }
      }
    }

    if (evts.length > 1) {
      var windowStartTs = evts[0].timestamp;
      var relCutoff = windowStartTs - state.startTime;
      state.consoleEvents = state.consoleEvents.filter(function (e) { return e.time >= relCutoff; });
      state.networkEvents = state.networkEvents.filter(function (e) { return e.time >= relCutoff; });
      state.interactionEvents = state.interactionEvents.filter(function (e) { return e.time >= relCutoff; });
    }
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
      // In permanent mode, take full snapshots more often so trimming works well
      checkoutEveryNth: state.isPermanent ? 10 : 200,
      maskInputOptions: { password: true },
      userTriggeredOnInput: false,
      inlineStylesheet: true,
    });
  }

  // ── Font capture ────────────────────────────────────────────────────────────
  // Collect all @font-face fonts as base64 data URIs so the player can render
  // them without cross-origin requests to the recorded site.

  function collectFontsAsBase64() {
    var fonts = [];
    try {
      var sheets = doc.styleSheets;
      for (var s = 0; s < sheets.length; s++) {
        var rules;
        try { rules = sheets[s].cssRules || sheets[s].rules; } catch (_) { continue; }
        if (!rules) continue;
        for (var r = 0; r < rules.length; r++) {
          if (rules[r].type === CSSRule.FONT_FACE_RULE) {
            var rule = rules[r];
            var family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').trim();
            var weight = rule.style.getPropertyValue('font-weight') || 'normal';
            var style = rule.style.getPropertyValue('font-style') || 'normal';
            // Extract url() from src
            var srcVal = rule.style.getPropertyValue('src') || rule.cssText.match(/src\s*:\s*([^;]+)/i)?.[1] || '';
            var urlMatch = srcVal.match(/url\(\s*["']?([^"')]+)["']?\s*\)/);
            if (urlMatch) {
              var url = urlMatch[1];
              // Resolve relative URLs
              if (url.startsWith('/')) url = location.origin + url;
              else if (!url.startsWith('http') && !url.startsWith('data:')) {
                url = new URL(url, location.href).href;
              }
              if (!url.startsWith('data:')) {
                // Detect format from URL
                var format = 'woff2';
                if (url.indexOf('.woff2') !== -1) format = 'woff2';
                else if (url.indexOf('.woff') !== -1) format = 'woff';
                else if (url.indexOf('.ttf') !== -1) format = 'truetype';
                else if (url.indexOf('.otf') !== -1) format = 'opentype';
                fonts.push({ family: family, weight: weight, style: style, url: url, format: format });
              }
            }
          }
        }
      }
    } catch (_) {}
    return fonts;
  }

  async function fetchFontsAsBase64(fontList) {
    var result = [];
    var fetches = [];
    for (var i = 0; i < fontList.length; i++) {
      (function (font) {
        var controller = new AbortController();
        var timeoutId = setTimeout(function () { controller.abort(); }, 3000);
        var p = fetch(font.url, { signal: controller.signal }).then(function (res) {
          if (!res.ok) return null;
          return res.arrayBuffer().then(function (buf) {
            var bytes = new Uint8Array(buf);
            var binary = '';
            for (var b = 0; b < bytes.length; b++) binary += String.fromCharCode(bytes[b]);
            var b64 = btoa(binary);
            var mime = font.format === 'woff2' ? 'font/woff2'
              : font.format === 'woff' ? 'font/woff'
              : font.format === 'truetype' ? 'font/ttf'
              : font.format === 'opentype' ? 'font/otf'
              : 'application/octet-stream';
            result.push({
              family: font.family,
              weight: font.weight,
              style: font.style,
              dataUri: 'data:' + mime + ';base64,' + b64,
              format: font.format,
            });
          });
        }).catch(function () {}).finally(function () { clearTimeout(timeoutId); });
        fetches.push(p);
      })(fontList[i]);
    }
    var overallTimeout = new Promise(function (resolve) {
      setTimeout(function () { resolve('timeout'); }, 5000);
    });
    await Promise.race([Promise.allSettled(fetches), overallTimeout]);
    return result;
  }

  // ── Widget ─────────────────────────────────────────────────────────────────

  var WIDGET_ID = '__bugreel_widget__';
  var _trimInterval = null;
  var _snapshotInterval = null;

  function createWidget() {
    if (doc.getElementById(WIDGET_ID)) return;
    var wrap = doc.createElement('div');
    wrap.id = WIDGET_ID;
    wrap.innerHTML = [
      '<style>',
      '#__br_group{',
        'position:fixed;bottom:20px;right:20px;z-index:2147483647;',
        'display:flex;align-items:stretch;',
        'border-radius:8px;overflow:hidden;',
        'box-shadow:0 2px 12px rgba(0,0,0,.3);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
        'opacity:.45;transition:opacity .2s;user-select:none;',
      '}',
      '#__br_group:hover{opacity:1}',
      '#__br_group.br-recording,#__br_group.br-saving,#__br_group.br-done,#__br_group.br-permanent{opacity:1}',
      '#__br_btn{',
        'display:flex;align-items:center;gap:7px;',
        'padding:9px 15px;border:none;cursor:pointer;',
        'font-size:13px;font-weight:600;color:#fff;',
        'font-family:inherit;background:#ff4070;',
        'transition:background .15s;',
      '}',
      '#__br_btn:hover{background:#e0325a}',
      '#__br_btn:active{transform:scale(.97)}',
      '#__br_chevron{',
        'display:flex;align-items:center;justify-content:center;',
        'width:32px;border:none;cursor:pointer;',
        'background:#e0325a;color:#fff;font-family:inherit;',
        'border-left:1px solid rgba(255,255,255,.2);',
        'transition:background .15s;',
      '}',
      '#__br_chevron:hover{background:#c42850}',
      '#__br_chevron svg{width:14px;height:14px;fill:currentColor}',
      // recording state
      '.br-recording #__br_btn,.br-permanent #__br_btn{background:#1a1a1a}',
      '.br-recording #__br_btn:hover,.br-permanent #__br_btn:hover{background:#2d2d2d}',
      '.br-recording #__br_chevron,.br-permanent #__br_chevron{background:#2d2d2d;border-left-color:rgba(255,255,255,.1)}',
      '.br-recording #__br_chevron:hover,.br-permanent #__br_chevron:hover{background:#3d3d3d}',
      // saving state
      '.br-saving #__br_btn{background:#1a1a1a;cursor:default}',
      '.br-saving #__br_chevron{display:none}',
      // done state
      '.br-done #__br_btn{background:#16a34a;cursor:default}',
      '.br-done #__br_btn:hover{background:#16a34a}',
      '.br-done #__br_chevron{display:none}',
      // dropdown
      '#__br_menu{',
        'display:none;position:fixed;bottom:56px;right:20px;z-index:2147483647;',
        'background:#1a1a1f;border:1px solid #333;border-radius:8px;',
        'min-width:180px;padding:4px;',
        'box-shadow:0 8px 30px rgba(0,0,0,.5);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      '}',
      '#__br_menu.br-open{display:block}',
      '.br-menu-item{',
        'display:flex;align-items:center;gap:8px;width:100%;',
        'padding:8px 12px;border:none;border-radius:6px;cursor:pointer;',
        'background:transparent;color:#ccc;font-size:13px;font-family:inherit;',
        'text-align:left;transition:background .1s;',
      '}',
      '.br-menu-item:hover{background:rgba(255,255,255,.08);color:#fff}',
      '.br-menu-sep{height:1px;background:#333;margin:4px 8px}',
      '</style>',
      '<div id="__br_group">',
        '<button id="__br_btn"><span id="__br_label">⏺ Record Bug</span></button>',
        '<button id="__br_chevron"><svg viewBox="0 0 20 20"><path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"/></svg></button>',
      '</div>',
      '<div id="__br_menu">',
        '<button class="br-menu-item" id="__br_m_identity">✏️ Edit name & email</button>',
        '<div class="br-menu-sep"></div>',
        '<button class="br-menu-item" id="__br_m_permanent">🔴 Permanent recording</button>',
        '<button class="br-menu-item" id="__br_m_screenshot">📸 Screenshot</button>',
      '</div>',
    ].join('');
    doc.body.appendChild(wrap);

    doc.getElementById('__br_btn').addEventListener('click', function () {
      closeMenu();
      if (state.isRecording) SDK.stop(); else SDK.start();
    });
    doc.getElementById('__br_chevron').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });
    doc.getElementById('__br_m_identity').addEventListener('click', function () {
      closeMenu();
      showIdentityModal();
    });
    doc.getElementById('__br_m_permanent').addEventListener('click', function () {
      closeMenu();
      showPermanentModal();
    });
    doc.getElementById('__br_m_screenshot').addEventListener('click', function () {
      closeMenu();
      SDK.screenshot();
    });
    // Close menu on outside click
    doc.addEventListener('click', function (e) {
      var menu = doc.getElementById('__br_menu');
      var chevron = doc.getElementById('__br_chevron');
      if (menu && !menu.contains(e.target) && e.target !== chevron && !chevron.contains(e.target)) {
        menu.classList.remove('br-open');
      }
    });
  }

  function toggleMenu() {
    var menu = doc.getElementById('__br_menu');
    if (menu) menu.classList.toggle('br-open');
  }

  function closeMenu() {
    var menu = doc.getElementById('__br_menu');
    if (menu) menu.classList.remove('br-open');
  }

  function setWidget(cls, label) {
    var group = doc.getElementById('__br_group');
    var btn = doc.getElementById('__br_btn');
    var lbl = doc.getElementById('__br_label');
    if (!group) return;
    group.className = cls ? 'br-' + cls : '';
    btn.disabled = cls === 'saving' || cls === 'done';
    if (label !== undefined) lbl.textContent = label;
  }

  function startTimer() {
    _timerInterval = setInterval(function () {
      if (state.isPermanent) {
        trimPermanentBuffer();
        var elapsed = Math.floor((Date.now() - state.startTime) / 1000);
        var windowSec = state.permanentDuration;
        var windowStart, windowEnd;
        if (elapsed <= windowSec) {
          windowStart = new Date(state.startTime);
          windowEnd = new Date();
        } else {
          windowStart = new Date(Date.now() - windowSec * 1000);
          windowEnd = new Date();
        }
        setWidget('permanent', '⏹ ' + formatTime(windowStart) + ' → ' + formatTime(windowEnd));
      } else {
        setWidget('recording', '⏹ ' + formatDuration(Date.now() - state.startTime));
      }
    }, 500);
  }

  function stopTimer() {
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    if (_trimInterval) { clearInterval(_trimInterval); _trimInterval = null; }
    if (_snapshotInterval) { clearInterval(_snapshotInterval); _snapshotInterval = null; }
  }

  // ── Identity modal ──────────────────────────────────────────────────────
  function showIdentityModal() {
    var overlay = doc.createElement('div');
    overlay.id = '__bugreel_identity_overlay__';
    var styles = [
      'position:fixed;inset:0;z-index:2147483647;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ].join('');

    overlay.innerHTML = [
      '<div style="' + styles + '">',
      '<div style="background:#1a1a1f;border:1px solid #333;border-radius:12px;padding:24px;width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">',
        '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px">Your identity</div>',
        '<div style="font-size:12px;color:#888;margin-bottom:16px">This is attached to your bug recordings</div>',
        '<input id="__br_id_email" type="email" placeholder="your@email.com" value="' + (_reporter.email || '') + '" style="',
          'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
          'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
          'outline:none;margin-bottom:10px;',
        '"/>',
        '<input id="__br_id_name" type="text" placeholder="Name (optional)" value="' + (_reporter.name || '') + '" style="',
          'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
          'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
          'outline:none;margin-bottom:16px;',
        '"/>',
        '<div style="display:flex;gap:8px;justify-content:flex-end">',
          '<button id="__br_id_cancel" style="padding:8px 16px;border-radius:6px;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:13px">Cancel</button>',
          '<button id="__br_id_save" style="padding:8px 16px;border-radius:6px;border:none;background:#ff4070;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Save</button>',
        '</div>',
      '</div>',
      '</div>',
    ].join('');

    doc.body.appendChild(overlay);
    doc.getElementById('__br_id_email').focus();

    function close() { overlay.remove(); }
    function save() {
      var email = doc.getElementById('__br_id_email').value.trim();
      var name = doc.getElementById('__br_id_name').value.trim();
      if (email) {
        _reporter.email = email;
        _reporter.name = name || null;
        saveReporter();
      }
      close();
    }
    doc.getElementById('__br_id_cancel').addEventListener('click', close);
    doc.getElementById('__br_id_save').addEventListener('click', save);
    doc.getElementById('__br_id_email').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
    doc.getElementById('__br_id_name').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
  }

  // ── Permanent recording modal ───────────────────────────────────────────
  function showPermanentModal() {
    var overlay = doc.createElement('div');
    overlay.id = '__bugreel_permanent_overlay__';
    var styles = [
      'position:fixed;inset:0;z-index:2147483647;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ].join('');

    var durations = [10, 20, 30];
    var optionsHtml = durations.map(function (d) {
      var sel = d === state.permanentDuration ? ' style="background:#ff4070;color:#fff;border-color:#ff4070"' : '';
      return '<button class="__br_perm_dur" data-dur="' + d + '"' + sel + '>' + d + 's</button>';
    }).join('');

    overlay.innerHTML = [
      '<div style="' + styles + '">',
      '<div style="background:#1a1a1f;border:1px solid #333;border-radius:12px;padding:24px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">',
        '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px">Permanent recording</div>',
        '<div style="font-size:12px;color:#999;margin-bottom:16px;line-height:1.5">',
          'Records continuously in the background, keeping only the last N seconds. ',
          'When you hit stop, only that window is saved and uploaded. ',
          'Useful to catch bugs that happen unexpectedly.',
        '</div>',
        '<div style="font-size:13px;color:#aaa;margin-bottom:8px;font-weight:500">Duration to keep</div>',
        '<div id="__br_perm_opts" style="display:flex;gap:8px;margin-bottom:20px">',
          optionsHtml,
        '</div>',
        '<style>',
          '.__br_perm_dur{padding:8px 18px;border-radius:6px;border:1px solid #444;background:transparent;color:#aaa;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;transition:all .15s}',
          '.__br_perm_dur:hover{border-color:#888;color:#fff}',
        '</style>',
        '<div style="display:flex;gap:8px;justify-content:flex-end">',
          '<button id="__br_perm_cancel" style="padding:8px 16px;border-radius:6px;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:13px;font-family:inherit">Cancel</button>',
          '<button id="__br_perm_start" style="padding:8px 16px;border-radius:6px;border:none;background:#ff4070;color:#fff;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">Start recording</button>',
        '</div>',
      '</div>',
      '</div>',
    ].join('');

    doc.body.appendChild(overlay);

    // Duration selection
    var selectedDur = state.permanentDuration;
    var opts = overlay.querySelectorAll('.__br_perm_dur');
    for (var i = 0; i < opts.length; i++) {
      opts[i].addEventListener('click', function () {
        selectedDur = parseInt(this.getAttribute('data-dur'));
        for (var j = 0; j < opts.length; j++) {
          opts[j].style.background = 'transparent';
          opts[j].style.color = '#aaa';
          opts[j].style.borderColor = '#444';
        }
        this.style.background = '#ff4070';
        this.style.color = '#fff';
        this.style.borderColor = '#ff4070';
      });
    }

    function close() { overlay.remove(); }
    doc.getElementById('__br_perm_cancel').addEventListener('click', close);
    doc.getElementById('__br_perm_start').addEventListener('click', function () {
      state.permanentDuration = selectedDur;
      close();
      SDK.startPermanent();
    });
  }

  // ── Ticket creation modal ──────────────────────────────────────────────
  function showTicketModal(reelId, reelUrl) {
    var overlay = doc.createElement('div');
    overlay.id = '__bugreel_ticket_overlay__';
    var styles = [
      'position:fixed;inset:0;z-index:2147483647;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ].join('');

    var providerName = state.ticketProvider || 'your tracker';

    overlay.innerHTML = [
      '<div style="' + styles + '">',
      '<div style="background:#1a1a1f;border:1px solid #333;border-radius:12px;padding:24px;width:420px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">',
        '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px">Create a ticket</div>',
        '<div style="font-size:12px;color:#888;margin-bottom:16px">This will create a ticket in ' + providerName + '</div>',
        '<input id="__br_ticket_title" type="text" placeholder="Bug: ..." style="',
          'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
          'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
          'outline:none;margin-bottom:10px;',
        '"/>',
        '<textarea id="__br_ticket_desc" placeholder="Describe the issue..." rows="4" style="',
          'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
          'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
          'outline:none;margin-bottom:10px;resize:vertical;min-height:80px;',
          'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;',
        '"></textarea>',
        '<div id="__br_ticket_error" style="display:none;color:#ff4070;font-size:12px;margin-bottom:10px"></div>',
        '<div style="display:flex;gap:8px;justify-content:flex-end">',
          '<button id="__br_ticket_skip" style="padding:8px 16px;border-radius:6px;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:13px">Skip</button>',
          '<button id="__br_ticket_submit" style="padding:8px 20px;border-radius:6px;border:none;background:#ff4070;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Create ticket</button>',
        '</div>',
      '</div>',
      '</div>',
    ].join('');

    doc.body.appendChild(overlay);
    doc.getElementById('__br_ticket_title').focus();

    function close() { overlay.remove(); }

    function skip() {
      close();
      try { navigator.clipboard.writeText(reelUrl); } catch (e) {}
      if (cfg.widget !== false) {
        setWidget('done', '\u2713 Link copied!');
        setTimeout(function () { setWidget('', '\u23FA Record Bug'); }, 4000);
      }
    }

    // Click outside the card = skip
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target === overlay.firstChild) skip();
    });

    doc.getElementById('__br_ticket_skip').addEventListener('click', skip);

    doc.getElementById('__br_ticket_submit').addEventListener('click', function () {
      var titleEl = doc.getElementById('__br_ticket_title');
      var descEl = doc.getElementById('__br_ticket_desc');
      var errorEl = doc.getElementById('__br_ticket_error');
      var submitBtn = doc.getElementById('__br_ticket_submit');
      var titleValue = titleEl.value.trim();
      var descValue = descEl.value.trim();

      if (!titleValue) {
        errorEl.textContent = 'Title is required';
        errorEl.style.display = 'block';
        titleEl.focus();
        return;
      }

      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating\u2026';
      submitBtn.style.opacity = '0.7';
      submitBtn.style.cursor = 'default';

      fetch(cfg.host + '/api/ingest/ticket?token=' + encodeURIComponent(cfg.token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reelId: reelId, title: titleValue, description: descValue }),
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ticketUrl) {
          close();
          try { navigator.clipboard.writeText(data.ticketUrl); } catch (e) {}
          if (cfg.widget !== false) {
            setWidget('done', '\u2713 Ticket created');
            setTimeout(function () { setWidget('', '\u23FA Record Bug'); }, 4000);
          }
        } else {
          var msg = data.message || data.statusMessage || (typeof data.error === 'string' ? data.error : '') || 'Failed to create ticket';
          throw new Error(msg);
        }
      })
      .catch(function (e) {
        errorEl.textContent = e.message || 'Failed to create ticket';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create ticket';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      });
    });

    doc.getElementById('__br_ticket_title').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doc.getElementById('__br_ticket_submit').click();
    });
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
            '<button id="__br_save" style="padding:8px 16px;border-radius:6px;border:none;background:#ff4070;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Save & Upload</button>',
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

  // ── Screenshot capture ───────────────────────────────────────────────────

  function takeScreenshot() {
    return new Promise(function (resolve) {
      var events = [];
      var stopFn = global.rrweb.record({
        emit: function (event) { events.push(event); },
        checkoutEveryNth: 1,
      });
      // Wait a tick for the full snapshot to be captured
      setTimeout(function () {
        stopFn();
        resolve(events);
      }, 200);
    });
  }

  function getRecentConsoleLogs() {
    // Return the last 50 console events captured by the intercept
    return state.consoleEvents.slice(-50);
  }

  function getRecentNetworkRequests() {
    // Return the last 20 network events captured by the intercept
    return state.networkEvents.slice(-20);
  }

  function showScreenshotNameModal() {
    return new Promise(function (resolve) {
      var defaultName = (doc.title || location.hostname) + ' ' +
        new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');

      var overlay = doc.createElement('div');
      overlay.id = '__bugreel_screenshot_overlay__';
      var styles = [
        'position:fixed;inset:0;z-index:2147483647;',
        'display:flex;align-items:center;justify-content:center;',
        'background:rgba(0,0,0,.55);backdrop-filter:blur(4px);',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      ].join('');

      overlay.innerHTML = [
        '<div style="' + styles + '">',
        '<div style="background:#1a1a1f;border:1px solid #333;border-radius:12px;padding:24px;width:380px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.5)">',
          '<div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px">Screenshot captured</div>',
          '<div style="font-size:12px;color:#888;margin-bottom:16px">Give it a name or save with the default</div>',
          '<input id="__br_ss_name" type="text" placeholder="Screenshot name" value="' + defaultName.replace(/"/g, '&quot;') + '" style="',
            'width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;',
            'border:1px solid #333;background:#111;color:#fff;font-size:14px;',
            'outline:none;margin-bottom:16px;',
          '"/>',
          '<div style="display:flex;gap:8px;justify-content:flex-end">',
            '<button id="__br_ss_skip" style="padding:8px 16px;border-radius:6px;border:1px solid #333;background:transparent;color:#888;cursor:pointer;font-size:13px;font-family:inherit">Skip</button>',
            '<button id="__br_ss_save" style="padding:8px 16px;border-radius:6px;border:none;background:#ff4070;color:#fff;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">Save</button>',
          '</div>',
        '</div>',
        '</div>',
      ].join('');

      doc.body.appendChild(overlay);
      var nameInput = doc.getElementById('__br_ss_name');
      nameInput.focus();
      nameInput.select();

      function finish(name) {
        overlay.remove();
        resolve(name);
      }

      doc.getElementById('__br_ss_skip').addEventListener('click', function () {
        finish(defaultName);
      });
      doc.getElementById('__br_ss_save').addEventListener('click', function () {
        var val = nameInput.value.trim();
        finish(val || defaultName);
      });
      nameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var val = nameInput.value.trim();
          finish(val || defaultName);
        }
      });
    });
  }

  // ── Upload ─────────────────────────────────────────────────────────────────

  async function compressAndUpload(recording, customName) {
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

    var filename = customName
      ? customName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 100) + '.reel'
      : 'bug-' + new Date(recording.meta.recordedAt)
        .toISOString().slice(0, 19).replace(/:/g, '-') + '.reel';
    var base = cfg.host.replace(/\/$/, '') + '/api/ingest';
    var qs = '?token=' + encodeURIComponent(cfg.token);
    var doFetch = _origFetch || fetch.bind(global);

    var storageRes = await doFetch(base + '/storage' + qs);
    if (!storageRes.ok) throw new Error('Storage check failed: ' + storageRes.status);
    var storageData = await storageRes.json();

    var reelId;
    if (storageData.storage === 's3') {
      var urlPayload = { originalName: filename };
      if (_reporter.email) urlPayload.reporter_email = _reporter.email;
      if (_reporter.name) urlPayload.reporter_name = _reporter.name;
      if (recording.meta && recording.meta.isScreenshot) urlPayload.is_screenshot = true;
      var urlRes = await doFetch(base + '/upload-url' + qs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(urlPayload),
      });
      if (!urlRes.ok) throw new Error('Upload URL failed: ' + urlRes.status);
      var urlData = await urlRes.json();
      reelId = urlData.id;
      var putRes = await doFetch(urlData.uploadUrl, {
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
      if (recording.meta && recording.meta.isScreenshot) form.append('is_screenshot', '1');
      var uploadRes = await doFetch(base + '/reels' + qs, {
        method: 'POST',
        body: form,
      });
      if (!uploadRes.ok) throw new Error('Upload failed: ' + uploadRes.status);
      var uploadData = await uploadRes.json();
      reelId = uploadData.id;
    }
    return reelId;
  }

  function downloadLocally(recording, customName) {
    var blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = customName
      ? customName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').slice(0, 100) + '.reel'
      : 'bug-' + new Date(recording.meta.recordedAt)
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
     *   (format: https://host/api/ingest?token=TOKEN)
     * @param {boolean} [options.widget=true] - Show the floating record button
     */
    init: function (options) {
      cfg = Object.assign({ host: '', appId: '', token: '', widget: true }, options);

      // Parse endpoint URL into host, appId, token
      if (cfg.endpoint) {
        try {
          var url = new URL(cfg.endpoint);
          cfg.token = url.searchParams.get('token') || '';
          cfg.appId = url.searchParams.get('app') || '';  // optional, no longer required
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
        loadScript(base + '/sdk/rrweb.min.js'),
        loadScript(base + '/sdk/fflate.min.js'),
      ]).then(function () {
        if (doc.body) {
          createWidget();
        } else {
          doc.addEventListener('DOMContentLoaded', createWidget);
        }
        // Check if a ticket integration is configured
        fetch(cfg.host + '/api/ingest/integration?token=' + encodeURIComponent(cfg.token))
          .then(function (r) { return r.json(); })
          .then(function (data) { state.ticketProvider = data.provider || null; })
          .catch(function () { state.ticketProvider = null; });
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

    /** Start permanent recording with a rolling window. */
    startPermanent: function () {
      if (state.isRecording) return this;
      state.isPermanent = true;
      // Trim buffer every second (keeps 1.5× the configured duration)
      _trimInterval = setInterval(trimPermanentBuffer, 1000);
      // Force a full DOM snapshot every 2s so the trim always has a
      // snapshot close to the window boundary (rrweb's checkoutEveryNth
      // is mutation-based and useless on quiet pages).
      _snapshotInterval = setInterval(function () {
        if (!state.isRecording) return;
        try {
          if (global.rrweb && global.rrweb.record && global.rrweb.record.takeFullSnapshot) {
            global.rrweb.record.takeFullSnapshot();
          }
        } catch (e) { /* ignore */ }
      }, 2000);
      return this.start();
    },

    /** Start recording programmatically. */
    start: function () {
      if (state.isRecording) return this;
      if (!state.isPermanent) state.isPermanent = false;

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
              if (name.indexOf('/sdk/') !== -1) continue;
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
        if (state.isPermanent) {
          setWidget('permanent', '⏹ ' + formatTime(new Date()) + ' → ' + formatTime(new Date()));
        } else {
          setWidget('recording', '⏹ 0s');
        }
      }
      return this;
    },

    /** Take a screenshot — captures a single rrweb snapshot + current state and uploads it. */
    screenshot: async function () {
      if (state.isRecording) return; // don't screenshot while recording

      if (!global.rrweb) {
        console.warn('[bugreel] rrweb not loaded');
        return;
      }

      if (cfg.widget !== false) setWidget('saving', '📸 Capturing…');

      try {
        // Capture rrweb snapshot
        var screenshotEvents = await takeScreenshot();

        // Capture recent console and network data
        var recentConsoleLogs = getRecentConsoleLogs();
        var recentNetworkRequests = getRecentNetworkRequests();

        // Capture fonts
        var fontList = collectFontsAsBase64();
        var capturedFonts = fontList.length ? await fetchFontsAsBase64(fontList) : [];

        // Ask for a name
        var screenshotName = await showScreenshotNameModal();

        if (cfg.widget !== false) setWidget('saving', '⏳ Uploading…');

        var recording = {
          version: '1.0',
          meta: {
            url: global.location.href,
            title: doc.title,
            recordedAt: new Date().toISOString(),
            duration: 0,
            userAgent: navigator.userAgent,
            screenWidth: global.innerWidth,
            screenHeight: global.innerHeight,
            isScreenshot: true,
            source: 'sdk-screenshot',
            original_name: screenshotName,
          },
          rrwebEvents: screenshotEvents,
          consoleEvents: recentConsoleLogs,
          networkEvents: recentNetworkRequests,
          interactionEvents: [],
          fonts: capturedFonts,
        };

        if (cfg.host && cfg.token) {
          // Ask who is reporting if not already identified
          if (!_reporter.email) await promptReporter();

          var reelId = await compressAndUpload(recording, screenshotName);
          var reelUrl = cfg.host + '/reel/' + reelId;

          if (state.ticketProvider) {
            if (cfg.widget !== false) setWidget('', '⏺ Record Bug');
            showTicketModal(reelId, reelUrl);
          } else {
            try { await navigator.clipboard.writeText(reelUrl); } catch (_) {}
            if (cfg.widget !== false) {
              setWidget('done', '✓ Link copied!');
              setTimeout(function () { setWidget('', '⏺ Record Bug'); }, 4000);
            }
          }
        } else {
          downloadLocally(recording, screenshotName);
          if (cfg.widget !== false) setWidget('', '⏺ Record Bug');
        }
      } catch (err) {
        console.error('[bugreel] Screenshot failed:', err);
        if (cfg.widget !== false) {
          setWidget('', '✗ Screenshot failed');
          setTimeout(function () { setWidget('', '⏺ Record Bug'); }, 3000);
        }
      }
    },

    /** Stop recording, compress, and upload (or download locally if no API config). */
    stop: async function () {
      if (!state.isRecording) return;
      var wasPermanent = state.isPermanent;
      state.isRecording = false;
      state.isPermanent = false;
      stopTimer();
      if (state.rrwebStopFn) { state.rrwebStopFn(); state.rrwebStopFn = null; }

      // Stop PerformanceObserver
      if (_perfObserver) { _perfObserver.disconnect(); _perfObserver = null; }

      // Final trim for permanent mode
      if (wasPermanent) trimPermanentFinal();

      if (cfg.widget !== false) setWidget('saving', '⏳ Saving…');

      // Capture fonts as base64 before rrweb stops (needs access to stylesheets)
      var fontList = collectFontsAsBase64();
      var capturedFonts = fontList.length ? await fetchFontsAsBase64(fontList) : [];

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

      // For permanent recordings, the trim already updated all timestamps.
      // events[0] is a meta event with timestamp = window start.
      var effectiveStartTime = state.startTime;
      if (wasPermanent && rrwebEvents.length > 1) {
        effectiveStartTime = rrwebEvents[0].timestamp;
        duration = rrwebEvents[rrwebEvents.length - 1].timestamp - effectiveStartTime;
      }

      var recording = {
        version: '1.0',
        meta: {
          url: location.href,
          title: doc.title,
          recordedAt: new Date(effectiveStartTime).toISOString(),
          duration: duration,
          userAgent: navigator.userAgent,
          source: wasPermanent ? 'sdk-permanent' : 'sdk',
        },
        rrwebEvents: rrwebEvents,
        consoleEvents: state.consoleEvents.slice(),
        networkEvents: merged,
        interactionEvents: state.interactionEvents.slice(),
        fonts: capturedFonts,
      };

      state.rrwebEvents = [];
      state.consoleEvents = [];
      state.networkEvents = [];
      state.interactionEvents = [];

      if (cfg.host && cfg.token) {
        // Ask who is reporting if not already identified
        if (!_reporter.email) await promptReporter();
        try {
          var reelId = await compressAndUpload(recording);
          var reelUrl = cfg.host + '/reel/' + reelId;
          if (state.ticketProvider) {
            if (cfg.widget !== false) setWidget('', '\u23FA Record Bug');
            showTicketModal(reelId, reelUrl);
          } else {
            try { await navigator.clipboard.writeText(reelUrl); } catch (_) {}
            if (cfg.widget !== false) {
              setWidget('done', '\u2713 Link copied!');
              setTimeout(function () { setWidget('', '\u23FA Record Bug'); }, 4000);
            }
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
