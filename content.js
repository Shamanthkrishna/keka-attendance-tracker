// AT2 Content Script — runs in Keka tab, saves token to extension storage
// This lets the popup work even when Keka tab is closed

(function () {
  const KEYS = ['access_token', 'authToken', 'token', 'keka_token'];

  function extractToken() {
    for (const key of KEYS) {
      const t = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (t) return t;
    }
    return null;
  }

  function saveToken() {
    const token = extractToken();
    if (token) {
      chrome.storage.local.set({
        at2_token: token,
        at2_token_ts: Date.now(),
        at2_keka_origin: location.origin
      });
    }
  }

  // Save immediately on load
  saveToken();

  // Re-save on storage events (token refresh)
  window.addEventListener('storage', saveToken);

  // Re-save periodically to catch in-memory token updates (e.g. silent refresh)
  setInterval(saveToken, 60 * 1000);
})();
