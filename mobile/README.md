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

---

# Eco Sor apps (Flutter)

Two Flutter apps for the Eco Sor Business Operations Platform live next to the field-agent app in this folder. They talk to the backend's `/api/v1` routes (the same API the web dashboard uses) and share one package:

| Folder | What it is | Platforms |
| --- | --- | --- |
| `eco_core/` | Shared package: API client, sign-in and session, theme, widgets, common screens, helpers | — |
| `eco_employee/` | **Eco Sor Employee**: every staff member (attendance, expenses, leave), plus Field Sales and Field Support work | Android (`com.ecosor.employee`) |
| `eco_customer/` | **Eco Sor**: customers register products, raise service requests and track them | Android and iOS (`com.ecosor.customer`) |

The field-agent tracking app at the root of `mobile/` (`lib/`, `android/`, `ios/`, ...) is separate and unchanged. `mobile/analysis_options.yaml` excludes the three Eco Sor folders, so `flutter analyze` run in `mobile/` still checks only the field-agent app.

## Requirements

- Flutter **3.29 or newer** (Dart 3.7+): `flutter --version`
- Android Studio with the Android SDK (the apps need Android 7.0 / API 24 or newer) and JDK 17+ (Android Studio's bundled JDK works)
- For the customer app on iOS: a Mac with Xcode 15+ and CocoaPods; iOS 15.5 or newer

## First-time setup

```bash
cd mobile/eco_core     && flutter pub get
cd ../eco_employee     && flutter pub get
cd ../eco_customer     && flutter pub get
```

## Settings (`--dart-define`)

| Name | Needed | Example | Used for |
| --- | --- | --- | --- |
| `API_URL` | Yes, except on the Android emulator | `https://api.example.com/api` | Backend base URL ending in `/api`. Default: `http://10.0.2.2:5100/api` (a backend on this computer, seen from the Android emulator) |
| `SUPPORT_PHONE` | Customer app | `919876543210` | "Call support" (digits with country code) |
| `SUPPORT_WHATSAPP` | Customer app, optional | `919876543210` | "WhatsApp chat"; falls back to `SUPPORT_PHONE` |
| `COMPANY_ID` | Customer app, only when the platform hosts several companies | the company's id | Which company a self-registering customer belongs to |

Debug builds accept `http://` (the Android emulator's `10.0.2.2`, the iOS simulator's `localhost`). Release builds need an `https://` API URL.

## Run

```bash
cd mobile/eco_employee
flutter run --dart-define=API_URL=https://api.example.com/api

cd mobile/eco_customer
flutter run --dart-define=API_URL=https://api.example.com/api --dart-define=SUPPORT_PHONE=919876543210
```

On a real phone, `API_URL` must be an address the phone can reach (your computer's LAN IP, or the deployed backend).

## Build

Android (either app):

```bash
flutter build apk --release --dart-define=API_URL=https://api.example.com/api
# -> build/app/outputs/flutter-apk/app-release.apk

flutter build appbundle --dart-define=API_URL=https://api.example.com/api
# -> build/app/outputs/bundle/release/app-release.aab (for Google Play)
```

Release signing: copy `android/key.properties.example` to `android/key.properties` and follow the steps in it. Without that file a release build is signed with the debug key (fine for testing, refused by Google Play). `key.properties` and keystores are git-ignored: never commit them.

iOS (customer app, on a Mac):

```bash
cd mobile/eco_customer
flutter build ios --config-only --dart-define=API_URL=https://api.example.com/api
cd ios && pod install && cd ..
open ios/Runner.xcworkspace      # set your Team under Signing & Capabilities
flutter build ipa --dart-define=API_URL=https://api.example.com/api
```

## App icon and splash screen

The Eco Sor icon and splash are already in the platform folders (artwork in `assets/branding/`). After changing the artwork, regenerate them in that app's folder:

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

## Push notifications (Firebase, optional)

The apps start Firebase Cloud Messaging only when its config files are present. Without them the apps work normally: in-app notifications and WhatsApp messages still arrive, there are just no push notifications.

1. In the Firebase console, create a project and add the apps: Android `com.ecosor.employee`, Android `com.ecosor.customer`, iOS `com.ecosor.customer`.
2. Android: put each app's `google-services.json` in `<app>/android/app/`. Add the Google services Gradle plugin (`com.google.gms.google-services`, at the version the Firebase console shows): with `apply false` in `android/settings.gradle.kts` under `plugins { }`, and applied in `android/app/build.gradle.kts` under `plugins { }`.
3. iOS: add `GoogleService-Info.plist` to `ios/Runner/` through Xcode (so it is part of the Runner target), turn on the **Push Notifications** capability, and upload an APNs key in the Firebase project settings. Background "remote notifications" is already set in `Info.plist`.
4. Run the app: the device token is printed in the debug console as `FCM token: ...`.

The config files are git-ignored. The backend does not send FCM pushes yet: the apps register for push, and sending is a later backend step.

## Permissions

Each permission is explained in a dialog before the system asks for it.

| Permission | App | When |
| --- | --- | --- |
| Location (while using the app) | Employee | One GPS fix at attendance check-in and check-out, at a field-visit check-in and at a service check-in. No background tracking. |
| Camera | Both | Before taking a photo (receipt, payment proof, visit or service photo, warranty card) and before scanning a serial number |
| Microphone | Employee | When the mic is tapped for Hindi / English voice-to-text notes. The phone's speech recognition turns speech into text; Eco Sor saves only the text. |
| Notifications | Both | At first start, once Firebase is set up |

## Sign-in, session and offline behaviour

- Sign in with the 10-digit mobile number and password. Each app accepts only its own roles: staff use the Employee app, customers the Eco Sor app; distributors and admins use the web dashboard and portal.
- The token is kept in the phone's secure storage (Android Keystore / iOS Keychain). The app signs out by itself when the token expires (`ECO_JWT_EXPIRES_IN` on the backend, 8 hours by default) or when the server rejects it (401).
- Lists show a "No internet connection" state with **Try again**, and refresh with pull-to-refresh.
- When a submit fails because the phone is offline, the form keeps what was entered. Pressing the button again sends the same `Idempotency-Key`, so new purchase requests, complaints, expense claims and call logs are never created twice. Photos already uploaded are not uploaded again. Repeated steps such as a check-in, a visit or service report, or a resubmission are recognised and not reported as errors.

## Checks

```bash
cd mobile/eco_core     && flutter analyze && flutter test
cd ../eco_employee     && flutter analyze
cd ../eco_customer     && flutter analyze
```

## Screens

**Eco Sor Employee** (Android)

| Who | Bottom bar | Screens |
| --- | --- | --- |
| Every role | — | Splash · Sign in · Forgot password (WhatsApp code) · Home · Attendance (GPS check-in / check-out, work hours, history) · Expenses and New expense claim (receipt photo) · Leave and Apply for leave · Notifications · Profile (change password, logout) |
| Field Sales, Tele-Sales | Home · Visits · Orders · Profile | My distributors (call, log call with outcome and next follow-up, order) · Field visits (Today / Upcoming / Done) · Visit detail (GPS check-in on the visit day; report with Hindi / English voice-to-text, photos, product requirements, next follow-up) · Follow-ups · My orders · New purchase request (distributor → products and quantity → payment amount, method, date, UTR and proof photo → submit) · Request submitted · Request detail (order timeline, items, payment) · Correct and resubmit |
| Field Support | Home · Tickets · Attendance · Profile | My tickets (All / New / In Progress / Today) · Ticket detail (customer, product, warranty, address with Google Maps, call / WhatsApp; GPS check-in; service update with diagnosis, action taken, voice notes, photos, outcome and further action; request customer OTP → enter OTP → complete) · Completed jobs |
| Sales Manager, Support Manager, HR | Home · Attendance · Alerts · Profile | The common screens; their management work is on the web dashboard |

**Eco Sor** (customer app, Android and iOS)

Splash · Sign in · Create account (details → WhatsApp code → signed in) · Forgot password · Home (alerts bell, six tiles, recent request) · My products (All / Under warranty / Review pending / Not covered) · Register product (inverter or battery, model, serial number typed or scanned from the barcode / QR code, purchase date, dealer, warranty proof photo) · Scan serial number · Raise service request (product, issue type, description, photos, service address, contact; installation requests are not taken here) · Request submitted (complaint number) · My requests (All / Open / In Progress / Closed) · Request detail (timeline, engineer with call button, OTP step when the service is done, reopen) · Notifications · Support (call / WhatsApp) · Profile (change password, logout)

Not in these apps, as agreed in the SRS: quotations / GST, installation, spare-part requests, AMC and continuous location tracking.
