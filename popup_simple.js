// AT2 Simple Popup Script â€” v2.1
console.log('AT2 Simple Popup loaded');

class SimpleAT2 {
  constructor() {
    this.currentData = null;
    this.timeInterval = null;
    this.isDarkTheme = localStorage.getItem('at2-theme') === 'dark';
    this.isCachedData = false;
  }

  async init() {
    console.log('Initializing Simple AT2...');

    this.applyTheme();
    this.setupEventListeners();
    this.startClock();

    // Always try to fetch fresh data; fall back to cache only on failure
    await this.loadData();

    // Load streak
    await this.loadStreak();

    console.log('Simple AT2 initialized successfully');
  }

  // â”€â”€â”€ Event listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setupEventListeners() {
    document.getElementById('refresh-btn')?.addEventListener('click', () => this.loadData());
    document.getElementById('theme-btn')?.addEventListener('click', () => this.toggleTheme());
    document.getElementById('export-btn')?.addEventListener('click', () => this.exportData());
  }

  // â”€â”€â”€ Data loading (fresh first, cached fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async loadData() {
    console.log('Loading attendance data...');
    this.showLoading();
    this.isCachedData = false;

    try {
      // 1) Get token (auto-detects Keka tab)
      const response = await this.sendMessage({ type: 'GET_TOKEN' });

      if (!response || !response.success || !response.token) {
        throw new Error('No Keka session found. Open Keka in any tab and refresh.');
      }

      console.log('Token received, fetching attendance data...');

      // 2) Fetch fresh data
      const attendanceData = await this.fetchAttendanceData(response.token, response.kekaBaseUrl);

      // 3) Cache it
      await this.sendMessage({ type: 'CACHE_DATA', data: attendanceData });

      // 4) Display
      this.displayData(attendanceData);

      // 5) Record streak
      await this.sendMessage({ type: 'RECORD_STREAK', loginTime: attendanceData.loginTime });

      // 6) Schedule notifications
      const logout9h = this.addHours(
        ...attendanceData.loginTime.split(':').map(Number).slice(0, 3),
        9, 0
      );
      await this.sendMessage({ type: 'SCHEDULE_NOTIFICATIONS', logoutTime: logout9h });

      // 7) Update badge
      await this.sendMessage({ type: 'UPDATE_BADGE' });

      this.showMessage('Data loaded successfully!', 'success');
      this.hideCachedNotice();

    } catch (error) {
      console.warn('Fresh fetch failed, trying cache:', error.message);

      // Fall back to offline cache
      try {
        const cacheResp = await this.sendMessage({ type: 'GET_CACHED_DATA' });
        if (cacheResp?.cached?.data) {
          this.isCachedData = true;
          this.displayData(cacheResp.cached.data);

          const age = Date.now() - (cacheResp.cached.timestamp || 0);
          const minsAgo = Math.round(age / 60000);
          this.showCachedNotice(`Showing cached data from ${minsAgo} min ago`);
          this.showMessage('Using cached data (offline)', 'success');
        } else {
          throw error; // no cache either
        }
      } catch (cacheErr) {
        console.error('Cache also unavailable:', cacheErr);
        this.showMessage(error.message, 'error');
      }
    } finally {
      this.hideLoading();
    }
  }

  async fetchAttendanceData(token, kekaBaseUrl) {
    if (!kekaBaseUrl) throw new Error('Could not detect Keka URL. Make sure you are logged into Keka in a browser tab.');
    const url = `${kekaBaseUrl}/k/attendance/api/mytime/attendance/summary`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const latest = data.data?.at(-1);

    if (!latest || !latest.firstLogOfTheDay) {
      throw new Error('No attendance data found for today');
    }

    const loginTime = latest.firstLogOfTheDay.split('T')[1];
    return { loginTime, rawData: latest };
  }

  // â”€â”€â”€ Display data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  displayData(data) {
    console.log('Displaying attendance data:', data);

    const { loginTime } = data;
    this.currentData = data;

    const loginParts = loginTime.split(':');
    const loginHours = parseInt(loginParts[0], 10);
    const loginMinutes = parseInt(loginParts[1], 10);
    const loginSeconds = parseInt(loginParts[2] || 0, 10);

    document.getElementById('login-time').textContent = this.formatTime(loginHours, loginMinutes, loginSeconds);

    const logout9h = this.addHours(loginHours, loginMinutes, loginSeconds, 9, 0);
    const logout832 = this.addHours(loginHours, loginMinutes, loginSeconds, 8, 32);

    document.getElementById('logout-9h').textContent = this.formatTime(logout9h.hours, logout9h.minutes, logout9h.seconds);
    document.getElementById('logout-832').textContent = this.formatTime(logout832.hours, logout832.minutes, logout832.seconds);

    this.updateProgress(loginHours, loginMinutes);
    document.getElementById('main-content').style.display = 'block';
  }

  addHours(hours, minutes, seconds, addH, addM) {
    let totalMinutes = hours * 60 + minutes + addH * 60 + addM;
    return {
      hours: Math.floor(totalMinutes / 60) % 24,
      minutes: totalMinutes % 60,
      seconds: seconds || 0
    };
  }

  formatTime(hours, minutes, seconds) {
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${String(displayHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${period}`;
  }

  // â”€â”€â”€ Progress + time remaining â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  updateProgress(loginHours, loginMinutes) {
    const now = new Date();
    const loginTotal = loginHours * 60 + loginMinutes;
    const currentTotal = now.getHours() * 60 + now.getMinutes();
    let workedMinutes = currentTotal - loginTotal;
    if (workedMinutes < 0) workedMinutes += 24 * 60;

    const workedH = Math.floor(workedMinutes / 60);
    const workedM = workedMinutes % 60;
    document.getElementById('worked-time').textContent = `${workedH}h ${workedM}m`;

    const target = 9 * 60;
    const pct = Math.min((workedMinutes / target) * 100, 100);
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = `${pct}%`;
    document.getElementById('progress-text').textContent = `${Math.round(pct)}% Complete`;

    const timeRemEl = document.getElementById('time-remaining');
    const overtimeEl = document.getElementById('overtime-indicator');

    if (workedMinutes > target) {
      const otMin = workedMinutes - target;
      const otH = Math.floor(otMin / 60);
      const otM = otMin % 60;
      document.getElementById('overtime-text').textContent = `${otH}h ${otM}m overtime`;
      overtimeEl.style.display = 'block';
      timeRemEl.style.display = 'none';
    } else {
      const remMin = target - workedMinutes;
      const remH = Math.floor(remMin / 60);
      const remM = remMin % 60;
      timeRemEl.textContent = `${remH}h ${remM}m remaining`;
      timeRemEl.style.display = 'block';
      overtimeEl.style.display = 'none';
    }
  }

  // â”€â”€â”€ Streak display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async loadStreak() {
    try {
      const resp = await this.sendMessage({ type: 'GET_STREAK' });
      if (!resp?.success) return;

      const streak = resp.streak;
      const card = document.getElementById('streak-card');
      if (!card) return;

      card.style.display = 'flex';

      const countEl = document.getElementById('streak-count');
      const labelEl = document.getElementById('streak-label');
      const bestEl  = document.getElementById('streak-best');

      countEl.textContent = streak.currentStreak || 0;
      bestEl.textContent  = streak.bestStreak || 0;

      if (streak.currentStreak > 0) {
        card.classList.remove('no-streak');
        if (streak.currentStreak >= 10) {
          labelEl.textContent = "UNSTOPPABLE! You're on fire! \uD83D\uDD25\uD83D\uDD25\uD83D\uDD25";
        } else if (streak.currentStreak >= 5) {
          labelEl.textContent = "Amazing streak! Keep it going! \uD83D\uDCAA";
        } else {
          labelEl.textContent = "You're on time! Keep it up!";
        }
      } else {
        card.classList.add('no-streak');
        labelEl.textContent = "Login before 10 AM to start a streak!";
      }
    } catch (err) {
      console.error('Streak load error:', err);
    }
  }

  // â”€â”€â”€ Clock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startClock() {
    this.updateClock();
    this.timeInterval = setInterval(() => {
      this.updateClock();
      if (this.currentData) {
        const parts = this.currentData.loginTime.split(':');
        this.updateProgress(parseInt(parts[0], 10), parseInt(parts[1], 10));
      }
    }, 1000);
  }

  updateClock() {
    const now = new Date();
    document.getElementById('current-time').textContent = `Current Time: ${now.toLocaleTimeString([], {
      hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
    })}`;
  }

  // â”€â”€â”€ Theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleTheme() {
    this.isDarkTheme = !this.isDarkTheme;
    this.applyTheme();
    localStorage.setItem('at2-theme', this.isDarkTheme ? 'dark' : 'light');
  }

  applyTheme() {
    document.body.classList.toggle('dark', this.isDarkTheme);
    const moonIcon = document.getElementById('moon-icon');
    const sunIcon = document.getElementById('sun-icon');
    if (moonIcon) moonIcon.style.display = this.isDarkTheme ? 'none' : 'block';
    if (sunIcon) sunIcon.style.display = this.isDarkTheme ? 'block' : 'none';
    const themeTooltip = document.querySelector('#theme-btn .tooltip');
    if (themeTooltip) themeTooltip.textContent = this.isDarkTheme ? 'Switch to light' : 'Switch to dark';
  }

  // â”€â”€â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  exportData() {
    if (!this.currentData) {
      this.showMessage('No data available to export', 'error');
      return;
    }

    const exportPayload = {
      timestamp: new Date().toISOString(),
      loginTime: this.currentData.loginTime,
      attendanceData: this.currentData.rawData
    };

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `at2-attendance-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showMessage('Data exported successfully!', 'success');
  }

  // â”€â”€â”€ UI helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showLoading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    document.getElementById('error').style.display = 'none';
    document.getElementById('success').style.display = 'none';
  }

  hideLoading() {
    document.getElementById('loading').style.display = 'none';
  }

  showMessage(message, type) {
    const errorEl = document.getElementById('error');
    const successEl = document.getElementById('success');

    // Use textContent to prevent XSS â€” build DOM safely
    if (type === 'error') {
      errorEl.textContent = '';
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = '\u26A0\uFE0F ' + message;
      errorEl.appendChild(div);
      errorEl.style.display = 'block';
      successEl.style.display = 'none';
    } else {
      successEl.textContent = '';
      const div = document.createElement('div');
      div.className = 'success';
      div.textContent = '\u2705 ' + message;
      successEl.appendChild(div);
      successEl.style.display = 'block';
      errorEl.style.display = 'none';
    }

    setTimeout(() => {
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
    }, 3000);
  }

  showCachedNotice(text) {
    const el = document.getElementById('cached-notice');
    if (el) {
      el.textContent = text;
      el.style.display = 'block';
    }
  }

  hideCachedNotice() {
    const el = document.getElementById('cached-notice');
    if (el) el.style.display = 'none';
  }

  // â”€â”€â”€ Messaging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });
  }

  // â”€â”€â”€ Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  cleanup() {
    if (this.timeInterval) clearInterval(this.timeInterval);
  }
}

// â”€â”€â”€ Bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('DOM loaded, initializing AT2...');
    const app = new SimpleAT2();
    await app.init();
    window.at2App = app;
  } catch (error) {
    console.error('Failed to initialize AT2:', error);
    const container = document.body.querySelector('.container');
    if (container) {
      container.textContent = '';
      const h = document.createElement('h3');
      h.style.cssText = 'padding:20px;text-align:center;color:#e74c3c';
      h.textContent = 'AT2 Error: ' + error.message;
      const btn = document.createElement('button');
      btn.textContent = 'Retry';
      btn.style.cssText = 'padding:10px 20px;margin-top:10px;background:#3498db;color:white;border:none;border-radius:5px;cursor:pointer';
      btn.addEventListener('click', () => location.reload());
      container.appendChild(h);
      container.appendChild(btn);
    }
  }
});

window.addEventListener('beforeunload', () => {
  if (window.at2App) window.at2App.cleanup();
});
