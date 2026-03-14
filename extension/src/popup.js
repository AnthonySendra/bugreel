/**
 * popup.js — shared popup script (Firefox MV2 + Chrome MV3)
 */

const ext = typeof browser !== 'undefined' ? browser : chrome;

const recordBtn = document.getElementById('recordBtn');
const btnIcon = document.getElementById('btnIcon');
const btnLabel = document.getElementById('btnLabel');
const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');
const stats = document.getElementById('stats');
const statTime = document.getElementById('statTime');
const statConsole = document.getElementById('statConsole');
const statNetwork = document.getElementById('statNetwork');
const uploadUrlInput = document.getElementById('uploadUrl');
const saveConnectBtn = document.getElementById('saveConnectBtn');

let isRecording = false;
let timerInterval = null;
let recordingStartTime = null;

// ─── Connect settings ────────────────────────────────────────────────────────

ext.storage.local.get(['uploadUrl']).then((stored) => {
  if (stored.uploadUrl) uploadUrlInput.value = stored.uploadUrl;
});

saveConnectBtn.addEventListener('click', async () => {
  const uploadUrl = uploadUrlInput.value.trim();
  await ext.storage.local.set({ uploadUrl });
  saveConnectBtn.textContent = 'Saved!';
  setTimeout(() => { saveConnectBtn.textContent = 'Save'; }, 1500);
});

// ─── Upload to server ────────────────────────────────────────────────────────

async function uploadReel(recording, filename, { uploadUrl }) {
  setStatus('Uploading…', 'active');

  const blob = compressRecording(recording);
  const formData = new FormData();
  formData.append('file', blob, filename);

  try {
    const res = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      setStatus('Uploaded!', 'success');
    } else {
      const data = await res.json().catch(() => ({}));
      setStatus(`Upload failed: ${data.message || res.status}`, '');
    }
  } catch (err) {
    setStatus('Upload failed — check server URL', '');
  }
}

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

ext.runtime.sendMessage({ action: 'getState' }).then((state) => {
  if (state && state.isRecording) {
    setRecordingUI(true);
    recordingStartTime = state.startTime;
    startTimer(state.startTime);
  }
});

// ─── Main button click ───────────────────────────────────────────────────────

recordBtn.addEventListener('click', async () => {
  recordBtn.disabled = true;

  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!isRecording) {
    // ── START ──────────────────────────────────────────────────────────────
    const bgResponse = await ext.runtime.sendMessage({
      action: 'startRecording',
      tabId: tab.id,
    });

    await ext.tabs.sendMessage(tab.id, {
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

    let contentData = { rrwebEvents: [], consoleEvents: [] };
    let bgData = { networkEvents: [] };

    try {
      [contentData, bgData] = await Promise.all([
        ext.tabs.sendMessage(tab.id, { action: 'stopRecording' }),
        ext.runtime.sendMessage({ action: 'stopRecording' }),
      ]);
    } catch (err) {
      setStatus('Error capturing data', '');
      recordBtn.disabled = false;
      return;
    }

    const duration = Date.now() - recordingStartTime;

    // Update stats before resetting UI
    statConsole.textContent = contentData.consoleEvents.length;
    statNetwork.textContent = bgData.networkEvents.length;
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
      rrwebEvents: contentData.rrwebEvents,
      consoleEvents: contentData.consoleEvents,
      networkEvents: bgData.networkEvents,
      htmlSnapshot: contentData.htmlSnapshot || null,
    };

    const filename = `bugreel-${new Date(recordingStartTime)
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-')}.json`;

    const reelFilename = filename.replace('.json', '.reel');
    const stored = await ext.storage.local.get(['uploadUrl']);
    const serverConfigured = !!stored.uploadUrl;

    setRecordingUI(false);

    if (serverConfigured) {
      await uploadReel(recording, reelFilename, stored);
    } else {
      await saveLocally(recording, reelFilename);
      setStatus(`Saved — ${contentData.rrwebEvents.length} DOM events, ${contentData.consoleEvents.length} logs, ${bgData.networkEvents.length} requests`, 'success');
    }
  }

  recordBtn.disabled = false;
});

// ─── Compress recording ───────────────────────────────────────────────────────

function compressRecording(data) {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const compressed = fflate.gzipSync(encoded, { level: 6 });
  return new Blob([compressed], { type: 'application/gzip' });
}

// ─── Save to disk ────────────────────────────────────────────────────────────

async function saveLocally(data, filename) {
  const blob = compressRecording(data);
  const blobUrl = URL.createObjectURL(blob);
  try {
    await ext.downloads.download({ url: blobUrl, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }
}
