# Movement Tracking — Mobile App & Admin Panel

A cross-platform React Native & Expo application connecting to the deployed Movement Tracking API (`https://moment-tracking.onrender.com`).

---

## 🚀 Quick Start

From the `mobile/` directory:

```bash
cd mobile

# 1. Install dependencies (already pre-installed and verified)
npm install

# 2. Start the Expo development server
npm start
```

Press:
- **`a`** to run on an Android emulator or connected device
- **`w`** to open in web browser
- **`i`** to run on iOS simulator (macOS required)
- Scan the displayed QR code with the **Expo Go** app on your physical Android or iPhone.

---

## 📱 Sign In & Roles

The app supports role-based routing based on the logged-in credentials:

### 1. Super Administrator
- **Sign In Tab:** Select **Super Admin** on the login screen.
- **Email & Password:** Pre-configured in `backend/.env` (`admin@movement-tracking.local`).
- **Features:**
  - **Dashboard:** Fleet overview, active staff in the field, total captured leads, review pipeline.
  - **Live Radar Map:** Full-screen real-time tracking map showing all field staff with interactive popups and status indicators.
  - **Staff Management:** Create new field agents and supervisors, assign districts, reset passwords, suspend or activate accounts.
  - **Route & Shift Playback:** Inspect historical routes on an interactive map with check-in/out locations, duration, stops, and distance in km.
  - **Leads Review:** Review captured property leads, view photos, approve, reject, or convert leads.
  - **Operational Regions:** Manage active states and districts.

### 2. Field Supervisor
- **Sign In Tab:** Select **Field Staff** on the login screen.
- **Credentials:** Registered 10-digit phone number and password.
- **Features:**
  - **District Dashboard:** Performance metrics and agent activity for assigned district.
  - **District Radar:** Live map tracking agents within the supervisor's district.
  - **Team Oversight:** View assigned agents, their attendance, and shift histories.

### 3. Field Agent
- **Sign In Tab:** Select **Field Staff** on the login screen.
- **Credentials:** Registered 10-digit phone number and password.
- **Features:**
  - **Shift Console:** One-tap **Check In** and **Check Out** with high-accuracy GPS capture.
  - **Automatic Route Tracking:** GPS fixes are recorded every 30 seconds during active shift hours.
  - **Offline Sync Queue:** Fixes recorded while offline are stored locally in SQLite/AsyncStorage and automatically uploaded when network resumes.
  - **Today's Route:** View today's route path, distance covered, and visited stops directly on an interactive map.
  - **Lead Capture:** Record properties, room inventory, owner contacts, interest level, and attach photos using camera or gallery (uploaded directly to Cloudinary).
  - **Profile & Privacy:** View privacy policies and control tracking consent.

---

## 🛠️ Architecture & Highlights

- **Zero Map API Keys Required:** Uses Leaflet + OpenStreetMap tiles rendered via `react-native-webview`. Fully interactive with zoom, pan, and vector markers.
- **Background Location Service:** Built using `expo-location` and `expo-task-manager` with foreground service notifications on Android and significant motion on iOS.
- **Offline Resilient Queue:** Persistent fix queue (`src/tracking/queue.ts`) buffers locations if cellular connection drops and uploads in batches of up to 100 once connectivity restores.
- **Cloudinary Photo Uploads:** Integrated multipart upload directly into Cloudinary CDN via the backend upload endpoint.
- **Type-Safe API Client:** 100% TypeScript with strict null checks matching all NestJS backend DTOs.

---

## 🧪 Testing

Run the end-to-end API smoke test against the live backend:

```bash
# In mobile directory:
$env:ADMIN_EMAIL="admin@movement-tracking.local"
$env:ADMIN_PASSWORD="<password from backend/.env>"
npm run test:api
```

This executes 54 automated checks verifying authentication, GPS fixes upload, filtering of inaccurate fixes, lead creation, Cloudinary photo uploads, live radar, and shift playback.
