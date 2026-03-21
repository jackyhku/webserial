# WebSerial Monitor
> **Version 1.1.0** | **Designed by Jacky CHOW** | **Jan 2026**

A modern, chatbot-style web application for communicating with ESP32 devices via USB serial connection (Web Serial API) and Bluetooth LE (Web Bluetooth API).

![WebSerial Monitor](https://img.shields.io/badge/Browser-Chrome%20%7C%20Edge-blue)
![Web Serial API](https://img.shields.io/badge/Web%20Serial%20API-Supported-green)
![Web Bluetooth API](https://img.shields.io/badge/Web%20Bluetooth%20API-Supported-lightblue)

## Features

### 🔌 Advanced Connection Modes
- **Basic Mode (Default)**: Simple, clutter-free USB Serial interface.
- **Advanced Mode**: Unlock optional features via Settings:
    - **Bluetooth (BLE 4.0)**: Connect wirelessly to ESP32 BLE devices directly from the browser (no pairing needed, supports Nordic UART Service).
    - **Remote Broadcast**: Stream your local connection to a remote observer via Session ID.
    - **Remote Monitor**: Connect to a remote session to view data and send commands.

### 🎨 Modern UI/UX
- **Chatbot-inspired interface** with message bubbles.
- **Dark/Light theme** support with smooth transitions.
- **Clean Sidebar**: Focused on connection and port selection.
- **Settings Modal**: Consolidated configuration, "Advanced Mode" toggle, and profile management.
- **Custom Branding**: Stylized "Plug" icon with custom theming.

### 🛡️ Robust Serial Engine
- **Self-Healing Connection**: Automatically recovers from transient errors (like `BreakError`) without disconnecting.
- **Smart Sanitization**: Automatically filters out garbage characters caused by incorrect baud rates while preserving valid Unicode text (emojis, multiple languages).
- **Clean Console**: Suppresses unnecessary error logs for a smoother debugging experience.

### 🔧 Intelligent Control
- **Auto-Save Config**: Remembers your preferred Baud Rate, Data Bits, and other settings automatically.
- **Detailed Stats**: Real-time tracking of RX/TX bytes and Uptime.
- **Line Endings**: Fast selector (None, LF, CR, CRLF) right in the input area.
- **Profiles**: Manually save/load specific configurations for different devices.

### ⚡ Customizable Shortcuts
- **Quick command buttons** at the top of the interface.
- **Fully customizable** - add, edit, delete, and reorder.
- **Per-Shortcut Line Endings** - Configure specific line endings (None, LF, CR, CRLF) for each shortcut (independent of global setting).
- **Import/Export** button configurations as JSON.

### 💬 Chat-Style Communication
- ESP32 messages displayed on the left (incoming).
- Your commands displayed on the right (outgoing).
- **Hex/Text/Mixed** display modes.
- Command history with arrow key navigation.

## Browser Requirements

This application requires modern browser APIs:

- **Web Serial API**: Chrome/Edge 89+
- **Web Bluetooth API**: Chrome/Edge 56+

⚠️ **Not supported in Firefox or Safari** due to missing hardware APIs.

## Getting Started

### 1. Setup the Web Application

1. Clone this repository
2. Install Node.js dependencies:
   ```bash
   npm install
   ```
3. Run the backend server:
   
   **Option A: Quick Start (Recommended)**
   ```bash
   ./start.sh
   ```
   
   **Option B: Manual Start**
   ```bash
   node server.js
   ```
   *The server runs on port 6011 by default.*
   
4. Open the application:
   - **Localhost**: `http://localhost:6011`
   - **Production**: `https://your-domain.com` (supported automatically)

### 2. Upload Test Program to ESP32

1. Open `ESP32_Test_Program.ino` in Arduino IDE
2. Select your ESP32 board and port
3. Upload the program to your ESP32

### 3. Connect and Test

1. **Select Connection Mode** in the sidebar:
   - **Serial**: For USB.
   - **Bluetooth**: For BLE devices (Enable "Advanced Mode" in Settings to see this).
2. Click **"Select Port"** or **"Scan Device"**.
3. Choose your device and click **"Connect"**.

## Remote Monitoring Guide (Advanced Mode)

1. **Broadcaster (Device Owner)**:
   - Enable **Advanced Mode** in Settings (Gear Icon).
   - Connect to your device via Serial or Bluetooth.
   - Click **"Remote Broadcast"** in the header (Wifi Icon).
   - A **Session ID** (e.g., `A1B2C3`) will appear. Share this with your peer.

2. **Monitor (Remote Observer)**:
   - Enable **Advanced Mode** in Settings.
   - Select **"Remote"** mode in the sidebar.
   - Enter the **Session ID** provided by the broadcaster.
   - Click **"Connect"**.
   - You can now see the data stream and send commands back to the device!

## Project Structure

```
WebSerial/
├── index.html              # Main HTML page
├── css/
│   └── style.css          # Styling
├── js/
│   ├── app.js             # Main controller
│   ├── serial.js          # Web Serial manager
│   ├── bluetooth.js       # Web Bluetooth manager
│   ├── remote.js          # Remote monitoring manager
│   ├── ui.js              # UI logic
│   └── shortcuts.js       # Shortcuts logic
├── server.js              # Node.js Express + Socket.IO server
├── package.json           # Node.js dependencies
├── config.js              # Configuration defaults
└── README.md              # Documentation
```

## Troubleshooting

### Port Selection Dialog Doesn't Appear
- Make sure you're using Chrome or Edge (v89+)
- The app must be served over HTTPS (or localhost)

### Connection Fails
- Verify correct baud rate (default: 115200)
- Ensure ESP32 is not connected to Arduino IDE monitor

## License

This project is licensed under the **MIT License**.

> **Copyright (c) 2026 Jacky CHOW**
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> **The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.**

---

**Happy Coding! 🚀**

## Acknowledgements

- **[Socket.IO](https://socket.io/)**: For real-time bidirectional event-based communication.
- **[Express](https://expressjs.com/)**: Fast, unopinionated, minimalist web framework for Node.js.
- **[Web Serial API](https://developer.chrome.com/docs/capabilities/serial)**: For enabling direct serial communication from the browser.
- **[Web Bluetooth API](https://developer.chrome.com/docs/capabilities/bluetooth)**: For enabling Bluetooth Low Energy communication from the browser.
