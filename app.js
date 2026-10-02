// ---------- Storage: everything lives only in this browser ----------
const STORAGE_KEY = 'cyclesync_entries';
const LAST_SYNCED_KEY = 'cyclesync_last_synced_snapshot';

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  refreshDirtyState();
}

function getLastSyncedSnapshot() {
  return localStorage.getItem(LAST_SYNCED_KEY) || '';
}

function setLastSyncedSnapshot(entries) {
  localStorage.setItem(LAST_SYNCED_KEY, JSON.stringify(entries));
}

let entries = loadEntries();

// ---------- Prediction engine (same logic as the earlier version) ----------
const MIN_PLAUSIBLE_CYCLE = 15;
const MAX_PLAUSIBLE_CYCLE = 45;
const CYCLES_TO_PREDICT = 6;
const APP_TAG = 'cycle-sync-app';

function sortedEntries() {
  return [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISO(date) { return date.toISOString().split('T')[0]; }

function getValidGaps() {
  const sorted = sortedEntries();
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / 86400000);
    if (diff >= MIN_PLAUSIBLE_CYCLE && diff <= MAX_PLAUSIBLE_CYCLE) gaps.push(diff);
  }
  return gaps;
}

function getRollingAverage() {
  const gaps = getValidGaps();
  if (gaps.length === 0) return null;
  const recent = gaps.slice(-6);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

function getUncertaintyBuffer() {
  const gaps = getValidGaps();
  if (gaps.length < 2) return 2;
  const recent = gaps.slice(-6);
  return Math.min(Math.max(Math.round((Math.max(...recent) - Math.min(...recent)) / 2), 2), 6);
}

function buildPredictions() {
  const avg = getRollingAverage();
  const sorted = sortedEntries();
  if (!avg || sorted.length === 0) return [];

  const buffer = getUncertaintyBuffer();
  const last = sorted[sorted.length - 1];
  const periodLength = last.length || 5;
  let cursor = new Date(last.date);

  const preds = [];
  for (let i = 1; i <= CYCLES_TO_PREDICT; i++) {
    cursor = addDays(cursor, avg);
    preds.push({
      cycleIndex: i,
      bestGuess: toISO(cursor),
      windowStart: toISO(addDays(cursor, -buffer)),
      windowEnd: toISO(addDays(cursor, periodLength + buffer)),
      avg, buffer,
    });
  }
  return preds;
}

// ---------- Google auth: client-side only, token lives in memory, never stored ----------
let accessToken = null;
let tokenClient = null;

// True when config.js still has the shipped placeholder rather than a real ID.
function clientIdLooksUnset() {
  const id = (CONFIG && CONFIG.GOOGLE_CLIENT_ID) || '';
  return (
    !id ||
    id.includes('YOUR_CLIENT_ID') ||
    !id.endsWith('.apps.googleusercontent.com')
  );
}

function initGoogleAuth() {
  if (clientIdLooksUnset()) {
    // Don't even try to init -- Google would return an opaque error. Tell the
    // maintainer exactly what's wrong instead.
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    callback: (tokenResponse) => {
      if (tokenResponse.error) {
        // Surface Google's actual reason (e.g. invalid_client, access_denied)
        // rather than a generic message, so setup issues are diagnosable.
        const reason = tokenResponse.error_description || tokenResponse.error;
        showToast('Google error: ' + reason);
        document.getElementById('syncResult').textContent =
          'Google sign-in returned: ' + reason + '. If this says invalid_client, the Client ID in config.js does not match a Google OAuth client — check it character-for-character in Google Cloud Console.';
        return;
      }
      accessToken = tokenResponse.access_token;
      document.getElementById('syncResult').textContent = '';
      updateConnectionUI(true);
    },
  });
}

document.getElementById('connectBtn').addEventListener('click', () => {
  if (clientIdLooksUnset()) {
    showToast('Client ID not set in config.js');
    document.getElementById('syncResult').textContent =
      'The Google Client ID in config.js is still the placeholder. Paste your real ...apps.googleusercontent.com ID into config.js and redeploy. Open yoursite/config.js in a browser to confirm what is actually live.';
    return;
  }
  if (!tokenClient) { showToast('Still loading Google sign-in — try again in a second.'); return; }
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
});

