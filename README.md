# ⚡ DeviceBridge

> A sleek, high-performance Windows desktop application and companion mobile experience allowing seamless, zero-friction local network transfer of **text, files, photos, videos, links, and pasted clipboard content** between Windows PCs and any smartphone (iOS / Android).

---

## ✨ Features

- 📸 **Camera Snap & Video Recording**: Phone companion integrates directly with mobile cameras (`capture="environment"`). Take a photo or shoot a video on your phone, and it instantly streams and pops up on your Windows desktop.
- 🖼️ **Photo & Video Gallery Transfer**: Select high-resolution photos and 4K videos with multi-select support and progress reporting.
- 📁 **Universal File Drag & Drop**: Drop any document, ZIP archive, or file directly into the Windows app or mobile file picker for instant transmission.
- 📋 **Seamless Clipboard Sync & Pasted Content**:
  - One-click "Paste & Send" button on both Windows and mobile companion.
  - Optional **Live Clipboard Mirroring** to automatically broadcast copied text across connected devices.
- 🔗 **Smart Link Detection & Web Previews**: URLs are automatically parsed and formatted into clickable cards with quick "Open in Browser" and "Copy Link" buttons.
- 💬 **Notes & Code Snippets**: Transfer multi-line text notes, code snippets, or passwords with one-tap copy and syntax preservation.
- 🔍 **Interactive Media Previews**:
  - Full-resolution photo lightbox with zoom and direct download.
  - Built-in HTML5 video player with seekable range-request streaming (HTTP 206).
  - Windows File Explorer integration ("Reveal in Explorer" & "Open Storage Folder").
- 📲 **Zero-Install Phone Companion**:
  - No need to sideload APKs or wait for App Store approvals.
  - Windows app automatically detects local Wi-Fi/LAN IP addresses and renders a high-contrast QR code.
  - Point your iPhone or Android camera at the screen to immediately connect via the mobile PWA companion.

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐               ┌─────────────────────────────────┐
│       Windows Desktop App       │               │      Phone Companion (PWA)      │
│     (Electron / Modern Web)     │               │        (iOS / Android)          │
│                                 │               │                                 │
│  - Acrylic Dark Fluent UI       │               │  - Mobile Touch Action Grid     │
│  - Drag & Drop File Zone        │               │  - Camera Photo / Video Trigger │
│  - Live Clipboard Mirroring     │               │  - Gallery / Files Multi-Picker │
│  - Audio Ping & System Notifs   │               │  - 1-Tap Copy & Download        │
│  - Explorer Reveal Integration  │               │  - Haptic Feedback              │
└────────────────┬────────────────┘               └────────────────┬────────────────┘
                 │                                                 │
                 │                 WebSocket & REST                │
                 └───────────────────────┬─────────────────────────┘
                                         ▼
                 ┌─────────────────────────────────────────────────┐
                 │          DeviceBridge Local Core Server         │
                 │              (Express + ws + multer)            │
                 │                                                 │
                 │  - Local IP Discovery & Auto-Configuration      │
                 │  - Pairing QR Code Data-URI Generation          │
                 │  - Real-time Bidirectional WebSocket Hub        │
                 │  - Range-Request Streaming (HTTP 206)           │
                 │  - Disk Storage in ./received_files             │
                 └─────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** (v18 or higher recommended)
- Both your Windows PC and your phone connected to the **same local Wi-Fi / LAN network**.

### 2. 1-Click Launch Options
You can start DeviceBridge with a single click using any of the following:

- **Desktop Shortcut**: Double-click the **`DeviceBridge`** shortcut on your Windows Desktop (created via `create-desktop-shortcut.ps1`).
- **Silent Launcher**: Double-click [`launch-silent.vbs`](file:///d:/AI/projects/Dev/Devicebridge/launch-silent.vbs) to run DeviceBridge in the background without keeping a terminal window open.
- **Batch Launcher**: Double-click [`launch.bat`](file:///d:/AI/projects/Dev/Devicebridge/launch.bat) (checks for Node.js, auto-installs dependencies if needed, and launches the app).
- **Command Line**:
```powershell
npm start
```

### 3. Start Server Only (Browser / Headless Mode)
To run just the local bridge server and access the Windows interface via any browser:
```powershell
npm run start:server
```
Visit `http://localhost:53317` on your PC.

### 4. Connect Your Phone
1. The Windows app displays a **QR code** and a pairing link (e.g., `http://192.168.1.X:53317/companion.html`).
2. Scan the QR code using your phone's default camera app or enter the URL into Safari / Chrome.
3. Your phone companion connects instantly — transfer photos, videos, files, text, links, and pasted content back and forth with zero lag!

---

## 🧪 Testing

DeviceBridge includes an automated test suite covering utility helpers, QR code generation, REST APIs, multipart file and media uploads, HTTP 206 video range streaming, metadata persistence across restarts, disk cleanup, and real-time WebSocket clipboard and feed synchronization:

```powershell
npm test
```

All 20 automated test cases run with Node.js's native test runner (`node:test`).

---

## 📦 Windows x64 Installer & Executable Packaging

To package the production Windows x64 binaries:

```powershell
# Build NSIS Setup Installer and Standalone Portable .exe
npm run dist
```

Generated release artifacts in `dist/`:
- **`DeviceBridge-Setup-1.0.1-x64.exe`**: Full Windows NSIS installer with desktop & start menu shortcuts, custom DeviceBridge branding, and clean uninstaller.
- **`DeviceBridge-1.0.1-portable-x64.exe`**: Single-file standalone executable with zero installation required and embedded icon assets.
