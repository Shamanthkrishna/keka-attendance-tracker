// AT2 Advanced Attendance Tracker - Background Service Worker

// Simple background script without module imports for compatibility

// Simple token extraction and message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message.type);
  
  if (message.type === "GET_TOKEN") {
    // Extract token from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript(
          {
            target: { tabId: tabs[0].id },
            func: () => {
              // Try multiple token storage keys
              const possibleKeys = ['access_token', 'authToken', 'token', 'keka_token'];
              for (const key of possibleKeys) {
                const token = localStorage.getItem(key);
                if (token) return token;
              }
              // Try sessionStorage as well
              for (const key of possibleKeys) {
                const token = sessionStorage.getItem(key);
                if (token) return token;
              }
              return null;
            }
          },
          (results) => {
            const token = results?.[0]?.result;
            console.log('Token found:', !!token);
            sendResponse({ token: token, success: !!token });
          }
        );
      } else {
        sendResponse({ token: null, success: false, error: 'No active tab' });
      }
    });
    return true; // Keep message channel open
  }
  
  // Handle other message types
  switch (message.type) {
    case "SAVE_TOKEN":
      // For now, just acknowledge - could implement secure storage later
      sendResponse({ success: true });
      break;
      
    case "SCHEDULE_NOTIFICATIONS":
      // Placeholder for notification scheduling
      console.log('Scheduling notifications for logout time:', message.logoutTime);
      sendResponse({ success: true });
      break;
      
    case "CLEAR_NOTIFICATIONS":
      // Clear any existing alarms
      chrome.alarms.clearAll();
      sendResponse({ success: true });
      break;
      
    case "EXPORT_DATA":
      // Placeholder for export functionality
      sendResponse({ 
        success: true, 
        data: JSON.stringify({ message: "Export feature coming soon!" }) 
      });
      break;
      
    case "GET_STATUS":
      sendResponse({ 
        success: true, 
        status: { 
          initialized: true, 
          version: '2.0',
          timestamp: Date.now()
        } 
      });
      break;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Initialize storage manager
      await this.storage.initialize();
      
      // Set up alarm listeners
      this.setupAlarmListeners();
      
      // Set up notification listeners
      this.setupNotificationListeners();
      
      // Start auto-refresh if enabled
      await this.setupAutoRefresh();
      
      // Clean up on startup
      await this.cleanupOnStartup();
      
      this.isInitialized = true;
      console.log('AT2 Background service initialized');
    } catch (error) {
      console.error('Failed to initialize background service:', error);
    }
  }

  // Message handling
  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case "GET_TOKEN":
          const token = await this.getSecureToken();
          sendResponse({ token, success: true });
          break;

        case "SAVE_TOKEN":
          await this.saveSecureToken(message.token, message.temporary);
          sendResponse({ success: true });
          break;

        case "REFRESH_DATA":
          const data = await this.refreshAttendanceData();
          sendResponse({ data, success: true });
          break;

        case "SCHEDULE_NOTIFICATIONS":
          await this.scheduleNotifications(message.logoutTime, message.preferences);
          sendResponse({ success: true });
          break;

        case "CLEAR_NOTIFICATIONS":
          await this.clearAllNotifications();
          sendResponse({ success: true });
          break;

        case "EXPORT_DATA":
          const exportData = await this.exportAttendanceData(message.format, message.dateRange);
          sendResponse({ data: exportData, success: true });
          break;

        case "GET_STATUS":
          const status = await this.getServiceStatus();
          sendResponse({ status, success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Message handling error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // Secure token management
  async getSecureToken() {
    try {
      // First try to get from secure storage
      let token = await this.storage.getToken();
      
      if (!token) {
        // Fallback to extracting from active tab
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
              // Try multiple possible token storage locations
              const possibleKeys = ['access_token', 'authToken', 'token', 'keka_token'];
              for (const key of possibleKeys) {
                const token = localStorage.getItem(key);
                if (token) return token;
              }
              
              // Try sessionStorage as well
              for (const key of possibleKeys) {
                const token = sessionStorage.getItem(key);
                if (token) return token;
              }
              
              return null;
            }
          });
          
          token = results?.[0]?.result;
          
          // Save token securely if found
          if (token) {
            await this.storage.saveToken(token, true); // Temporary by default
          }
        }
      }
      
      return token;
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  }

  async saveSecureToken(token, temporary = false) {
    if (!token) {
      throw new Error('Token is required');
    }
    
    await this.storage.saveToken(token, temporary);
    
    // Start auto-refresh if token is saved
    await this.setupAutoRefresh();
  }

  // Auto-refresh functionality
  async setupAutoRefresh() {
    const preferences = await this.storage.getPreferences();
    
    if (preferences.autoRefresh) {
      // Clear existing alarm
      await chrome.alarms.clear('auto_refresh');
      
      // Create new alarm
      await chrome.alarms.create('auto_refresh', {
        delayInMinutes: CONFIG.AUTO_REFRESH.INTERVAL_MINUTES,
        periodInMinutes: CONFIG.AUTO_REFRESH.INTERVAL_MINUTES
      });
      
      this.activeAlarms.add('auto_refresh');
      console.log('Auto-refresh enabled');
    } else {
      await chrome.alarms.clear('auto_refresh');
      this.activeAlarms.delete('auto_refresh');
    }
  }

  async refreshAttendanceData() {
    try {
      const data = await this.api.fetchAttendanceData(false); // Force fresh data
      
      // Save to history
      await this.storage.saveAttendanceHistory(data);
      
      // Schedule notifications if needed
      const preferences = await this.storage.getPreferences();
      if (data.loginTime && preferences.notifications?.logoutReminder) {
        await this.scheduleLogoutReminders(data.loginTime, preferences);
      }
      
      return data;
    } catch (error) {
      console.error('Error refreshing attendance data:', error);
      throw error;
    }
  }

  // Notification system
  async scheduleNotifications(logoutTime, preferences) {
    if (!preferences.notifications?.logoutReminder) return;
    
    // Clear existing logout reminders
    await this.clearNotifications('logout_reminder');
    
    // Schedule new reminders
    await NotificationUtils.scheduleLogoutReminders(logoutTime, preferences);
    
    // Schedule break reminders if enabled
    if (preferences.notifications?.breakReminder) {
      await NotificationUtils.scheduleBreakReminders(preferences);
    }
  }

  async scheduleLogoutReminders(loginTime, preferences) {
    const { WorkdayCalculator } = await import('./js/utils.js');
    const logoutTimes = WorkdayCalculator.calculateLogoutTimes(loginTime, preferences);
    
    if (logoutTimes) {
      const selectedWorkday = preferences.workdayOption || 'FULL_DAY';
      const targetLogout = logoutTimes[selectedWorkday];
      
      if (targetLogout) {
        await this.scheduleNotifications(targetLogout.time, preferences);
      }
    }
  }

  async clearNotifications(prefix = null) {
    const alarms = await chrome.alarms.getAll();
    
    for (const alarm of alarms) {
      if (!prefix || alarm.name.startsWith(prefix)) {
        await chrome.alarms.clear(alarm.name);
        this.activeAlarms.delete(alarm.name);
      }
    }
  }

  async clearAllNotifications() {
    await chrome.alarms.clearAll();
    this.activeAlarms.clear();
    
    // Clear any existing notifications
    const notifications = await chrome.notifications.getAll();
    for (const id of Object.keys(notifications)) {
      await chrome.notifications.clear(id);
    }
  }

  // Alarm handling
  setupAlarmListeners() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      await this.handleAlarm(alarm);
    });
  }

  async handleAlarm(alarm) {
    try {
      console.log('Alarm triggered:', alarm.name);
      
      switch (true) {
        case alarm.name === 'auto_refresh':
          await this.handleAutoRefresh();
          break;
          
        case alarm.name.startsWith('logout_reminder_'):
          await this.handleLogoutReminder(alarm);
          break;
          
        case alarm.name === 'break_reminder':
          await this.handleBreakReminder();
          break;
          
        case alarm.name === 'storage_cleanup':
          await this.storage.cleanupStorage();
          break;
          
        default:
          console.log('Unknown alarm:', alarm.name);
      }
    } catch (error) {
      console.error('Alarm handling error:', error);
    }
  }

  async handleAutoRefresh() {
    try {
      // Only refresh if we have a valid token
      const token = await this.storage.getToken();
      if (token) {
        await this.refreshAttendanceData();
        console.log('Auto-refresh completed');
      }
    } catch (error) {
      console.error('Auto-refresh error:', error);
    }
  }

  async handleLogoutReminder(alarm) {
    const minutes = alarm.name.split('_')[2];
    
    await NotificationUtils.createNotification(`logout_reminder_${minutes}`, {
      title: 'AT2 - Logout Reminder',
      message: `${minutes} minutes until your logout time!`,
      iconUrl: 'icon.png',
      type: 'basic'
    });
  }

  async handleBreakReminder() {
    await NotificationUtils.createNotification('break_reminder', {
      title: 'AT2 - Break Reminder',
      message: 'Time for a break! Remember to take care of yourself.',
      iconUrl: 'icon.png',
      type: 'basic'
    });
  }

  // Notification click handling
  setupNotificationListeners() {
    chrome.notifications.onClicked.addListener(async (notificationId) => {
      await this.handleNotificationClick(notificationId);
    });

    chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
      await this.handleNotificationButtonClick(notificationId, buttonIndex);
    });
  }

  async handleNotificationClick(notificationId) {
    // Open popup or focus extension
    try {
      const popup = chrome.action.getPopup({});
      if (popup) {
        chrome.action.openPopup();
      }
    } catch (error) {
      console.error('Error opening popup:', error);
    }
    
    // Clear the notification
    await chrome.notifications.clear(notificationId);
  }

  async handleNotificationButtonClick(notificationId, buttonIndex) {
    // Handle notification button clicks (if we add buttons in the future)
    console.log('Notification button clicked:', notificationId, buttonIndex);
  }

  // Data export
  async exportAttendanceData(format, dateRange) {
    try {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      
      return await this.storage.exportData(format, { start: startDate, end: endDate });
    } catch (error) {
      console.error('Export error:', error);
      throw error;
    }
  }

  // Service status
  async getServiceStatus() {
    const token = await this.storage.getToken();
    const preferences = await this.storage.getPreferences();
    const storageUsage = await this.storage.getStorageUsage();
    const alarms = await chrome.alarms.getAll();
    
    return {
      initialized: this.isInitialized,
      hasToken: !!token,
      autoRefreshEnabled: preferences.autoRefresh,
      activeAlarms: alarms.length,
      storageUsage,
      apiStatus: this.api.getAPIStatus(),
      version: '2.0',
      timestamp: Date.now()
    };
  }

  // Cleanup
  async cleanupOnStartup() {
    try {
      // Clear any orphaned notifications
      const notifications = await chrome.notifications.getAll();
      for (const id of Object.keys(notifications)) {
        if (id.startsWith('at2_')) {
          await chrome.notifications.clear(id);
        }
      }
      
      // Validate and clean up alarms
      const alarms = await chrome.alarms.getAll();
      const validAlarmPrefixes = ['auto_refresh', 'logout_reminder', 'break_reminder', 'storage_cleanup'];
      
      for (const alarm of alarms) {
        const isValid = validAlarmPrefixes.some(prefix => alarm.name.startsWith(prefix));
        if (!isValid) {
          await chrome.alarms.clear(alarm.name);
        }
      }
      
      console.log('Startup cleanup completed');
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}

// Initialize background service
const backgroundService = new BackgroundService();

// Set up listeners immediately
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  backgroundService.handleMessage(message, sender, sendResponse);
  return true;
});

// Initialize when extension starts
chrome.runtime.onStartup.addListener(async () => {
  await backgroundService.initialize();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await backgroundService.initialize();
  
  if (details.reason === 'install') {
    console.log('AT2 Extension installed');
    
    // Show welcome notification
    await NotificationUtils.createNotification('welcome', {
      title: 'AT2 - Advanced Attendance Tracker',
      message: 'Extension installed! Click the extension icon to get started.',
      iconUrl: 'icon.png'
    });
  } else if (details.reason === 'update') {
    console.log('AT2 Extension updated to version 2.0');
    
    // Migrate old data if needed
    await backgroundService.storage.cleanupStorage();
  }
});

// Initialize immediately for service worker
backgroundService.initialize().catch(console.error);
  