function updateConnectionUI(connected) {
  const status = document.getElementById('connStatus');
  const connectBtn = document.getElementById('connectBtn');
  const syncBtn = document.getElementById('syncBtn');
  if (connected) {
    status.textContent = 'Connected to Google Calendar';
    status.classList.add('connected');
    connectBtn.style.display = 'none';
    syncBtn.disabled = entries.length === 0;
    syncBtn.textContent = 'Sync now';
  } else {
    status.textContent = 'Not connected to Google Calendar';
    status.classList.remove('connected');
    connectBtn.style.display = 'inline-block';
    syncBtn.disabled = true;
    syncBtn.textContent = 'Connect Google Calendar first';
  }
  refreshDirtyState();
}

// ---------- Dirty-state detection: this is the "highlight sync button" logic ----------
function refreshDirtyState() {
  const syncBtn = document.getElementById('syncBtn');
  const syncDesc = document.getElementById('syncDesc');
  const dot = document.getElementById('syncDot');

  if (entries.length === 0) {
    dot.className = 'status-dot';
    syncDesc.textContent = 'Log a period to get started';
    return;
  }

  if (!accessToken) {
    dot.className = 'status-dot';
    syncDesc.textContent = 'Connect Google Calendar to enable syncing';
    return;
  }

  const currentSnapshot = JSON.stringify(sortedEntries());
  const lastSynced = getLastSyncedSnapshot();
  const isDirty = currentSnapshot !== lastSynced;

  syncBtn.disabled = false;
  syncBtn.textContent = 'Sync now';
  if (isDirty) {
    syncBtn.classList.add('dirty');
    dot.className = 'status-dot dot-dirty';
    syncDesc.textContent = 'Unsynced changes';
  } else {
    syncBtn.classList.remove('dirty');
    dot.className = 'status-dot dot-synced';
    syncDesc.textContent = 'Synced — up to date';
  }
}

// ---------- Calendar API calls, straight from the browser ----------
async function findExistingEvent(cycleIndex) {
  const params = new URLSearchParams();
  params.append('privateExtendedProperty', `app=${APP_TAG}`);
  params.append('privateExtendedProperty', `cycleIndex=${cycleIndex}`);
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Lookup failed: ' + res.status);
  const data = await res.json();
  return data.items && data.items.length > 0 ? data.items[0] : null;
}

