/**
 * background.js
 * Captures network requests via the webRequest API.
 * Runs as a persistent background script (Manifest V2).
 */

let isRecording = false;
let networkEvents = [];
let recordingTabId = null;
let startTime = null;

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

browser.runtime.onMessage.addListener((message) => {
  switch (message.action) {
    case 'startRecording': {
      isRecording = true;
      networkEvents = [];
      pendingRequests.clear();
      recordingTabId = message.tabId;
      startTime = Date.now();
      return Promise.resolve({ success: true, startTime });
    }

    case 'stopRecording': {
      isRecording = false;
      const events = [...networkEvents];
      networkEvents = [];
      recordingTabId = null;
      return Promise.resolve({ networkEvents: events });
    }

    case 'getState': {
      return Promise.resolve({ isRecording, startTime });
    }
  }
});
