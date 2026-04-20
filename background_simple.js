// AT2 Advanced Attendance Tracker - Background Service Worker
console.log('AT2 Background script loaded');

// â”€â”€â”€ Badge helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setBadge(text, color) {
  chrome.action.setBadgeText({ text: String(text) });
  chrome.action.setBadgeBackgroundColor({ color: color || '#667eea' });
}

function clearBadge() {
  chrome.action.setBadgeText({ text: '' });
}

// â”€â”€â”€ Auto-detect Keka tab (searches ALL tabs, not just active) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function findKekaToken() {
  try {
    const tabs = await chrome.tabs.query({});
    // Prioritise keka.com tabs
    const kekaTabs = tabs.filter(t => t.url && t.url.includes('keka.com'));

    for (const tab of kekaTabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const possibleKeys = ['access_token', 'authToken', 'token', 'keka_token'];
            for (const key of possibleKeys) {
              const t = localStorage.getItem(key);
              if (t) return t;
            }
            for (const key of possibleKeys) {
              const t = sessionStorage.getItem(key);
              if (t) return t;
            }
            return null;
          }
        });
        const token = results?.[0]?.result;
        if (token) {
          console.log('Token found from Keka tab:', tab.url);
          return token;
        }
      } catch (err) {
        // Tab might not be scriptable â€“ skip
        console.warn('Cannot script tab', tab.id, err.message);
      }
    }

    // Fallback: try active tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const possibleKeys = ['access_token', 'authToken', 'token', 'keka_token'];
            for (const key of possibleKeys) {
              const t = localStorage.getItem(key);
              if (t) return t;
            }
            for (const key of possibleKeys) {
              const t = sessionStorage.getItem(key);
              if (t) return t;
            }
            return null;
          }
        });
        const token = results?.[0]?.result;
        if (token) return token;
      } catch (e) {
        console.warn('Active tab not scriptable:', e.message);
      }
    }

    return null;
  } catch (err) {
    console.error('findKekaToken error:', err);
    return null;
  }
}

// â”€â”€â”€ Offline cache helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function cacheAttendanceData(data) {
  await chrome.storage.local.set({
    at2_cached_attendance: {
      data,
      timestamp: Date.now()
    }
  });
}

async function getCachedAttendanceData() {
  const result = await chrome.storage.local.get('at2_cached_attendance');
  return result.at2_cached_attendance || null;
}

// â”€â”€â”€ Streak helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function recordStreak(loginTimeStr) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const result = await chrome.storage.local.get('at2_streak');
  const streak = result.at2_streak || { days: [], currentStreak: 0, bestStreak: 0 };

  // Determine if "on-time" â€” before 10:00 AM counts as on-time
  const parts = loginTimeStr.split(':');
  const loginHour = parseInt(parts[0], 10);
  const loginMin = parseInt(parts[1], 10);
  const isOnTime = loginHour < 10 || (loginHour === 10 && loginMin === 0);

  // Already recorded today?
  if (streak.days.length > 0 && streak.days[streak.days.length - 1].date === today) {
    return streak; // don't double-count
  }

  streak.days.push({ date: today, onTime: isOnTime, login: loginTimeStr });

  // Recalculate current streak from the end
  let current = 0;
  for (let i = streak.days.length - 1; i >= 0; i--) {
    if (streak.days[i].onTime) {
      current++;
      // Check consecutive dates
      if (i > 0) {
        const prev = new Date(streak.days[i - 1].date);
        const curr = new Date(streak.days[i].date);
        const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diffDays > 1) break; // gap in dates
      }
    } else {
      break;
    }
  }
  streak.currentStreak = current;
  streak.bestStreak = Math.max(streak.bestStreak, current);

  // Keep only last 90 days
  if (streak.days.length > 90) {
    streak.days = streak.days.slice(-90);
  }

  await chrome.storage.local.set({ at2_streak: streak });
  return streak;
}

async function getStreak() {
  const result = await chrome.storage.local.get('at2_streak');
  return result.at2_streak || { days: [], currentStreak: 0, bestStreak: 0 };
}

// â”€â”€â”€ Notification helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scheduleLogoutNotifications(logoutTime9h) {
  // Clear existing alarms first
  await chrome.alarms.clearAll();

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Build target Date from logoutTime9h {hours, minutes}
  const target = new Date(`${todayStr}T${String(logoutTime9h.hours).padStart(2,'0')}:${String(logoutTime9h.minutes).padStart(2,'0')}:00`);

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
      console.log(`Alarm "${r.name}" scheduled for`, alarmTime.toLocaleTimeString());
    }
  }

  // Also set a badge-update alarm every 1 minute
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
      logout_0:  '9 hours complete â€” time to logout!'
    };

    const msg = messages[alarm.name] || 'Logout reminder';

    try {
      chrome.notifications.create(alarm.name + '_' + Date.now(), {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'AT2 â€” Logout Reminder',
        message: msg,
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

// Update badge with remaining time
async function updateBadge() {
  try {
    const cache = await getCachedAttendanceData();
    if (!cache?.data?.loginTime) { clearBadge(); return; }

    const parts = cache.data.loginTime.split(':');
    const loginH = parseInt(parts[0], 10);
    const loginM = parseInt(parts[1], 10);
    const loginTotal = loginH * 60 + loginM;
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

// â”€â”€â”€ Message handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type);

  if (message.type === 'GET_TOKEN') {
    // Auto-detect Keka tab (async)
    findKekaToken().then(token => {
      sendResponse({ token, success: !!token });
    }).catch(err => {
      console.error('GET_TOKEN error:', err);
      sendResponse({ token: null, success: false, error: err.message });
    });
    return true; // async
  }

  if (message.type === 'CACHE_DATA') {
    cacheAttendanceData(message.data).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_CACHED_DATA') {
    getCachedAttendanceData().then(cached => {
      sendResponse({ success: true, cached });
    });
    return true;
  }

  if (message.type === 'RECORD_STREAK') {
    recordStreak(message.loginTime).then(streak => {
      sendResponse({ success: true, streak });
    });
    return true;
  }

  if (message.type === 'GET_STREAK') {
    getStreak().then(streak => {
      sendResponse({ success: true, streak });
    });
    return true;
  }

  if (message.type === 'SCHEDULE_NOTIFICATIONS') {
    scheduleLogoutNotifications(message.logoutTime).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLEAR_NOTIFICATIONS') {
    chrome.alarms.clearAll().then(() => {
      clearBadge();
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    updateBadge().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse({
      success: true,
      status: { initialized: true, version: '2.1', timestamp: Date.now() }
    });
    return false;
  }

  // Default
  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

// â”€â”€â”€ Startup / Install â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
chrome.runtime.onInstalled.addListener((details) => {
  console.log('AT2 Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    chrome.notifications.create('welcome', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'AT2 â€” Installed!',
      message: 'Click the extension icon while logged into Keka to get started.',
      priority: 1
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('AT2 Extension started');
  updateBadge();
});

// Initial badge update
updateBadge();

console.log('AT2 Background script ready');