async function upsertEvent(pred) {
  const body = {
    summary: `Period likely (best guess ${pred.bestGuess})`,
    description: `Predicted from a ${pred.avg}-day rolling average of your logged cycles, shown as a +/-${pred.buffer} day window. Log the real start date and sync again to refine this.`,
    start: { date: pred.windowStart },
    end: { date: pred.windowEnd },
    extendedProperties: { private: { app: APP_TAG, cycleIndex: String(pred.cycleIndex) } },
  };

  const existing = await findExistingEvent(pred.cycleIndex);
  const url = existing
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existing.id}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events`;

  const res = await fetch(url, {
    method: existing ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Write failed: ' + res.status);
  return existing ? 'updated' : 'created';
}

document.getElementById('syncBtn').addEventListener('click', async () => {
  if (!accessToken) { showToast('Connect Google Calendar first'); return; }
  const preds = buildPredictions();
  if (preds.length === 0) {
    document.getElementById('syncResult').textContent = 'Not enough logged data yet to predict a cycle.';
    return;
  }

  const btn = document.getElementById('syncBtn');
  btn.disabled = true;
  btn.textContent = 'Syncing...';

  try {
    let created = 0, updated = 0;
    for (const pred of preds) {
      const result = await upsertEvent(pred);
      if (result === 'created') created++; else updated++;
    }
    setLastSyncedSnapshot(sortedEntries());
    document.getElementById('syncResult').textContent =
      `Synced ${preds.length} predicted cycles (${created} created, ${updated} updated).`;
    showToast('Synced to Google Calendar');
  } catch (err) {
    // access token likely expired (they last ~1hr) — ask to reconnect
    document.getElementById('syncResult').textContent = 'Sync failed — try reconnecting Google Calendar (your session may have expired).';
    accessToken = null;
    updateConnectionUI(false);
  }
  refreshDirtyState();
});

// ---------- .ics export: the no-setup path that works with ANY calendar ----------
// Builds a standard iCalendar file from the same predictions the Google sync
// uses. No account, no OAuth, no server -- the user imports it into Google,
// Apple, Outlook, whatever. This is the default, lowest-friction option.
function buildICS() {
  const preds = buildPredictions();
  if (preds.length === 0) return null;

  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cycle Sync//Period Predictions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const pred of preds) {
    const start = pred.windowStart.replace(/-/g, '');
    const end = pred.windowEnd.replace(/-/g, '');
    // Stable UID per cycle index so re-importing an updated file replaces the
    // same event in calendars that honor UID, rather than duplicating.
    lines.push(
      'BEGIN:VEVENT',
      `UID:cyclesync-period-${pred.cycleIndex}@cyclesync.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:Period likely (best guess ${pred.bestGuess})`,
      `DESCRIPTION:Predicted from a ${pred.avg}-day rolling average of your logged cycles\\, shown as a +/-${pred.buffer} day window. Re-export after logging a new date to refine. Estimate only\\, not medical guidance.`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

document.getElementById('exportBtn').addEventListener('click', () => {
  const ics = buildICS();
  if (!ics) {
    document.getElementById('syncResult').textContent = 'Log at least two periods so there\'s a cycle length to predict from.';
    showToast('Not enough data yet');
    return;
  }
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cycle-sync-predictions.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Calendar file downloaded');
  document.getElementById('syncResult').textContent = 'Downloaded. Open the file to import it into any calendar (Google, Apple, Outlook). Re-export after logging new dates to refresh.';
});

// ---------- UI rendering ----------
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

let editingOriginalDate = null; // tracks which entry we're modifying, if any

function enterEditMode(date, length) {
  editingOriginalDate = date;
  document.getElementById('newDate').value = date;
  document.getElementById('newLength').value = length;
  const btn = document.getElementById('logBtn');
  btn.textContent = 'Save changes';
  btn.classList.add('editing');
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('newDate').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function exitEditMode() {
  editingOriginalDate = null;
  document.getElementById('newDate').value = '';
  document.getElementById('newLength').value = '';
  const btn = document.getElementById('logBtn');
  btn.textContent = 'Log period';
  btn.classList.remove('editing');
  document.getElementById('cancelEditBtn').style.display = 'none';
}

document.getElementById('cancelEditBtn').addEventListener('click', exitEditMode);

function render() {
  const sorted = sortedEntries();
  document.getElementById('historyBadge').textContent = entries.length + ' entries';
  const list = document.getElementById('logList');

  if (sorted.length === 0) {
    list.innerHTML = '<div class="empty-state">Nothing logged yet — your history will line up here as a timeline.</div>';
  } else {
    list.innerHTML = '';
    [...sorted].reverse().forEach((entry, idx) => {
      const realIdx = sorted.length - 1 - idx;
      let gapText = 'baseline';
      if (realIdx > 0) {
        const diff = Math.round((new Date(sorted[realIdx].date) - new Date(sorted[realIdx - 1].date)) / 86400000);
        gapText = diff + ' day cycle';
      }
      const div = document.createElement('div');
      div.className = 'timeline-item';
      div.innerHTML = `
        <div>
          <div class="date">${formatDate(entry.date)}</div>
          <div class="gap">${gapText} · ${entry.length || 5}d length</div>
        </div>
        <div class="timeline-actions">
          <div class="edit" data-date="${entry.date}" data-length="${entry.length || 5}">✎</div>
          <div class="del" data-date="${entry.date}">✕</div>
        </div>
      `;
      list.appendChild(div);
    });
    document.querySelectorAll('.edit').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.target;
        enterEditMode(target.getAttribute('data-date'), parseInt(target.getAttribute('data-length')));
      });
    });
    document.querySelectorAll('.del').forEach(el => {
      el.addEventListener('click', (e) => {
        const date = e.target.getAttribute('data-date');
        entries = entries.filter(en => en.date !== date);
        saveEntries(entries);
        if (editingOriginalDate === date) exitEditMode();
        render();
      });
    });
  }
  renderWheel();
  refreshDirtyState();
}

// ---------- Hero wheel: cycle-day ring + phase label ----------
const WHEEL_CIRCUMFERENCE = 2 * Math.PI * 104; // matches the SVG circle's r=104

function formatShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function renderWheel() {
  const sorted = sortedEntries();
  const dayEl = document.getElementById('wheelDay');
  const ofEl = document.getElementById('wheelOf');
  const phaseEl = document.getElementById('wheelPhase');
  const ringEl = document.getElementById('wheelProgress');
  const nextEl = document.getElementById('heroNext');

  if (sorted.length === 0) {
    dayEl.textContent = '–';
    ofEl.textContent = '';
    phaseEl.textContent = 'Log a period to begin';
    ringEl.style.strokeDashoffset = WHEEL_CIRCUMFERENCE;
    nextEl.innerHTML = '';
    return;
  }

  const last = sorted[sorted.length - 1];
  const periodLength = last.length || 5;
  const avg = getRollingAverage() || 28; // sensible default until there's enough real history
  const daysSince = Math.floor((new Date() - new Date(last.date)) / 86400000);
  const cycleDay = (daysSince % avg) + 1;

  dayEl.textContent = cycleDay;
  ofEl.textContent = `of ~${avg} day cycle`;

  const pct = Math.min(daysSince / avg, 1);
  ringEl.style.strokeDashoffset = WHEEL_CIRCUMFERENCE - pct * WHEEL_CIRCUMFERENCE;

  // simple, approximate phase banding -- illustrative, not a medical calculation
  const follicularEnd = Math.round(avg / 2) - 2;
  const ovulationEnd = Math.round(avg / 2) + 2;
  let phase;
  if (daysSince < periodLength) phase = 'Period';
  else if (daysSince <= follicularEnd) phase = 'Follicular phase';
  else if (daysSince <= ovulationEnd) phase = 'Ovulation window';
  else phase = 'Luteal phase';
  phaseEl.textContent = phase;

  const preds = buildPredictions();
  if (preds.length > 0) {
    nextEl.innerHTML = `Next period likely <strong>${formatShort(preds[0].bestGuess)}</strong> (±${preds[0].buffer}d)`;
  } else {
    nextEl.innerHTML = `Log one more period to start predicting`;
  }
}

document.getElementById('logBtn').addEventListener('click', () => {
  const dateVal = document.getElementById('newDate').value;
  const lengthVal = parseInt(document.getElementById('newLength').value) || 5;
  if (!dateVal) { showToast('Pick a date first'); return; }

  if (editingOriginalDate) {
    // saving an edit to an existing entry
    const clashesWithAnother = entries.some(e => e.date === dateVal && e.date !== editingOriginalDate);
    if (clashesWithAnother) { showToast('Another entry already uses that date'); return; }

    entries = entries.map(e =>
      e.date === editingOriginalDate ? { date: dateVal, length: lengthVal } : e
    );
    saveEntries(entries);
    exitEditMode();
    render();
    showToast('Entry updated');
    return;
  }

  if (entries.some(e => e.date === dateVal)) { showToast('Already logged'); return; }

  entries.push({ date: dateVal, length: lengthVal });
  saveEntries(entries);
  document.getElementById('newDate').value = '';
  document.getElementById('newLength').value = '';
  render();
  showToast('Period logged');
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- PWA install handling ----------
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function setupInstallCard() {
  if (isStandalone()) return; // already installed, nothing to show

  const chip = document.getElementById('installChip');
  const text = document.getElementById('installChipText');
  const btn = document.getElementById('installBtn');

  if (isIOS()) {
    // iOS Safari has no programmatic install prompt -- only a manual path via the share sheet.
    chip.style.display = 'flex';
    text.textContent = 'Add to Home Screen via Safari\'s Share button';
    btn.style.display = 'none';
  } else {
    // Chrome/Edge/Android fire this event when the app is installable; show a real button.
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      chip.style.display = 'flex';
      btn.style.display = 'inline-block';
    });
  }
}

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    document.getElementById('installChip').style.display = 'none';
  }
  deferredInstallPrompt = null;
});

// ---------- Boot ----------
window.addEventListener('load', () => {
  // google's script loads async, so give it a moment before wiring the token client
  const waitForGoogle = setInterval(() => {
    if (window.google && google.accounts) {
      clearInterval(waitForGoogle);
      initGoogleAuth();
    }
  }, 100);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }

  setupInstallCard();
});
render();
