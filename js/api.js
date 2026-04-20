// API management for AT2 Extension
import { CONFIG, VALIDATORS } from './config.js';
import { ValidationUtils, ErrorHandler, TimeUtils } from './utils.js';
import { StorageManager } from './storage.js';

export class APIManager {
  constructor() {
    this.storage = new StorageManager();
    this.requestQueue = new Map();
    this.rateLimiter = new Map();
  }

  // Rate limiting
  isRateLimited(endpoint) {
    const key = `rate_limit_${endpoint}`;
    const lastRequest = this.rateLimiter.get(key);
    const now = Date.now();
    
    if (lastRequest && (now - lastRequest) < 1000) { // 1 request per second
      return true;
    }
    
    this.rateLimiter.set(key, now);
    return false;
  }

  // Request deduplication
  getRequestKey(url, options) {
    return `${url}_${JSON.stringify(options)}`;
  }

  // Secure token retrieval with validation
  async getValidToken() {
    const token = await this.storage.getToken();
    
    if (!token) {
      throw new Error('No authentication token found. Please login to Keka first.');
    }
    
    const validation = ValidationUtils.validateToken(token);
    if (!validation.valid) {
      await this.storage.removeToken(); // Remove invalid token
      throw new Error(`Invalid token: ${validation.error}`);
    }
    
    return token;
  }

  // Enhanced fetch with retry logic and error handling
  async secureFetch(url, options = {}, retryCount = 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.API.TIMEOUT);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      clearTimeout(timeoutId);
      
