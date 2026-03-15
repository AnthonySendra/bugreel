/**
 * background.js
 * Captures network requests via the webRequest API.
 * Also accumulates rrweb/console events flushed by content scripts across
 * page navigations, so multi-page recordings work correctly.
 * Runs as a persistent background script (Manifest V2).
 */

let isRecording = false;
let networkEvents = [];
let recordingTabId = null;
let startTime = null;

// Accumulated rrweb + console events from all pages visited during the recording.
// Content scripts flush these here periodically and before unloading.
let accumulatedRrwebEvents = [];
let accumulatedConsoleEvents = [];
let accumulatedInteractionEvents = [];

// Map of requestId -> partial event (built up across multiple listeners)
const pendingRequests = new Map();

// ─── webRequest listeners ───────────────────────────────────────────────────

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;

    let requestBody = null;
    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const bytes = details.requestBody.raw[0].bytes;
          requestBody = new TextDecoder().decode(bytes);
        } catch (_) {
          requestBody = '[binary]';
        }
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

browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!isRecording || details.tabId !== recordingTabId) return;
    const pending = pendingRequests.get(details.requestId);
    if (pending) {
      pending.requestHeaders = details.requestHeaders;
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

browser.webRequest.onCompleted.addListener(
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
  ['responseHeaders']
);

browser.webRequest.onErrorOccurred.addListener(
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

// ─── Message handler ────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((message, sender) => {
  switch (message.action) {
    case 'startRecording': {
      isRecording = true;
      networkEvents = [];
      pendingRequests.clear();
      accumulatedRrwebEvents = [];
      accumulatedConsoleEvents = [];
      accumulatedInteractionEvents = [];
      recordingTabId = message.tabId;
      startTime = Date.now();
      return Promise.resolve({ success: true, startTime });
    }

    // Content scripts flush events here periodically (every 3s) and on pagehide.
    // Only accepted from the tab being recorded.
    case 'flushEvents': {
      if (!isRecording) return Promise.resolve({ success: false });
      if (sender.tab && sender.tab.id !== recordingTabId) return Promise.resolve({ success: false });
      accumulatedRrwebEvents.push(...(message.rrwebEvents || []));
      accumulatedConsoleEvents.push(...(message.consoleEvents || []));
      accumulatedInteractionEvents.push(...(message.interactionEvents || []));
      return Promise.resolve({ success: true });
    }

    case 'stopRecording': {
      isRecording = false;
      const result = {
        networkEvents: [...networkEvents],
        rrwebEvents: [...accumulatedRrwebEvents],
        consoleEvents: [...accumulatedConsoleEvents],
        interactionEvents: [...accumulatedInteractionEvents],
      };
      networkEvents = [];
      accumulatedRrwebEvents = [];
      accumulatedConsoleEvents = [];
      accumulatedInteractionEvents = [];
      recordingTabId = null;
      return Promise.resolve(result);
    }

    case 'getState': {
      // When called from a content script, only report isRecording=true if the
      // sender is the tab being recorded — prevents other tabs from auto-starting.
      const callerTabId = sender.tab ? sender.tab.id : null;
      const activeForCaller = isRecording && (callerTabId === null || callerTabId === recordingTabId);
      return Promise.resolve({ isRecording: activeForCaller, startTime });
    }
  }
});
