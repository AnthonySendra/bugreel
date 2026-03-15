/**
 * popup.js
 * Controls the extension popup UI.
 * Coordinates startRecording / stopRecording between background.js and content.js.
 */

const recordBtn = document.getElementById('recordBtn');
const btnIcon = document.getElementById('btnIcon');
const btnLabel = document.getElementById('btnLabel');
const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');
const stats = document.getElementById('stats');
const statTime = document.getElementById('statTime');
const statConsole = document.getElementById('statConsole');
const statNetwork = document.getElementById('statNetwork');

const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const settingApiUrl = document.getElementById('settingApiUrl');
const settingAppId = document.getElementById('settingAppId');
const settingApiToken = document.getElementById('settingApiToken');
const settingsSave = document.getElementById('settingsSave');
const settingsClear = document.getElementById('settingsClear');

let isRecording = false;
let timerInterval = null;
let recordingStartTime = null;

// ─── Settings ────────────────────────────────────────────────────────────────

let settings = { apiUrl: '', appId: '', apiToken: '' };

async function loadSettings() {
  const stored = await browser.storage.local.get(['apiUrl', 'appId', 'apiToken']);
  settings = {
    apiUrl: stored.apiUrl || '',
    appId: stored.appId || '',
    apiToken: stored.apiToken || '',
  };
  settingApiUrl.value = settings.apiUrl;
  settingAppId.value = settings.appId;
  settingApiToken.value = settings.apiToken;
}

settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

settingsSave.addEventListener('click', async () => {
  settings = {
    apiUrl: settingApiUrl.value.trim().replace(/\/$/, ''),
    appId: settingAppId.value.trim(),
    apiToken: settingApiToken.value.trim(),
  };
  await browser.storage.local.set(settings);
  settingsPanel.classList.remove('open');
  setStatus('Settings saved', 'success');
  setTimeout(() => setStatus(isRecording ? 'Recording…' : 'Ready'), 2000);
});

