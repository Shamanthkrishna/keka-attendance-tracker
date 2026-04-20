// Storage management for AT2 Extension
import { CONFIG, HELPERS } from './config.js';

export class StorageManager {
  constructor() {
    this.cache = new Map();
    this.syncInProgress = false;
  }

  // Secure token management
  async saveToken(token, temporary = false) {
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token provided');
    }

    const storageArea = temporary ? chrome.storage.session : chrome.storage.local;
    await storageArea.set({
      [CONFIG.STORAGE_KEYS.ACCESS_TOKEN]: {
        value: token,
        timestamp: Date.now(),
        temporary
      }
    });
  }

  async getToken() {
    try {
      // Try session storage first (more secure)
      let result = await chrome.storage.session.get(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
      if (result[CONFIG.STORAGE_KEYS.ACCESS_TOKEN]) {
        return result[CONFIG.STORAGE_KEYS.ACCESS_TOKEN].value;
      }

      // Fallback to local storage
      result = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.ACCESS_TOKEN);
      if (result[CONFIG.STORAGE_KEYS.ACCESS_TOKEN]) {
        const tokenData = result[CONFIG.STORAGE_KEYS.ACCESS_TOKEN];
        
        // Check if token is expired (24 hours for local storage)
        if (HELPERS.isExpired(tokenData.timestamp, 24 * 60)) {
          await this.removeToken();
          return null;
        }
        
        return tokenData.value;
      }

      return null;
    } catch (error) {
      console.error('Error retrieving token:', error);
      return null;
    }
  }

  async removeToken() {
    await Promise.all([
      chrome.storage.session.remove(CONFIG.STORAGE_KEYS.ACCESS_TOKEN),
      chrome.storage.local.remove(CONFIG.STORAGE_KEYS.ACCESS_TOKEN)
    ]);
  }

  // User preferences management
  async savePreferences(preferences) {
    const merged = { ...CONFIG.DEFAULT_PREFERENCES, ...preferences };
    await chrome.storage.local.set({
      [CONFIG.STORAGE_KEYS.USER_PREFERENCES]: merged
    });
    return merged;
  }

  async getPreferences() {
    try {
      const result = await chrome.storage.local.get(CONFIG.STORAGE_KEYS.USER_PREFERENCES);
      return { ...CONFIG.DEFAULT_PREFERENCES, ...result[CONFIG.STORAGE_KEYS.USER_PREFERENCES] };
    } catch (error) {
      console.error('Error loading preferences:', error);
      return CONFIG.DEFAULT_PREFERENCES;
    }
  }

  async updatePreference(key, value) {
    const preferences = await this.getPreferences();
    preferences[key] = value;
    await this.savePreferences(preferences);
    return preferences;
  }

  // Attendance data caching
  async cacheAttendanceData(data, userId = null) {
    const cacheKey = HELPERS.formatStorageKey(CONFIG.STORAGE_KEYS.CACHED_DATA, userId);
    const cacheEntry = {
      data,
      timestamp: Date.now(),
      userId
    };

    // Store in chrome storage
    await chrome.storage.local.set({
      [cacheKey]: cacheEntry,
      [CONFIG.STORAGE_KEYS.LAST_SYNC]: Date.now()
    });

    // Also store in memory cache
    this.cache.set(cacheKey, cacheEntry);
    
    return cacheEntry;
  }

  async getCachedAttendanceData(userId = null) {
    const cacheKey = HELPERS.formatStorageKey(CONFIG.STORAGE_KEYS.CACHED_DATA, userId);
    
    // Check memory cache first
    let cached = this.cache.get(cacheKey);
    
    if (!cached) {
      // Fallback to chrome storage
      try {
        const result = await chrome.storage.local.get(cacheKey);
        cached = result[cacheKey];
        
        if (cached) {
          this.cache.set(cacheKey, cached);
        }
      } catch (error) {
        console.error('Error loading cached data:', error);
        return null;
      }
    }

    // Check if cache is expired
    if (cached && HELPERS.isExpired(cached.timestamp, CONFIG.CACHE.EXPIRY_MINUTES)) {
      await this.clearCache(userId);
      return null;
    }

    return cached?.data || null;
  }

  async clearCache(userId = null) {
    const cacheKey = HELPERS.formatStorageKey(CONFIG.STORAGE_KEYS.CACHED_DATA, userId);
    
    // Clear memory cache
    this.cache.delete(cacheKey);
    
    // Clear storage cache
    await chrome.storage.local.remove(cacheKey);
  }

  async clearAllCache() {
    this.cache.clear();
    
    // Get all storage keys and remove cache entries
    const storage = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(storage).filter(key => 
      key.includes(CONFIG.STORAGE_KEYS.CACHED_DATA)
    );
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
    }
  }

  // Attendance history management
  async saveAttendanceHistory(data, date = new Date()) {
    const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    const historyKey = `attendance_history_${dateKey}`;
    
    await chrome.storage.local.set({
      [historyKey]: {
        date: dateKey,
        data,
        timestamp: Date.now()
      }
    });
  }

  async getAttendanceHistory(startDate, endDate) {
    try {
      const storage = await chrome.storage.local.get(null);
      const historyEntries = [];
      
      for (const [key, value] of Object.entries(storage)) {
        if (key.startsWith('attendance_history_')) {
          const entryDate = new Date(value.date);
          if (entryDate >= startDate && entryDate <= endDate) {
            historyEntries.push(value);
          }
        }
      }
      
      return historyEntries.sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (error) {
      console.error('Error loading attendance history:', error);
      return [];
    }
  }

  // Export functionality
  async exportData(format, dateRange) {
    const history = await this.getAttendanceHistory(dateRange.start, dateRange.end);
    const preferences = await this.getPreferences();
    
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        format,
        dateRange,
        version: '2.0'
      },
      preferences,
      attendanceHistory: history
    };

    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(exportData, null, 2);
      
      case 'csv':
        return this.convertToCSV(history);
      
      default:
        throw new Error('Unsupported export format');
    }
  }

  convertToCSV(history) {
    if (!history || history.length === 0) {
      return 'No data available for export';
    }

    const headers = ['Date', 'Login Time', 'Logout Time', 'Total Hours', 'Break Time', 'Overtime'];
    const rows = history.map(entry => {
      const data = entry.data;
      return [
        entry.date,
        data.loginTime || 'N/A',
        data.logoutTime || 'N/A',
        data.totalHours || 'N/A',
        data.breakTime || 'N/A',
        data.overtime || 'N/A'
      ].map(cell => `"${cell}"`).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  // Storage cleanup
  async cleanupStorage() {
    try {
      const storage = await chrome.storage.local.get(null);
      const keysToRemove = [];
      const cutoffDate = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days ago

      for (const [key, value] of Object.entries(storage)) {
        // Remove old attendance history entries
        if (key.startsWith('attendance_history_') && value.timestamp < cutoffDate) {
          keysToRemove.push(key);
        }
        
        // Remove old cache entries
        if (key.includes('cached_data') && HELPERS.isExpired(value.timestamp, CONFIG.CACHE.EXPIRY_MINUTES)) {
          keysToRemove.push(key);
        }
      }

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log(`Cleaned up ${keysToRemove.length} storage entries`);
      }
    } catch (error) {
      console.error('Error during storage cleanup:', error);
    }
  }

  // Storage usage monitoring
  async getStorageUsage() {
    try {
      const usage = await chrome.storage.local.getBytesInUse();
      const quota = chrome.storage.local.QUOTA_BYTES;
      
      return {
        used: usage,
        total: quota,
        percentage: (usage / quota) * 100,
        available: quota - usage
      };
    } catch (error) {
      console.error('Error getting storage usage:', error);
      return null;
    }
  }

  // Initialize storage manager
  async initialize() {
    // Run cleanup on initialization
    await this.cleanupStorage();
    
    // Set up periodic cleanup
    chrome.alarms.create('storage_cleanup', { 
      delayInMinutes: 60, 
      periodInMinutes: 24 * 60 // Daily cleanup
    });
  }
}