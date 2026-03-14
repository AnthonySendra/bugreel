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

let isRecording = false;
let timerInterval = null;
let recordingStartTime = null;

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

    let contentData = { rrwebEvents: [], consoleEvents: [] };
    let bgData = { networkEvents: [] };

    try {
      [contentData, bgData] = await Promise.all([
        browser.tabs.sendMessage(tab.id, { action: 'stopRecording' }),
        browser.runtime.sendMessage({ action: 'stopRecording' }),
      ]);
    } catch (err) {
      setStatus('Error capturing data', '');
      recordBtn.disabled = false;
      return;
    }

    const duration =
      contentData.rrwebEvents.length > 1
        ? contentData.rrwebEvents[contentData.rrwebEvents.length - 1].timestamp -
          contentData.rrwebEvents[0].timestamp
        : Date.now() - recordingStartTime;

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
    };

    const filename = `jam-${new Date(recordingStartTime)
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, '-')}.json`;

    await saveRecording(recording, filename);

    setRecordingUI(false);
    setStatus(`Saved — ${contentData.rrwebEvents.length} DOM events, ${contentData.consoleEvents.length} logs, ${bgData.networkEvents.length} requests`, 'success');
  }

  recordBtn.disabled = false;
});

// ─── Save to disk ────────────────────────────────────────────────────────────

async function saveRecording(data, filename) {
  const json = JSON.stringify(data);
  const encoded = new TextEncoder().encode(json);
  const compressed = fflate.gzipSync(encoded, { level: 6 });
  const blob = new Blob([compressed], { type: 'application/gzip' });
  const blobUrl = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url: blobUrl,
      filename: filename.replace('.json', '.jam'),
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }
}
