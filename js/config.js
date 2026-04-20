// Configuration constants for AT2 Extension
export const CONFIG = {
  // API Configuration
  API: {
    BASE_URL: 'https://your-subdomain.keka.com', // Replace with your Keka subdomain (e.g., companyname.keka.com)
    ENDPOINTS: {
      ATTENDANCE_SUMMARY: '/k/attendance/api/mytime/attendance/summary',
      EMPLOYEE_PROFILE: '/k/employee/api/profile'
    },
    TIMEOUT: 10000, // 10 seconds
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000 // 1 second
  },

  // Storage Keys
  STORAGE_KEYS: {
    ACCESS_TOKEN: 'keka_access_token',
    ATTENDANCE_DATA: 'attendance_data',
    USER_PREFERENCES: 'user_preferences',
    CACHED_DATA: 'cached_attendance_data',
    LAST_SYNC: 'last_sync_time',
    THEME: 'selected_theme',
    WORKDAY_OPTION: 'workday_option',
    BREAK_TIME: 'break_time_minutes',
    NOTIFICATION_SETTINGS: 'notification_settings'
  },

  // Workday Options
  WORKDAY_OPTIONS: {
    FULL_DAY: { hours: 9, minutes: 0, label: '9 Hours' },
    STANDARD: { hours: 8, minutes: 32, label: '8 Hours 32 Minutes' },
    SHORT: { hours: 8, minutes: 0, label: '8 Hours' },
    HALF_DAY: { hours: 4, minutes: 30, label: '4 Hours 30 Minutes' },
    CUSTOM: { hours: 0, minutes: 0, label: 'Custom' }
  },

  // Break Time Options (in minutes)
  BREAK_OPTIONS: [0, 15, 30, 45, 60, 90, 120],

  // Time Formats
  TIME_FORMATS: {
    '12_HOUR': '12-hour',
    '24_HOUR': '24-hour'
  },

  // Themes
  THEMES: {
    LIGHT: 'light',
    DARK: 'dark',
    AUTO: 'auto'
  },

  // Notification Settings
  NOTIFICATIONS: {
    LOGOUT_REMINDER: {
      ENABLED: true,
      MINUTES_BEFORE: [30, 15, 5]
    },
    BREAK_REMINDER: {
      ENABLED: true,
      INTERVAL_MINUTES: 120
    },
    OVERTIME_ALERT: {
      ENABLED: true,
      THRESHOLD_MINUTES: 30
    }
  },

  // Auto-refresh Settings
  AUTO_REFRESH: {
    INTERVAL_MINUTES: 15,
    ENABLED: true
  },

  // Cache Settings
  CACHE: {
    EXPIRY_MINUTES: 30,
    MAX_ENTRIES: 100
  },

  // UI Settings
  UI: {
    ANIMATION_DURATION: 300,
    DEBOUNCE_DELAY: 500,
    LOADING_TIMEOUT: 5000
  },

  // Default User Preferences
  DEFAULT_PREFERENCES: {
    theme: 'auto',
    timeFormat: '12-hour',
    workdayOption: 'FULL_DAY',
    breakTimeMinutes: 30,
    notifications: {
      logoutReminder: true,
      breakReminder: true,
      overtimeAlert: true
    },
    autoRefresh: true,
    showSeconds: true,
    compactView: false
  },

  // Export Options
  EXPORT: {
    FORMATS: ['CSV', 'JSON', 'PDF'],
    DATE_RANGES: ['WEEK', 'MONTH', 'QUARTER', 'CUSTOM']
  },

  // Keyboard Shortcuts
  SHORTCUTS: {
    REFRESH: 'Ctrl+R',
    TOGGLE_THEME: 'Ctrl+T',
    EXPORT_DATA: 'Ctrl+E',
    SETTINGS: 'Ctrl+S'
  }
};

// Validation helpers
export const VALIDATORS = {
  isValidToken: (token) => {
    return typeof token === 'string' && token.length > 0 && token.trim() !== '';
  },
  
  isValidTime: (timeString) => {
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
    return timeRegex.test(timeString);
  },
  
  isValidWorkdayOption: (option) => {
    return Object.keys(CONFIG.WORKDAY_OPTIONS).includes(option);
  },
  
  isValidTheme: (theme) => {
    return Object.values(CONFIG.THEMES).includes(theme);
  }
};

// Helper functions
export const HELPERS = {
  getWorkdayDuration: (option) => {
    const workday = CONFIG.WORKDAY_OPTIONS[option];
    return workday ? workday.hours * 60 + workday.minutes : 0;
  },
  
  formatStorageKey: (key, userId = null) => {
    return userId ? `${key}_${userId}` : key;
  },
  
  isExpired: (timestamp, expiryMinutes = CONFIG.CACHE.EXPIRY_MINUTES) => {
    const now = Date.now();
    const expiry = timestamp + (expiryMinutes * 60 * 1000);
    return now > expiry;
  }
};