// Utility functions for AT2 Extension
import { CONFIG, VALIDATORS } from './config.js';

export class TimeUtils {
  static addTime(baseTime, hours, minutes = 0) {
    if (!VALIDATORS.isValidTime(baseTime)) {
      throw new Error('Invalid base time format');
    }

    const [baseHours, baseMinutes, baseSeconds] = baseTime.split(":").map(Number);
    
    // Add the hours and minutes to the time
    let totalMinutes = baseHours * 60 + baseMinutes + hours * 60 + minutes;
    
    // Calculate the new hours and minutes
    let newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    const newSeconds = baseSeconds || 0;
    
    return { hours: newHours, minutes: newMinutes, seconds: newSeconds };
  }

  static formatTime(timeObj, format = '12-hour', includeSeconds = true) {
    let { hours, minutes, seconds = 0 } = timeObj;
    
    if (format === '12-hour') {
      const period = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours === 0 ? 12 : hours;
      
      const timeStr = includeSeconds 
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      
      return `${timeStr} ${period}`;
    } else {
      const timeStr = includeSeconds 
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      
      return timeStr;
    }
  }

  static getCurrentTime() {
    const now = new Date();
    return {
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      timestamp: now.getTime()
    };
  }

  static parseTimeString(timeString) {
    if (!timeString || typeof timeString !== 'string') return null;
    
    // Handle ISO datetime format
    if (timeString.includes('T')) {
      const timePart = timeString.split('T')[1];
      const [hours, minutes, seconds] = timePart.split(':').map(Number);
      return { hours, minutes, seconds: seconds || 0 };
    }
    
    // Handle regular time format
    const parts = timeString.split(':');
    if (parts.length >= 2) {
      return {
        hours: parseInt(parts[0], 10),
        minutes: parseInt(parts[1], 10),
        seconds: parts[2] ? parseInt(parts[2], 10) : 0
      };
    }
    
    return null;
  }

  static calculateTimeDifference(startTime, endTime) {
    const start = typeof startTime === 'string' ? this.parseTimeString(startTime) : startTime;
    const end = typeof endTime === 'string' ? this.parseTimeString(endTime) : endTime;
    
    if (!start || !end) return null;
    
    const startMinutes = start.hours * 60 + start.minutes;
    const endMinutes = end.hours * 60 + end.minutes;
    
    let diffMinutes = endMinutes - startMinutes;
    
    // Handle next day scenario
    if (diffMinutes < 0) {
      diffMinutes += 24 * 60;
    }
    
    return {
      hours: Math.floor(diffMinutes / 60),
      minutes: diffMinutes % 60,
      totalMinutes: diffMinutes
    };
  }

  static calculateOvertimeRemaining(currentTime, targetLogoutTime) {
    const current = typeof currentTime === 'string' ? this.parseTimeString(currentTime) : currentTime;
    const target = typeof targetLogoutTime === 'string' ? this.parseTimeString(targetLogoutTime) : targetLogoutTime;
    
    if (!current || !target) return null;
    
    const diff = this.calculateTimeDifference(current, target);
    const isOvertime = diff.totalMinutes < 0;
    
    return {
      isOvertime,
      remaining: isOvertime ? Math.abs(diff.totalMinutes) : diff.totalMinutes,
      hours: Math.floor(Math.abs(diff.totalMinutes) / 60),
      minutes: Math.abs(diff.totalMinutes) % 60
    };
  }
}

export class WorkdayCalculator {
  static calculateLogoutTimes(loginTime, preferences = {}) {
    const login = TimeUtils.parseTimeString(loginTime);
    if (!login) return null;

    const workdayOption = preferences.workdayOption || 'FULL_DAY';
    const breakTimeMinutes = preferences.breakTimeMinutes || 0;
    const customHours = preferences.customWorkdayHours || 0;
    const customMinutes = preferences.customWorkdayMinutes || 0;

    const results = {};

    // Calculate for all workday options
    Object.entries(CONFIG.WORKDAY_OPTIONS).forEach(([key, option]) => {
      let workHours = option.hours;
      let workMinutes = option.minutes;

      // Use custom values for CUSTOM option
      if (key === 'CUSTOM') {
        workHours = customHours;
        workMinutes = customMinutes;
      }

      const logoutTime = TimeUtils.addTime(
        loginTime, 
        workHours, 
        workMinutes + breakTimeMinutes
      );

      results[key] = {
        time: logoutTime,
        formatted: TimeUtils.formatTime(logoutTime, preferences.timeFormat, preferences.showSeconds),
        label: option.label,
        totalWorkMinutes: workHours * 60 + workMinutes,
        breakMinutes: breakTimeMinutes
      };
    });

    return results;
  }

  static calculateWorkProgress(loginTime, currentTime = null) {
    const login = TimeUtils.parseTimeString(loginTime);
    const current = currentTime ? TimeUtils.parseTimeString(currentTime) : TimeUtils.getCurrentTime();
    
    if (!login || !current) return null;

    const workedTime = TimeUtils.calculateTimeDifference(login, current);
    if (!workedTime) return null;

    const progress = {};

    Object.entries(CONFIG.WORKDAY_OPTIONS).forEach(([key, option]) => {
      const totalRequired = option.hours * 60 + option.minutes;
      const percentage = Math.min((workedTime.totalMinutes / totalRequired) * 100, 100);
      
      progress[key] = {
        percentage,
        completed: percentage >= 100,
        remaining: Math.max(totalRequired - workedTime.totalMinutes, 0)
      };
    });

    return {
      workedTime,
      progress
    };
  }
}

