# Keka Attendance Tracker

A Chrome extension that lets you view and export your attendance data directly from the [Keka HRM](https://www.keka.com/) portal — no manual log-digging required.

---

## Features

- **Attendance Summary** — instantly see your present, absent, and leave counts for any date range
- **Date Range Filtering** — pick custom start/end dates or use quick presets (This Month, Last Month, etc.)
- **CSV Export** — download your attendance records as a spreadsheet with one click
- **Dark / Light Theme** — toggle between themes; preference is saved across sessions

---

## ⚙️ Configuration (Required Before Use)

Before loading the extension, open `js/config.js` and set `BASE_URL` to your company's Keka subdomain:

```js
// js/config.js
const BASE_URL = 'https://your-subdomain.keka.com';
```

Replace `your-subdomain` with the subdomain your company uses to access Keka  
(e.g., if you sign in at `acme.keka.com`, set `BASE_URL = 'https://acme.keka.com'`).

---

## Installation

> This extension is not published on the Chrome Web Store. Load it manually:

1. Clone or download this repository
2. Edit `js/config.js` as described above
3. Open Chrome and navigate to `chrome://extensions`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked** and select the `AT2` folder
6. The extension icon will appear in your toolbar — pin it for easy access

---

## Usage

1. Make sure you are **signed in to your Keka portal** in the same browser
2. Click the extension icon to open the popup
3. Select a date range and click **Refresh** to load your attendance data
4. Click **Export CSV** to download the records as a `.csv` file
5. Use the **Theme** button to toggle dark/light mode

---

## File Structure

```
AT2/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup_simple.html      # Popup UI
├── popup_simple.js        # Popup logic
├── background_simple.js   # Service worker (session/auth handling)
├── js/
│   ├── config.js          # ← Edit this: set your Keka subdomain
│   └── utils.js           # Shared utility functions
└── icons/                 # Extension icons
```

---

## Requirements

- Google Chrome (or any Chromium-based browser supporting Manifest V3)
- An active Keka HRM account at your company's Keka subdomain

---

## Privacy

This extension communicates **only** with the Keka domain configured in `js/config.js`. No data is sent to any third-party server. Attendance records are processed locally in your browser.

---

## License

MIT