settingsClear.addEventListener('click', async () => {
  settings = { apiUrl: '', appId: '', apiToken: '' };
  await browser.storage.local.remove(['apiUrl', 'appId', 'apiToken']);
  settingApiUrl.value = '';
  settingAppId.value = '';
  settingApiToken.value = '';
  setStatus('Settings cleared');
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = 'status' + (type ? ' ' + type : '');
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function startTimer(fromTime) {
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - fromTime;
    statTime.textContent = formatDuration(elapsed);
  }, 500);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function setRecordingUI(recording) {
  isRecording = recording;
  dot.className = 'dot' + (recording ? ' recording' : '');
  recordBtn.className = 'record-btn ' + (recording ? 'recording' : 'idle');
  btnIcon.textContent = recording ? '⏹' : '⏺';
  btnLabel.textContent = recording ? 'Stop Recording' : 'Start Recording';

  if (recording) {
    stats.className = 'stats visible';
    setStatus('Recording…', 'active');
  }
}

// ─── Init: check if already recording ───────────────────────────────────────

browser.runtime.sendMessage({ action: 'getState' }).then((state) => {
  if (state && state.isRecording) {
    setRecordingUI(true);
    recordingStartTime = state.startTime;
    startTimer(state.startTime);
  }
});

// ─── Main button click ───────────────────────────────────────────────────────

recordBtn.addEventListener('click', async () => {
  recordBtn.disabled = true;

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!isRecording) {
    // ── START ──────────────────────────────────────────────────────────────
    const bgResponse = await browser.runtime.sendMessage({
      action: 'startRecording',
      tabId: tab.id,
    });

    await browser.tabs.sendMessage(tab.id, {
      action: 'startRecording',
      startTime: bgResponse.startTime,
    });

    recordingStartTime = bgResponse.startTime;
    setRecordingUI(true);
    startTimer(bgResponse.startTime);
    statConsole.textContent = '0';
    statNetwork.textContent = '0';
  } else {
    // ── STOP ───────────────────────────────────────────────────────────────
    stopTimer();
    setStatus('Saving…');

    // Sequential stop: content script must flush its final batch to background
    // BEFORE we ask background to stop and return all accumulated events.
    // This guarantees no events are lost regardless of how many pages were visited.
    let bgData = { networkEvents: [], rrwebEvents: [], consoleEvents: [], interactionEvents: [] };

    try {
      // 1. Stop content script on the current page (triggers final flush to background)
      await browser.tabs.sendMessage(tab.id, { action: 'stopRecording' }).catch(() => {});
      // 2. Stop background — it now has events from all pages visited
      bgData = await browser.runtime.sendMessage({ action: 'stopRecording' });
    } catch (err) {
      setStatus('Error capturing data', '');
      recordBtn.disabled = false;
      return;
    }

    const rrwebEvents = bgData.rrwebEvents || [];
    const consoleEvents = bgData.consoleEvents || [];
    const networkEvents = bgData.networkEvents || [];
    const interactionEvents = bgData.interactionEvents || [];

    const duration =
      rrwebEvents.length > 1
        ? rrwebEvents[rrwebEvents.length - 1].timestamp - rrwebEvents[0].timestamp
        : Date.now() - recordingStartTime;

    // Update stats before resetting UI
    statConsole.textContent = consoleEvents.length;
    statNetwork.textContent = networkEvents.length;
    statTime.textContent = formatDuration(duration);

    const recording = {
      version: '1.0',
      meta: {
        url: tab.url,
        title: tab.title,
        recordedAt: new Date(recordingStartTime).toISOString(),
        duration,
        userAgent: navigator.userAgent,
      },
      rrwebEvents,
      consoleEvents,
      networkEvents,
      interactionEvents,
    };

    const filename = `jam-${new Date(recordingStartTime)
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-')}.json`;

    const saveResult = await saveRecording(recording, filename);

    setRecordingUI(false);
    if (saveResult.reelId) {
      setStatus(`Uploaded — ${rrwebEvents.length} events · ${networkEvents.length} requests`, 'success');
    } else {
      setStatus(`Saved — ${rrwebEvents.length} DOM events, ${consoleEvents.length} logs, ${networkEvents.length} requests`, 'success');
    }
  }

  recordBtn.disabled = false;
});

// ─── Save recording ──────────────────────────────────────────────────────────

async function saveRecording(data, filename) {
  const json = JSON.stringify(data);
  const encoded = new TextEncoder().encode(json);
  const compressed = fflate.gzipSync(encoded, { level: 6 });
  const jamFilename = filename.replace('.json', '.jam');

  // API mode: check storage backend then upload accordingly
  if (settings.apiUrl && settings.appId && settings.apiToken) {
    setStatus('Uploading…', 'active');

    const authHeader = { 'Authorization': `Bearer ${settings.apiToken}` };
    const base = `${settings.apiUrl}/api/apps/${settings.appId}`;

    // 1. Ask the server which storage backend is active
    const storageRes = await fetch(`${base}/storage`, { headers: authHeader });
    if (!storageRes.ok) throw new Error(`Storage check failed: ${storageRes.status}`);
    const { storage } = await storageRes.json();

    if (storage === 's3') {
      // 2a. S3: request a presigned PUT URL, then PUT directly to S3
      const urlRes = await fetch(`${base}/upload-url`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalName: jamFilename }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.message || `Upload URL request failed: ${urlRes.status}`);
      }
      const { id: reelId, uploadUrl } = await urlRes.json();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: compressed,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

      return { reelId };
    } else {
      // 2b. Local: POST the file directly as multipart to the API
      const formData = new FormData();
      formData.append('file', new Blob([compressed], { type: 'application/octet-stream' }), jamFilename);
      const uploadRes = await fetch(`${base}/reels`, {
        method: 'POST',
        headers: authHeader,
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error(err.message || `Upload failed: ${uploadRes.status}`);
      }
      const { id: reelId } = await uploadRes.json();
      return { reelId };
    }
  }

  // No API configured: download as .jam file locally
  const blob = new Blob([compressed], { type: 'application/gzip' });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url: blobUrl, filename: jamFilename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }
  return {};
}

loadSettings();
