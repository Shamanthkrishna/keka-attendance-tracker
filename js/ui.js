// UI management for AT2 Extension
import { CONFIG } from './config.js';
import { TimeUtils, WorkdayCalculator, UIUtils, ErrorHandler } from './utils.js';
import { StorageManager } from './storage.js';

export class UIManager {
  constructor() {
    this.storage = new StorageManager();
    this.currentTheme = 'light';
    this.realTimeInterval = null;
    this.elements = {};
    this.eventListeners = new Map();
  }

  // Initialize UI elements
  async initialize() {
    this.cacheElements();
    await this.loadTheme();
    await this.loadPreferences();
    this.setupEventListeners();
    this.setupKeyboardShortcuts();
    this.startRealTimeUpdates();
    this.updateAccessibility();
  }

  cacheElements() {
    this.elements = {
      // Time display elements
      login: document.getElementById('login'),
      logout9: document.getElementById('logout9'),
      logout832: document.getElementById('logout832'),
      currentTime: document.getElementById('current-time'),
      timeRemaining: document.getElementById('time-remaining'),
      
      // Control elements
      refreshBtn: document.getElementById('refresh-btn'),
      settingsBtn: document.getElementById('settings-btn'),
      themeToggle: document.getElementById('theme-toggle'),
      exportBtn: document.getElementById('export-btn'),
      
      // Settings panel elements
      settingsPanel: document.getElementById('settings-panel'),
      workdaySelect: document.getElementById('workday-select'),
      timeFormatSelect: document.getElementById('time-format'),
      breakTimeInput: document.getElementById('break-time'),
      notificationToggles: document.querySelectorAll('.notification-toggle'),
      
      // Progress and status elements
      workProgress: document.getElementById('work-progress'),
      progressBars: document.querySelectorAll('.progress-bar'),
      statusIndicator: document.getElementById('status-indicator'),
      loadingSpinner: document.getElementById('loading-spinner'),
      
      // Containers and panels
      container: document.querySelector('.container'),
      attendanceInfo: document.querySelector('.attendance-info'),
      errorContainer: document.getElementById('error-container'),
      
      // Additional time displays
      customLogout: document.getElementById('custom-logout'),
      overtimeIndicator: document.getElementById('overtime-indicator')
    };
  }

  setupEventListeners() {
    // Refresh button
    if (this.elements.refreshBtn) {
      const debouncedRefresh = UIUtils.debounce(() => this.refreshData(), CONFIG.UI.DEBOUNCE_DELAY);
      this.addEventListener(this.elements.refreshBtn, 'click', debouncedRefresh);
    }

    // Settings button
    if (this.elements.settingsBtn) {
      this.addEventListener(this.elements.settingsBtn, 'click', () => this.toggleSettings());
    }

    // Theme toggle
    if (this.elements.themeToggle) {
      this.addEventListener(this.elements.themeToggle, 'click', () => this.toggleTheme());
    }

    // Export button
    if (this.elements.exportBtn) {
      this.addEventListener(this.elements.exportBtn, 'click', () => this.showExportDialog());
    }

    // Settings form elements
    if (this.elements.workdaySelect) {
      this.addEventListener(this.elements.workdaySelect, 'change', (e) => this.updateWorkdayOption(e.target.value));
    }

    if (this.elements.timeFormatSelect) {
      this.addEventListener(this.elements.timeFormatSelect, 'change', (e) => this.updateTimeFormat(e.target.value));
    }

    if (this.elements.breakTimeInput) {
      const debouncedBreakUpdate = UIUtils.debounce(
        (e) => this.updateBreakTime(parseInt(e.target.value)), 
        CONFIG.UI.DEBOUNCE_DELAY
      );
      this.addEventListener(this.elements.breakTimeInput, 'input', debouncedBreakUpdate);
    }

    // Notification toggles
    this.elements.notificationToggles.forEach(toggle => {
      this.addEventListener(toggle, 'change', (e) => 
        this.updateNotificationSetting(e.target.dataset.notification, e.target.checked)
      );
    });

    // Window focus events for real-time updates
    this.addEventListener(window, 'focus', () => this.onWindowFocus());
    this.addEventListener(window, 'blur', () => this.onWindowBlur());
  }

  addEventListener(element, event, handler) {
    if (!element) return;
    
    const wrappedHandler = (e) => {
      try {
        handler(e);
      } catch (error) {
        ErrorHandler.logError(error, `Event handler: ${event}`);
      }
    };

    element.addEventListener(event, wrappedHandler);
    
    // Store for cleanup
    const key = `${element.id || 'anonymous'}_${event}`;
    this.eventListeners.set(key, { element, event, handler: wrappedHandler });
  }

