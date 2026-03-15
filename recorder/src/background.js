/**
 * background.js — shared background script (Firefox MV2 + Chrome MV3)
 *
 * Firefox: runs as a persistent background page, `browser` is available globally.
 * Chrome:  runs as a service worker, `chrome` is available globally.
 *          State may be lost if the worker is terminated; we persist critical
 *          fields to storage.session as a recovery mechanism.
 */

const ext = typeof browser !== 'undefined' ? browser : chrome;
const isFirefox = typeof browser !== 'undefined';

// ── In-memory state ───────────────────────────────────────────────────────────

let isRecording = false;
let networkEvents = [];
let recordingTabId = null;
let startTime = null;
const pendingRequests = new Map();

// ── State persistence (Chrome MV3 service worker recovery) ───────────────────

async function persistState() {
  try {
    await ext.storage.session.set({ isRecording, recordingTabId, startTime });
  } catch (_) { /* storage.session not available in Firefox MV2 */ }
}

async function restoreState() {
  try {
    const s = await ext.storage.session.get(['isRecording', 'recordingTabId', 'startTime']);
    if (s.isRecording) {
      isRecording = s.isRecording;
      recordingTabId = s.recordingTabId;
      startTime = s.startTime;
    }
  } catch (_) {}
}

restoreState();

// ── webRequest — capture network metadata ─────────────────────────────────────
// We only observe (no blocking), so this works in both MV2 and MV3.
// Chrome MV3: add 'extraHeaders' to access all headers (some are hidden by default).

const headersSpec = isFirefox
  ? ['requestHeaders']
  : ['requestHeaders', 'extraHeaders'];

const responseSpec = isFirefox
  ? ['responseHeaders']
  : ['responseHeaders', 'extraHeaders'];

ext.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;

    let requestBody = null;
    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          requestBody = new TextDecoder().decode(details.requestBody.raw[0].bytes);
        } catch (_) { requestBody = '[binary]'; }
      } else if (details.requestBody.formData) {
        requestBody = details.requestBody.formData;
      }
    }

    pendingRequests.set(details.requestId, {
      id: details.requestId,
      time: Date.now() - startTime,
      url: details.url,
      method: details.method,
      type: details.type,
      requestBody,
    });
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

ext.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;
    const pending = pendingRequests.get(details.requestId);
    if (pending) pending.requestHeaders = details.requestHeaders;
  },
  { urls: ['<all_urls>'] },
  headersSpec
);

ext.webRequest.onCompleted.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;
    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;
    networkEvents.push({
      ...pending,
      status: details.statusCode,
      statusLine: details.statusLine,
      responseHeaders: details.responseHeaders,
      endTime: Date.now() - startTime,
      duration: Date.now() - startTime - pending.time,
    });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] },
  responseSpec
);

ext.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;
    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;
    networkEvents.push({
      ...pending,
      error: details.error,
      endTime: Date.now() - startTime,
      duration: Date.now() - startTime - pending.time,
    });
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

// ── Message handler ───────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'startRecording': {
      isRecording = true;
      networkEvents = [];
      pendingRequests.clear();
      recordingTabId = message.tabId;
      startTime = Date.now();
      persistState();
      sendResponse({ success: true, startTime });
      return true;
    }
    case 'stopRecording': {
      isRecording = false;
      const events = [...networkEvents];
      networkEvents = [];
      recordingTabId = null;
      persistState();
      sendResponse({ networkEvents: events });
      return true;
    }
    case 'getState': {
      sendResponse({ isRecording, startTime });
      return true;
    }
  }
});