      // Handle HTTP errors
      if (!response.ok) {
        if (response.status === 401) {
          await this.storage.removeToken(); // Remove expired token
          throw new Error('Authentication expired. Please login again.');
        } else if (response.status === 403) {
          throw new Error('Access denied. Insufficient permissions.');
        } else if (response.status === 429) {
          throw new Error('Too many requests. Please wait a moment.');
        } else if (response.status >= 500) {
          throw new Error('Server error. Please try again later.');
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection.');
      }
      
      // Retry logic for network errors
      if (retryCount < CONFIG.API.RETRY_ATTEMPTS && 
          (error.name === 'NetworkError' || error.message.includes('fetch'))) {
        
        await new Promise(resolve => 
          setTimeout(resolve, CONFIG.API.RETRY_DELAY * Math.pow(2, retryCount))
        );
        
        return this.secureFetch(url, options, retryCount + 1);
      }
      
      throw error;
    }
  }

  // Fetch attendance data with caching
  async fetchAttendanceData(useCache = true) {
    try {
      // Check rate limiting
      if (this.isRateLimited('attendance')) {
        throw new Error('Please wait before making another request');
      }

      // Check for cached data first
      if (useCache) {
        const cached = await this.storage.getCachedAttendanceData();
        if (cached) {
          return cached;
        }
      }

      // Deduplicate concurrent requests
      const requestKey = this.getRequestKey('attendance_summary', {});
      if (this.requestQueue.has(requestKey)) {
        return await this.requestQueue.get(requestKey);
      }

      const requestPromise = this._fetchAttendanceDataFromAPI();
      this.requestQueue.set(requestKey, requestPromise);

      try {
        const data = await requestPromise;
        this.requestQueue.delete(requestKey);
        
        // Cache the successful response
        await this.storage.cacheAttendanceData(data);
        
        return data;
      } catch (error) {
        this.requestQueue.delete(requestKey);
        throw error;
      }
    } catch (error) {
      const errorData = await ErrorHandler.logError(error, 'fetchAttendanceData');
      throw new Error(errorData.userMessage);
    }
  }

  async _fetchAttendanceDataFromAPI() {
    const token = await this.getValidToken();
    const url = `${CONFIG.API.BASE_URL}${CONFIG.API.ENDPOINTS.ATTENDANCE_SUMMARY}`;
    
    const response = await this.secureFetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const json = await response.json();
    
    // Validate response structure
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error('Invalid response format from server');
    }
    
    return this.processAttendanceData(json.data);
  }

  processAttendanceData(data) {
    const latest = data.at(-1);
    if (!latest) {
      throw new Error('No attendance data found');
    }

    const loginTime = latest.firstLogOfTheDay?.split('T')[1];
    if (!loginTime) {
      throw new Error('Login time not found in attendance data');
    }

    // Parse and validate login time
    const parsedLoginTime = TimeUtils.parseTimeString(loginTime);
    if (!parsedLoginTime) {
      throw new Error('Invalid login time format');
    }

    // Calculate additional metrics
    const currentTime = TimeUtils.getCurrentTime();
    const workedDuration = TimeUtils.calculateTimeDifference(parsedLoginTime, currentTime);
    
    return {
      loginTime: loginTime,
      parsedLoginTime: parsedLoginTime,
      currentTime: currentTime,
      workedDuration: workedDuration,
      lastLogout: latest.lastLogOfTheDay ? latest.lastLogOfTheDay.split('T')[1] : null,
      totalBreakTime: latest.totalBreakTime || 0,
      status: latest.status || 'unknown',
      date: latest.date || new Date().toISOString().split('T')[0],
      raw: latest
    };
  }

  // Fetch employee profile data
  async fetchEmployeeProfile() {
    try {
      const token = await this.getValidToken();
      const url = `${CONFIG.API.BASE_URL}${CONFIG.API.ENDPOINTS.EMPLOYEE_PROFILE}`;
      
      const response = await this.secureFetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const profile = await response.json();
      
      // Cache profile data
      await chrome.storage.local.set({
        employee_profile: {
          data: profile,
          timestamp: Date.now()
        }
      });
      
      return profile;
    } catch (error) {
      const errorData = await ErrorHandler.logError(error, 'fetchEmployeeProfile');
      throw new Error(errorData.userMessage);
    }
  }

  // Get cached profile or fetch new one
  async getEmployeeProfile() {
    try {
      const cached = await chrome.storage.local.get('employee_profile');
      const profile = cached.employee_profile;
      
      // Return cached if not expired (24 hours)
      if (profile && !this.isExpired(profile.timestamp, 24 * 60)) {
        return profile.data;
      }
      
      // Fetch fresh data
      return await this.fetchEmployeeProfile();
    } catch (error) {
      console.error('Error getting employee profile:', error);
      return null;
    }
  }

  // Validate API connectivity
  async validateConnection() {
    try {
      const token = await this.getValidToken();
      const url = `${CONFIG.API.BASE_URL}/k/api/health`; // Assuming a health check endpoint
      
      const response = await this.secureFetch(url, {
        method: 'HEAD',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      return {
        connected: true,
        status: response.status,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  // Batch API requests
  async batchRequest(requests) {
    const results = [];
    const batchSize = 3; // Limit concurrent requests
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(request => this.secureFetch(request.url, request.options))
      );
      
      results.push(...batchResults);
    }
    
    return results;
  }

  // Helper method for expiry checking
  isExpired(timestamp, expiryMinutes) {
    const now = Date.now();
    const expiry = timestamp + (expiryMinutes * 60 * 1000);
    return now > expiry;
  }

  // Clear all cached API data
  async clearAPICache() {
    await Promise.all([
      this.storage.clearAllCache(),
      chrome.storage.local.remove(['employee_profile'])
    ]);
    
    // Clear request queue
    this.requestQueue.clear();
    this.rateLimiter.clear();
  }

  // Get API status and metrics
  getAPIStatus() {
    return {
      queuedRequests: this.requestQueue.size,
      rateLimitedEndpoints: Array.from(this.rateLimiter.keys()),
      lastRequestTimes: Object.fromEntries(this.rateLimiter),
      cacheStatus: {
        memoryEntries: this.storage.cache.size
      }
    };
  }
}