export class ValidationUtils {
  static validateToken(token) {
    if (!token || typeof token !== 'string') {
      return { valid: false, error: 'Token is required and must be a string' };
    }
    
    if (token.trim().length === 0) {
      return { valid: false, error: 'Token cannot be empty' };
    }
    
    // Basic JWT structure validation
    if (token.includes('.') && token.split('.').length === 3) {
      return { valid: true };
    }
    
    // Basic token format validation (assuming bearer token)
    if (token.length < 10) {
      return { valid: false, error: 'Token appears to be too short' };
    }
    
    return { valid: true };
  }

  static validatePreferences(preferences) {
    const errors = [];
    
    if (preferences.theme && !VALIDATORS.isValidTheme(preferences.theme)) {
      errors.push('Invalid theme selection');
    }
    
    if (preferences.workdayOption && !VALIDATORS.isValidWorkdayOption(preferences.workdayOption)) {
      errors.push('Invalid workday option');
    }
    
    if (preferences.breakTimeMinutes && (preferences.breakTimeMinutes < 0 || preferences.breakTimeMinutes > 480)) {
      errors.push('Break time must be between 0 and 480 minutes');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export class NotificationUtils {
  static async createNotification(id, options) {
    if (!chrome.notifications) {
      console.warn('Notifications API not available');
      return false;
    }

    try {
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icon.png',
        title: options.title || 'AT2 Notification',
        message: options.message,
        priority: options.priority || 1,
        ...options
      });
      return true;
    } catch (error) {
      console.error('Error creating notification:', error);
      return false;
    }
  }

  static async scheduleLogoutReminders(logoutTime, preferences) {
    if (!preferences.notifications?.logoutReminder) return;

    const logout = TimeUtils.parseTimeString(logoutTime);
    if (!logout) return;

    const reminderTimes = CONFIG.NOTIFICATIONS.LOGOUT_REMINDER.MINUTES_BEFORE;
    
    for (const minutesBefore of reminderTimes) {
      const reminderTime = TimeUtils.addTime(logoutTime, 0, -minutesBefore);
      const alarmTime = new Date();
      alarmTime.setHours(reminderTime.hours, reminderTime.minutes, 0, 0);
      
      // Only schedule if the reminder time is in the future
      if (alarmTime.getTime() > Date.now()) {
        chrome.alarms.create(`logout_reminder_${minutesBefore}`, {
          when: alarmTime.getTime()
        });
      }
    }
  }

  static async scheduleBreakReminders(preferences) {
    if (!preferences.notifications?.breakReminder) return;

    const intervalMinutes = CONFIG.NOTIFICATIONS.BREAK_REMINDER.INTERVAL_MINUTES;
    
    chrome.alarms.create('break_reminder', {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    });
  }
}

export class UIUtils {
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  static animate(element, className, duration = CONFIG.UI.ANIMATION_DURATION) {
    return new Promise((resolve) => {
      element.classList.add(className);
      setTimeout(() => {
        element.classList.remove(className);
        resolve();
      }, duration);
    });
  }

  static showLoading(element, text = 'Loading...') {
    if (!element) return;
    
    element.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span class="loading-text">${text}</span>
      </div>
    `;
    element.classList.add('loading');
  }

  static hideLoading(element) {
    if (!element) return;
    
    element.classList.remove('loading');
  }

  static updateProgressBar(element, percentage, animated = true) {
    if (!element) return;
    
    const progressBar = element.querySelector('.progress-fill') || element;
    
    if (animated) {
      progressBar.style.transition = 'width 0.3s ease';
    }
    
    progressBar.style.width = `${Math.min(Math.max(percentage, 0), 100)}%`;
    
    // Update ARIA attributes for accessibility
    progressBar.setAttribute('aria-valuenow', percentage);
  }

  static formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export class ErrorHandler {
  static handle(error, context = '') {
    console.error(`Error in ${context}:`, error);
    
    // Determine error type and create user-friendly message
    let userMessage = 'An unexpected error occurred.';
    
    if (error.name === 'NetworkError' || error.message.includes('fetch')) {
      userMessage = 'Network connection error. Please check your internet connection.';
    } else if (error.message.includes('token')) {
      userMessage = 'Authentication error. Please refresh the page and try again.';
    } else if (error.message.includes('timeout')) {
      userMessage = 'Request timed out. Please try again.';
    }
    
    return {
      error,
      userMessage,
      context,
      timestamp: new Date().toISOString()
    };
  }

  static async logError(error, context = '') {
    const errorData = this.handle(error, context);
    
    // Store error in local storage for debugging
    try {
      const errorLog = await chrome.storage.local.get('error_log') || { error_log: [] };
      errorLog.error_log.push(errorData);
      
      // Keep only last 50 errors
      if (errorLog.error_log.length > 50) {
        errorLog.error_log = errorLog.error_log.slice(-50);
      }
      
      await chrome.storage.local.set({ error_log: errorLog.error_log });
    } catch (storageError) {
      console.error('Failed to log error to storage:', storageError);
    }
    
    return errorData;
  }
}