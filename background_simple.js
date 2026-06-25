// AT2 Advanced Attendance Tracker - Background Service Worker
console.log('AT2 Background script loaded');

// --- Badge helpers -----------------------------------------------------------
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color: color || '#667eea' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// --- Token management --------------------------------------------------------
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

// Check stored token first (saved by content.js even when Keka tab is closed),
// then fall back to scripting a live Keka tab.
async function findKekaToken() {
  try {
    // 1) Use token saved by content script (works without Keka open)
    const stored = await chrome.storage.local.get(['at2_token', 'at2_token_ts', 'at2_keka_origin']);
    if (stored.at2_token && stored.at2_keka_origin) {
      const age = Date.now() - (stored.at2_token_ts || 0);
      if (age < TOKEN_MAX_AGE_MS) {
        console.log('Token from storage (age:', Math.round(age / 60000), 'min)');
        return { token: stored.at2_token, kekaBaseUrl: stored.at2_keka_origin };
      }
      // Expired — clear it and fall through to live tab
      await chrome.storage.local.remove(['at2_token', 'at2_token_ts', 'at2_keka_origin']);
      console.log('Stored token expired, falling back to live tab');
    }

    // 2) Script live Keka tabs
    const tabs = await chrome.tabs.query({});
    const kekaTabs = tabs.filter(t => t.url && t.url.includes('keka.com'));

    for (const tab of kekaTabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const keys = ['access_token', 'authToken', 'token', 'keka_token'];
            for (const k of keys) {
              const t = localStorage.getItem(k) || sessionStorage.getItem(k);
              if (t) return t;
            }
            return null;
          }
        });
        const token = results?.[0]?.result;
        if (token) {
          const origin = new URL(tab.url).origin;
          await chrome.storage.local.set({ at2_token: token, at2_token_ts: Date.now(), at2_keka_origin: origin });
          console.log('Token found from live Keka tab:', tab.url);
          return { token, kekaBaseUrl: origin };
        }
      } catch (err) {
        console.warn('Cannot script tab', tab.id, err.message);
      }
    }

    return { token: null, kekaBaseUrl: null };
  } catch (err) {
    console.error('findKekaToken error:', err);
    return { token: null, kekaBaseUrl: null };
  }
}

// --- Offline cache helpers ---------------------------------------------------
async function cacheAttendanceData(data) {
  await chrome.storage.local.set({
    at2_cached_attendance: { data, timestamp: Date.now() }
  });
}

async function getCachedAttendanceData() {
  const result = await chrome.storage.local.get('at2_cached_attendance');
  return result.at2_cached_attendance || null;
}

// --- Streak helpers ----------------------------------------------------------
async function recordStreak(loginTimeStr) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const result = await chrome.storage.local.get('at2_streak');
  const streak = result.at2_streak || { days: [], currentStreak: 0, bestStreak: 0 };

  // On-time = logged in before or at 10:00 AM
  const [h, m] = loginTimeStr.split(':').map(Number);
  const isOnTime = h < 10 || (h === 10 && m === 0);

  // Don't double-count today
  if (streak.days.length > 0 && streak.days[streak.days.length - 1].date === today) {
    return streak;
  }

  streak.days.push({ date: today, onTime: isOnTime, login: loginTimeStr });

  // Recalculate current streak from the end, skipping weekends
  let current = 0;
  for (let i = streak.days.length - 1; i >= 0; i--) {
    if (!streak.days[i].onTime) break;
    current++;
    if (i > 0) {
      const prev = new Date(streak.days[i - 1].date);
      const curr = new Date(streak.days[i].date);
      const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
      // Allow Friday->Monday gap (3 days) and Friday->Saturday->Monday (skip weekend)
      const prevDay = prev.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
      const maxAllowedGap = prevDay === 5 ? 3 : (prevDay === 4 ? 4 : 1); // Fri->Mon=3, Thu->Mon via long weekend edge
      if (diffDays > maxAllowedGap) break;
    }
  }
  streak.currentStreak = current;
  streak.bestStreak = Math.max(streak.bestStreak, current);

  // Keep only last 90 days
  if (streak.days.length > 90) streak.days = streak.days.slice(-90);

  await chrome.storage.local.set({ at2_streak: streak });
  return streak;
}

async function getStreak() {
  const result = await chrome.storage.local.get('at2_streak');
  return result.at2_streak || { days: [], currentStreak: 0, bestStreak: 0 };
}