  setupKeyboardShortcuts() {
    this.addEventListener(document, 'keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'r':
            e.preventDefault();
            this.refreshData();
            break;
          case 't':
            e.preventDefault();
            this.toggleTheme();
            break;
          case 's':
            e.preventDefault();
            this.toggleSettings();
            break;
          case 'e':
            e.preventDefault();
            this.showExportDialog();
            break;
        }
      }

      // Escape key to close panels
      if (e.key === 'Escape') {
        this.closeAllPanels();
      }
    });
  }

  // Theme management
  async loadTheme() {
    const preferences = await this.storage.getPreferences();
    let theme = preferences.theme;

    if (theme === 'auto') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    this.applyTheme(theme);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (preferences.theme === 'auto') {
        this.applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update theme toggle icon
    if (this.elements.themeToggle) {
      const icon = this.elements.themeToggle.querySelector('.theme-icon');
      if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
      }
    }

    // Announce theme change for accessibility
    this.announceToScreenReader(`Theme changed to ${theme} mode`);
  }

  async toggleTheme() {
    const preferences = await this.storage.getPreferences();
    const themes = Object.values(CONFIG.THEMES);
    const currentIndex = themes.indexOf(preferences.theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    
    await this.storage.updatePreference('theme', nextTheme);
    
    if (nextTheme !== 'auto') {
      this.applyTheme(nextTheme);
    } else {
      await this.loadTheme(); // Reload to apply auto theme
    }
  }

  // Settings panel management
  async loadPreferences() {
    const preferences = await this.storage.getPreferences();
    
    // Update form elements
    if (this.elements.workdaySelect) {
      this.elements.workdaySelect.value = preferences.workdayOption;
    }
    
    if (this.elements.timeFormatSelect) {
      this.elements.timeFormatSelect.value = preferences.timeFormat;
    }
    
    if (this.elements.breakTimeInput) {
      this.elements.breakTimeInput.value = preferences.breakTimeMinutes;
    }

    // Update notification toggles
    this.elements.notificationToggles.forEach(toggle => {
      const notificationKey = toggle.dataset.notification;
      if (preferences.notifications && preferences.notifications[notificationKey] !== undefined) {
        toggle.checked = preferences.notifications[notificationKey];
      }
    });
  }

  toggleSettings() {
    if (!this.elements.settingsPanel) return;
    
    const isVisible = this.elements.settingsPanel.classList.contains('visible');
    
    if (isVisible) {
      this.elements.settingsPanel.classList.remove('visible');
      this.elements.settingsBtn?.setAttribute('aria-expanded', 'false');
    } else {
      this.elements.settingsPanel.classList.add('visible');
      this.elements.settingsBtn?.setAttribute('aria-expanded', 'true');
      
      // Focus first form element
      const firstInput = this.elements.settingsPanel.querySelector('input, select');
      firstInput?.focus();
    }
  }

  closeAllPanels() {
    this.elements.settingsPanel?.classList.remove('visible');
    this.elements.settingsBtn?.setAttribute('aria-expanded', 'false');
  }

  // Data display methods
  async updateAttendanceDisplay(attendanceData, preferences = null) {
    if (!preferences) {
      preferences = await this.storage.getPreferences();
    }

    try {
      // Update login time
      if (this.elements.login && attendanceData.loginTime) {
        const formattedLogin = TimeUtils.formatTime(
          attendanceData.parsedLoginTime, 
          preferences.timeFormat, 
          preferences.showSeconds
        );
        this.updateTimeDisplay(this.elements.login, formattedLogin);
      }

      // Calculate and display logout times
      const logoutTimes = WorkdayCalculator.calculateLogoutTimes(attendanceData.loginTime, preferences);
      
      if (logoutTimes) {
        if (this.elements.logout9) {
          this.updateTimeDisplay(this.elements.logout9, logoutTimes.FULL_DAY.formatted);
        }
        
        if (this.elements.logout832) {
          this.updateTimeDisplay(this.elements.logout832, logoutTimes.STANDARD.formatted);
        }
        
        if (this.elements.customLogout && preferences.workdayOption === 'CUSTOM') {
          this.updateTimeDisplay(this.elements.customLogout, logoutTimes.CUSTOM.formatted);
        }
      }

      // Update work progress
      this.updateWorkProgress(attendanceData, preferences);
      
      // Update status indicator
      this.updateStatusIndicator(attendanceData);
      
      // Update time remaining
      this.updateTimeRemaining(attendanceData, preferences);

    } catch (error) {
      ErrorHandler.logError(error, 'updateAttendanceDisplay');
      this.showError('Failed to update display');
    }
  }

  updateTimeDisplay(element, timeString) {
    if (!element) return;
    
    // Add fade effect during update
    element.style.opacity = '0.7';
    element.textContent = timeString;
    
    setTimeout(() => {
      element.style.opacity = '1';
    }, 150);
  }

  updateWorkProgress(attendanceData, preferences) {
    if (!this.elements.workProgress || !attendanceData.workedDuration) return;

    const progress = WorkdayCalculator.calculateWorkProgress(
      attendanceData.loginTime, 
      attendanceData.currentTime
    );

    if (!progress) return;

    const workdayOption = preferences.workdayOption;
    const currentProgress = progress.progress[workdayOption];
    
    if (currentProgress) {
      // Update progress bar
      const progressBar = this.elements.workProgress.querySelector('.progress-fill');
      if (progressBar) {
        UIUtils.updateProgressBar(progressBar, currentProgress.percentage);
        
        // Update progress text
        const progressText = this.elements.workProgress.querySelector('.progress-text');
        if (progressText) {
          progressText.textContent = `${Math.round(currentProgress.percentage)}% Complete`;
        }
      }

      // Update worked time display
      const workedTimeElement = document.getElementById('worked-time');
      if (workedTimeElement) {
        const workedTime = progress.workedTime;
        workedTimeElement.textContent = 
          `${workedTime.hours}h ${workedTime.minutes}m worked`;
      }
    }
  }

  updateStatusIndicator(attendanceData) {
    if (!this.elements.statusIndicator) return;

    const now = new Date();
    const currentHour = now.getHours();
    
    let status = 'working';
    let statusText = 'Working';
    let statusClass = 'status-working';

    // Determine status based on time and data
    if (currentHour < 9) {
      status = 'early';
      statusText = 'Early Bird';
      statusClass = 'status-early';
    } else if (currentHour > 18) {
      status = 'overtime';
      statusText = 'Overtime';
      statusClass = 'status-overtime';
    } else if (attendanceData.lastLogout) {
      status = 'completed';
      statusText = 'Day Complete';
      statusClass = 'status-complete';
    }

    this.elements.statusIndicator.className = `status-indicator ${statusClass}`;
    this.elements.statusIndicator.textContent = statusText;
    this.elements.statusIndicator.setAttribute('title', `Current status: ${statusText}`);
  }

  updateTimeRemaining(attendanceData, preferences) {
    if (!this.elements.timeRemaining) return;

    const logoutTimes = WorkdayCalculator.calculateLogoutTimes(attendanceData.loginTime, preferences);
    const selectedWorkday = preferences.workdayOption;
    
    if (logoutTimes && logoutTimes[selectedWorkday]) {
      const targetLogout = logoutTimes[selectedWorkday].time;
      const current = TimeUtils.getCurrentTime();
      
      const remaining = TimeUtils.calculateOvertimeRemaining(current, targetLogout);
      
      if (remaining) {
        const remainingText = remaining.isOvertime 
          ? `${remaining.hours}h ${remaining.minutes}m overtime`
          : `${remaining.hours}h ${remaining.minutes}m remaining`;
          
        this.elements.timeRemaining.textContent = remainingText;
        this.elements.timeRemaining.className = remaining.isOvertime 
          ? 'time-remaining overtime' 
          : 'time-remaining';
      }
    }
  }

  // Real-time updates
  startRealTimeUpdates() {
    this.stopRealTimeUpdates(); // Clear any existing interval
    
    this.realTimeInterval = setInterval(() => {
      this.updateCurrentTime();
      this.updateRealTimeElements();
    }, 1000);
  }

  stopRealTimeUpdates() {
    if (this.realTimeInterval) {
      clearInterval(this.realTimeInterval);
      this.realTimeInterval = null;
    }
  }

  updateCurrentTime() {
    if (!this.elements.currentTime) return;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString([], { 
      hour12: true, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
    
    this.elements.currentTime.textContent = timeString;
  }

  async updateRealTimeElements() {
    // Update elements that need real-time refresh
    try {
      const cachedData = await this.storage.getCachedAttendanceData();
      if (cachedData) {
        const preferences = await this.storage.getPreferences();
        
        // Update work progress and time remaining
        this.updateWorkProgress({ 
          ...cachedData, 
          currentTime: TimeUtils.getCurrentTime() 
        }, preferences);
        
        this.updateTimeRemaining({ 
          ...cachedData, 
          currentTime: TimeUtils.getCurrentTime() 
        }, preferences);
      }
    } catch (error) {
      // Silently handle errors in real-time updates
      console.error('Real-time update error:', error);
    }
  }

  // Window focus handlers
  onWindowFocus() {
    this.startRealTimeUpdates();
    // Refresh data when window gains focus
    setTimeout(() => this.refreshData(), 1000);
  }

  onWindowBlur() {
    // Reduce update frequency when window loses focus
    this.stopRealTimeUpdates();
  }

  // Loading states
  showLoading(message = 'Loading...') {
    if (this.elements.loadingSpinner) {
      this.elements.loadingSpinner.style.display = 'flex';
      
      const loadingText = this.elements.loadingSpinner.querySelector('.loading-text');
      if (loadingText) {
        loadingText.textContent = message;
      }
    }

    // Show loading state on time displays
    [this.elements.login, this.elements.logout9, this.elements.logout832].forEach(element => {
      if (element && !element.textContent.includes('...')) {
        element.textContent = 'Loading...';
        element.classList.add('loading');
      }
    });

    this.announceToScreenReader(message);
  }

  hideLoading() {
    if (this.elements.loadingSpinner) {
      this.elements.loadingSpinner.style.display = 'none';
    }

    // Remove loading state from elements
    document.querySelectorAll('.loading').forEach(element => {
      element.classList.remove('loading');
    });
  }

  // Error handling
  showError(message, type = 'error') {
    if (!this.elements.errorContainer) return;

    this.elements.errorContainer.innerHTML = `
      <div class="error-message ${type}" role="alert">
        <span class="error-icon">⚠️</span>
        <span class="error-text">${message}</span>
        <button class="error-close" aria-label="Close error message">×</button>
      </div>
    `;

    this.elements.errorContainer.style.display = 'block';

    // Auto-hide after 5 seconds
    setTimeout(() => this.hideError(), 5000);

    // Close button handler
    const closeBtn = this.elements.errorContainer.querySelector('.error-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideError());
    }

    this.announceToScreenReader(`Error: ${message}`);
  }

  hideError() {
    if (this.elements.errorContainer) {
      this.elements.errorContainer.style.display = 'none';
    }
  }

  // Preference update handlers
  async updateWorkdayOption(option) {
    await this.storage.updatePreference('workdayOption', option);
    this.refreshData();
  }

  async updateTimeFormat(format) {
    await this.storage.updatePreference('timeFormat', format);
    this.refreshData();
  }

  async updateBreakTime(minutes) {
    await this.storage.updatePreference('breakTimeMinutes', minutes);
    this.refreshData();
  }

  async updateNotificationSetting(key, enabled) {
    const preferences = await this.storage.getPreferences();
    preferences.notifications[key] = enabled;
    await this.storage.savePreferences(preferences);
  }

  // Export functionality
  showExportDialog() {
    // Implementation would show a dialog for export options
    // This is a placeholder for the export feature
    console.log('Export dialog would be shown here');
  }

  // Accessibility
  updateAccessibility() {
    // Update ARIA labels and roles
    document.querySelectorAll('[data-time]').forEach(element => {
      if (element.textContent && element.textContent !== 'Loading...') {
        element.setAttribute('aria-label', `Time: ${element.textContent}`);
      }
    });

    // Update progress bars
    this.elements.progressBars.forEach(bar => {
      const percentage = bar.style.width ? parseInt(bar.style.width) : 0;
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', percentage.toString());
      bar.setAttribute('aria-label', `Work progress: ${percentage}%`);
    });
  }

  announceToScreenReader(message) {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }

  // Public methods for external use
  async refreshData() {
    this.showLoading('Refreshing data...');
    
    try {
      // This will be called from the main popup.js
      const event = new CustomEvent('refreshRequested');
      document.dispatchEvent(event);
    } catch (error) {
      this.showError('Failed to refresh data');
    }
  }

  // Cleanup
  destroy() {
    this.stopRealTimeUpdates();
    
    // Remove all event listeners
    this.eventListeners.forEach(({ element, event, handler }) => {
      element.removeEventListener(event, handler);
    });
    this.eventListeners.clear();
  }
}