// --- Notification helpers ----------------------------------------------------
async function scheduleLogoutNotifications(logoutTime9h) {
  await chrome.alarms.clearAll();

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const target = new Date(
    `${todayStr}T${String(logoutTime9h.hours).padStart(2, '0')}:${String(logoutTime9h.minutes).padStart(2, '0')}:00`
  );

  const reminders = [
    { name: 'logout_30', minsBefore: 30, msg: '30 minutes until 9-hour logout!' },
    { name: 'logout_15', minsBefore: 15, msg: '15 minutes until 9-hour logout!' },
    { name: 'logout_5',  minsBefore: 5,  msg: '5 minutes until 9-hour logout!' },
    { name: 'logout_0',  minsBefore: 0,  msg: 'Time to logout! 9 hours complete.' }
  ];

  for (const r of reminders) {
    const alarmTime = new Date(target.getTime() - r.minsBefore * 60 * 1000);
    if (alarmTime > now) {
      await chrome.alarms.create(r.name, { when: alarmTime.getTime() });
      console.log(`Alarm "${r.name}" set for`, alarmTime.toLocaleTimeString());
    }
  }

  await chrome.alarms.create('badge_update', { periodInMinutes: 1 });
}

// Handle alarm fires
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('Alarm fired:', alarm.name);

  if (alarm.name.startsWith('logout_')) {
    const messages = {
      logout_30: '30 minutes until your 9-hour logout time!',
      logout_15: '15 minutes until your 9-hour logout time!',
      logout_5:  '5 minutes until your 9-hour logout time! Wrap up!',
      logout_0:  '9 hours complete — time to logout!'
    };
    try {
      chrome.notifications.create(alarm.name + '_' + Date.now(), {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'AT2 — Logout Reminder',
        message: messages[alarm.name] || 'Logout reminder',
        priority: 2
      });
    } catch (err) {
      console.error('Notification error:', err);
    }
  }

  if (alarm.name === 'badge_update') {
    await updateBadge();
  }
});

// --- Badge updater -----------------------------------------------------------
async function updateBadge() {
  try {
    const cache = await getCachedAttendanceData();
    if (!cache?.data?.loginTime) { clearBadge(); return; }

    const [lh, lm] = cache.data.loginTime.split(':').map(Number);
    const loginTotal = lh * 60 + lm;
    const now = new Date();
    const nowTotal = now.getHours() * 60 + now.getMinutes();
    let worked = nowTotal - loginTotal;
    if (worked < 0) worked += 24 * 60;

    const target = 9 * 60;
    const remaining = target - worked;

    if (remaining <= 0) {
      setBadge('Done', '#10b981');
    } else if (remaining <= 30) {
      const h = Math.floor(remaining / 60);
      const m = remaining % 60;
      setBadge(h > 0 ? `${h}h${m}` : `${m}m`, '#ef4444');
    } else if (remaining <= 60) {
      const h = Math.floor(remaining / 60);
      const m = remaining % 60;
      setBadge(h > 0 ? `${h}h${m}` : `${m}m`, '#f59e0b');
    } else {
      const h = Math.floor(remaining / 60);
      const m = remaining % 60;
      setBadge(`${h}h${m}`, '#667eea');
    }
  } catch (err) {
    console.error('Badge update error:', err);
    clearBadge();
  }
}

// --- Message handling --------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type);

  if (message.type === 'GET_TOKEN') {
    findKekaToken().then(({ token, kekaBaseUrl }) => {
      sendResponse({ token, success: !!token, kekaBaseUrl });
    }).catch(err => {
      console.error('GET_TOKEN error:', err);
      sendResponse({ token: null, success: false, kekaBaseUrl: null, error: err.message });
    });
    return true;
  }

  if (message.type === 'CACHE_DATA') {
    cacheAttendanceData(message.data).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'GET_CACHED_DATA') {
    getCachedAttendanceData().then(cached => sendResponse({ success: true, cached }));
    return true;
  }

  if (message.type === 'RECORD_STREAK') {
    recordStreak(message.loginTime).then(streak => sendResponse({ success: true, streak }));
    return true;
  }

  if (message.type === 'GET_STREAK') {
    getStreak().then(streak => sendResponse({ success: true, streak }));
    return true;
  }

  if (message.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleLogoutNotifications(message.logoutTime).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'CLEAR_NOTIFICATIONS') {
    chrome.alarms.clearAll().then(() => { clearBadge(); sendResponse({ success: true }); });
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    updateBadge().then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({ success: true, status: { initialized: true, version: '2.1', timestamp: Date.now() } });
    return false;
  }

  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

// --- Startup / Install -------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  console.log('AT2 Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    chrome.notifications.create('welcome', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AT2 — Installed!',
      message: 'Open Keka once to authorize, then the extension works even with Keka closed.',
      priority: 1
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('AT2 Extension started');
  updateBadge();
});

updateBadge();
console.log('AT2 Background script ready');
