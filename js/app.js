// Remote Manager - Handles remote session monitoring
class RemoteManager {
    constructor(app) {
        this.app = app;
        this.isConnected = false;
        this.startTime = null;
        this.bytesReceived = 0;
        this.bytesSent = 0;
    }

    async connect(targetId) {
        if (!this.app.socket || !this.app.socket.connected) {
            throw new Error('Not connected to server');
        }

        console.log('Subscribing to session:', targetId);
        this.targetId = targetId;
        this.app.socket.emit('subscribe', targetId);

        this.isConnected = true;
        this.startTime = Date.now();
        this.bytesReceived = 0;

        // Notify App of connection change
        this.app.handleConnectionChange(true);
        this.app.uiManager.appendSystemMessage(`Subscribed to session ${targetId}`, true);
    }

    async disconnect() {
        this.isConnected = false;
        this.app.handleConnectionChange(false);
    }

    async write(data, addLineEnding = '') {
        if (!this.isConnected) {
            throw new Error('Not connected to remote session');
        }

        if (!this.targetId) {
            throw new Error('Target session ID not found');
        }

        const dataToSend = data + addLineEnding;

        // Emit to server to forward to device
        this.app.socket.emit('remote_data', {
            target: this.targetId,
            data: dataToSend
        });

        this.bytesSent += dataToSend.length;
    }

    getStats() {
        return {
            bytesReceived: this.bytesReceived,
            bytesSent: this.bytesSent,
            uptime: this.startTime ? Date.now() - this.startTime : 0
        };
    }
}

// Main Application Controller
class App {
    constructor() {
        this.serialManager = null;
        this.uiManager = null;
        this.shortcutsManager = null;
        this.statsInterval = null;
        this.isAutoReconnecting = false;
        this.socket = null;

        this.mySessionId = null;
        this.broadcastEnabled = false;
        this.broadcastBuffer = '';

        this.init();
    }

    // Initialize application
    async init() {
        // Check browser support
        if (!('serial' in navigator)) {
            this.showBrowserError();
            return;
        }

        // Initialize managers
        this.serialManager = new SerialManager();
        this.bluetoothManager = new BluetoothManager();
        this.remoteManager = new RemoteManager(this);
        this.activeMode = 'serial'; // 'serial', 'bluetooth', or 'remote'

        this.activeManager = this.serialManager;

        this.uiManager = new UIManager();
        this.shortcutsManager = new ShortcutsManager();

        // Initialize Socket.IO - Connect only if needed (Remote mode or Broadcast)
        // this.initSocket(); // Lazy load now

        // Make UI manager globally accessible for notifications
        window.uiManager = this.uiManager;

        // Setup event handlers
        this.setupSerialHandlers();
        this.setupBluetoothHandlers();
        this.setupUIHandlers();
        this.setupShortcutHandlers();

        // Load command history
        this.uiManager.loadCommandHistory();

        // Load saved serial config and update UI
        const savedConfig = this.loadSerialConfig();
        if (savedConfig) {
            this.uiManager.setSerialConfig(savedConfig);
        }

        // Initialize profile list
        this.uiManager.initializeProfileList();

        // Show welcome message
        this.uiManager.appendSystemMessage('Welcome to ESP32 WebSerial Monitor', true);

        // Try to auto-reconnect to previous port
        await this.tryAutoReconnect();

        // Default to Serial mode UI
        this.uiManager.updateModeUI(this.activeMode);

        // Show app version (sidebar + About modal) and wire update check
        this.updateVersionDisplay();
        const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
        if (checkUpdatesBtn) {
            checkUpdatesBtn.addEventListener('click', () => this.checkForUpdates());
        }

        console.log('ESP32 WebSerial Monitor initialized');
    }

    // Show app version in the sidebar footer and About modal
    updateVersionDisplay() {
        const version = (typeof CONFIG !== 'undefined' && CONFIG.app && CONFIG.app.version) || 'unknown';
        const sidebar = document.getElementById('sidebarVersion');
        if (sidebar) sidebar.textContent = `v${version}`;
        const about = document.getElementById('aboutVersion');
        if (about) about.textContent = `v${version}`;
    }

    // Compare two dotted version strings (returns -1, 0, or 1)
    compareVersions(a, b) {
        const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
        const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff !== 0) return diff > 0 ? 1 : -1;
        }
        return 0;
    }

    // Check GitHub for a newer release (releases first, then tags)
    async checkForUpdates() {
        const statusEl = document.getElementById('updateStatus');
        if (!statusEl) return;
        const current = (typeof CONFIG !== 'undefined' && CONFIG.app && CONFIG.app.version) || '0.0.0';
        statusEl.textContent = 'Checking GitHub…';

        const stripV = (s) => String(s || '').replace(/^v/i, '');
        let latest = null;

        try {
            let res = await fetch('https://api.github.com/repos/jackyhku/webserial/releases/latest', {
                headers: { 'Accept': 'application/vnd.github+json' }
            });
            if (res.ok) {
                const data = await res.json();
                latest = stripV(data.tag_name || data.name);
            } else if (res.status === 404) {
                // No GitHub Releases yet — fall back to the latest git tag
                res = await fetch('https://api.github.com/repos/jackyhku/webserial/tags', {
                    headers: { 'Accept': 'application/vnd.github+json' }
                });
                if (res.ok) {
                    const tags = await res.json();
                    latest = tags.length > 0 ? stripV(tags[0].name) : null;
                }
            } else {
                throw new Error(`GitHub API error ${res.status}`);
            }
        } catch (error) {
            statusEl.innerHTML = `⚠️ Could not check for updates (offline or GitHub unavailable). Current: <strong>v${current}</strong> — <a href="https://github.com/jackyhku/webserial" target="_blank" rel="noopener" style="color: var(--primary-color);">check on GitHub</a>`;
            return;
        }

        if (!latest) {
            statusEl.innerHTML = `ℹ️ No releases found on GitHub. Current: <strong>v${current}</strong> — <a href="https://github.com/jackyhku/webserial" target="_blank" rel="noopener" style="color: var(--primary-color);">check on GitHub</a>`;
            return;
        }

        if (this.compareVersions(latest, current) > 0) {
            statusEl.innerHTML = `🆕 New version <strong>v${latest}</strong> available (you have v${current}) — <a href="https://github.com/jackyhku/webserial" target="_blank" rel="noopener" style="color: var(--primary-color);">update now</a>`;
        } else {
            statusEl.innerHTML = `✅ You are running the latest version (<strong>v${current}</strong>).`;
        }
    }

    // Initialize Socket.IO connection (Setup only)
    initSocket() {
        if (!CONFIG.websocket.enabled || typeof io === 'undefined') {
            return;
        }

        // Prevent multiple initializations
        if (this.socket) return;

        try {
            this.socket = io(CONFIG.websocket.url, {
                path: CONFIG.websocket.path,
                autoConnect: false // Don't connect automatically
            });

            this.socket.on('connect', () => {
                this.uiManager.updateServerStatus('connected');
            });

            this.socket.on('connection_response', (data) => {
                this.mySessionId = data.session_id;
                // Only show session ID if broadcast is enabled (as per user request)
                if (this.broadcastEnabled) {
                    this.uiManager.updateSessionId(this.mySessionId);
                }
                console.log('My Session ID:', this.mySessionId);
            });

            this.socket.on('disconnect', () => {
                this.uiManager.updateServerStatus('disconnected');
            });

            this.socket.on('connect_error', (err) => {
                this.uiManager.updateServerStatus('error', 'Connection Refused');
                // console.debug('Socket connect error', err); 
                // Silence expected errors if server is down, as per user request
            });

            this.socket.on('system_message', (data) => {
                this.uiManager.appendSystemMessage(data.message, true);
            });

            this.socket.on('serial_data_broadcast', (payload) => {
                if (this.activeMode === 'remote' && this.remoteManager.isConnected) {
                    const data = typeof payload === 'object' ? payload.data : payload;
                    const source = typeof payload === 'object' ? payload.source : 'Unknown';
                    this.uiManager.appendMessage(data, 'broadcast', null, source);
                    this.remoteManager.bytesReceived += data.length;
                }
            });

            this.socket.on('remote_data_broadcast', async (payload) => {
                // If we are the sender (Serial/Bluetooth mode) and receive a remote command
                // We should write it to the device
                if ((this.activeMode === 'serial' || this.activeMode === 'bluetooth') && this.activeManager.isConnected) {
                    try {
                        const data = typeof payload === 'object' ? payload.data : payload;
                        console.log('Received remote command:', data);

                        // Write to device
                        await this.activeManager.write(data);
                    } catch (error) {
                        console.error('Error executing remote command:', error);
                    }
                }
            });
        } catch (error) {
            console.error('Error initializing socket:', error);
        }
    }

    // Explicitly connect to socket
    connectSocket() {
        if (!this.socket) {
            this.initSocket();
        }

        if (this.socket && !this.socket.connected) {
            this.uiManager.updateServerStatus('connecting');
            this.socket.connect();
        }
    }

    // Explicitly disconnect from socket
    disconnectSocket() {
        if (this.socket && this.socket.connected) {
            this.socket.disconnect();
            this.uiManager.updateServerStatus('disconnected');
        }
    }

    // Setup serial manager event handlers
    setupSerialHandlers() {
        // Data received callback
        this.serialManager.onDataReceived = (text, rawBytes) => {
            if (this.activeMode === 'serial') {
                this.handleDataReceived(text);
            }
        };

        // Connection change callback
        this.serialManager.onConnectionChange = (connected) => {
            if (this.activeMode === 'serial') {
                this.handleConnectionChange(connected);
            }
        };

        // Error callback
        this.serialManager.onError = (error) => {
            if (this.activeMode === 'serial') {
                this.handleError(error);
            }
        };
    }

    // Setup bluetooth manager event handlers
    setupBluetoothHandlers() {
        this.bluetoothManager.onDataReceived = (text, rawBytes) => {
            if (this.activeMode === 'bluetooth') {
                this.handleDataReceived(text);
            }
        };

        this.bluetoothManager.onConnectionChange = (connected) => {
            if (this.activeMode === 'bluetooth') {
                this.handleConnectionChange(connected);
            }
        };

        this.bluetoothManager.onError = (error) => {
            if (this.activeMode === 'bluetooth') {
                this.handleError(error);
            }
        };
    }

    // Common data received handler
    handleDataReceived(data) {
        this.uiManager.appendMessage(data, 'received');
        this.uiManager.addToRxStats(data.length);

        // Broadcast if enabled
        if (this.socket && this.socket.connected && this.broadcastEnabled) {
            // Buffer data for broadcasting to ensure complete lines are sent
            this.broadcastBuffer += data;

            if (this.broadcastBuffer.includes('\n')) {
                const lines = this.broadcastBuffer.split('\n');
                // Keep the last chunk as it might be incomplete
                this.broadcastBuffer = lines.pop();

                // Emit all complete lines
                for (const line of lines) {
                    // Send with newline to maintain formatting
                    this.socket.emit('serial_data', line + '\n');
                }
            }
        }
    }

    // Common connection change handler
    handleConnectionChange(connected) {
        if (connected) {
            this.uiManager.updateConnectionStatus('connected');
            this.uiManager.updateConnectButton(true);
            const deviceName = this.activeMode === 'serial' ? 'Serial Device' : 'Bluetooth Device';
            this.uiManager.appendSystemMessage(`Connected to ${deviceName}`, false);
            this.uiManager.resetStats();
            this.startStatsUpdater();
        } else {
            this.uiManager.updateConnectionStatus('disconnected');
            this.uiManager.updateConnectButton(false);
            const deviceName = this.activeMode === 'serial' ? 'Serial Device' : 'Bluetooth Device';
            this.uiManager.appendSystemMessage(`Disconnected from ${deviceName}`, false);
            this.stopStatsUpdater();
        }
    }

    // Common error handler
    handleError(error) {
        // Only show error notifications if not during auto-reconnect (for serial)
        if (this.activeMode === 'serial' && this.isAutoReconnecting) {
            console.log('Connection attempt during auto-reconnect:', error.message);
            return;
        }

        console.error(`${this.activeMode} error:`, error);
        this.uiManager.showNotification(`Error: ${error.message}`, 'error');
        this.uiManager.updateConnectionStatus('error', error.message);
    }

    // Setup UI event handlers
    setupUIHandlers() {
        // Select port/device button
        this.uiManager.elements.selectPortBtn.addEventListener('click', async () => {
            await this.handleSelectDevice();
        });

        // Connection Mode Toggle (Segmented Control)
        const segmentedBtns = document.querySelectorAll('.segmented-btn');
        segmentedBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.mode;
                this.setConnectionMode(mode);
            });
        });

        // Broadcast Toggle
        const broadcastBtn = this.uiManager.elements.broadcastBtn;
        if (broadcastBtn) {
            broadcastBtn.addEventListener('click', () => {
                this.broadcastEnabled = !this.broadcastEnabled;
                this.uiManager.setBroadcastEnabled(this.broadcastEnabled); // Helper we added to UI

                // Trigger connection logic if needed, or just update UI
                if (this.broadcastEnabled) {
                    this.connectSocket();
                    // Wait a bit for connection? Or just try to create session immediately?
                    // Better to wait for 'connect' event, but for now we trust logic
                    if (this.socket && this.socket.connected) {
                        this.socket.emit('create_session');
                    } else if (this.socket) {
                        // Session will be created via UI controls or manual request if needed? 
                        // Or ideally we auto-create session on connect if broadcast is enabled.
                        // For now let's just ensure we connect.
                        this.socket.once('connect', () => {
                            this.socket.emit('create_session');
                        });
                    }
                } else {
                    // If we are not in remote mode, we can disconnect
                    if (this.activeMode !== 'remote') {
                        this.disconnectSocket();
                    }
                }

                const status = this.broadcastEnabled ? 'enabled' : 'disabled';
                this.uiManager.showNotification(`Remote Broadcast ${status}`, 'info');

                // If disabled, maybe hide session info immediately or keep it? 
                // Previous logic didn't explicitly clear it, but UI updates might handle it.
                if (!this.broadcastEnabled) {
                    this.uiManager.updateSessionId(null); // Hide it
                }
            });
        }

        // Connect/Disconnect button
        this.uiManager.elements.connectBtn.addEventListener('click', async () => {
            await this.handleConnectToggle();
        });

        // Apply configuration button
        this.uiManager.elements.applyConfigBtn.addEventListener('click', () => {
            this.handleApplyConfig();
        });

        // Save profile button
        this.uiManager.elements.saveProfileBtn.addEventListener('click', () => {
            this.handleSaveProfile();
        });

        // Send command button
        this.uiManager.elements.sendBtn.addEventListener('click', () => {
            this.handleSendCommand();
        });

        // Send command event (from Enter key)
        document.addEventListener('sendCommand', () => {
            this.handleSendCommand();
        });

        // Save log button
        this.uiManager.elements.saveLogBtn.addEventListener('click', () => {
            this.uiManager.saveLog();
        });
    }

    // Setup shortcut handlers
    setupShortcutHandlers() {
        // Execute shortcut callback
        this.shortcutsManager.onShortcutExecute = (command, lineEnding) => {
            this.executeShortcutCommand(command, lineEnding);
        };
    }

    // Set connection mode
    async setConnectionMode(mode) {
        if (this.activeMode === mode) return;

        // Disconnect current if connected
        if (this.activeManager.isConnected) {
            await this.activeManager.disconnect();
        }

        this.activeMode = mode;

        if (mode === 'serial') {
            this.activeManager = this.serialManager;
            if (!this.broadcastEnabled) this.disconnectSocket();
        } else if (mode === 'bluetooth') {
            this.activeManager = this.bluetoothManager;
            if (!this.broadcastEnabled) this.disconnectSocket();
        } else {
            this.activeManager = this.remoteManager;
            this.connectSocket();
        }

        // Update UI
        this.uiManager.updateModeUI(mode);

        if (mode === 'serial') {
            this.uiManager.appendSystemMessage('Switched to Serial / SPP 2.0 mode', false);
            this.uiManager.appendSystemMessage('ℹ️ For SPP 2.0 (HC-05): Pair in OS settings first, then select the COM/TTY port here.', false);
        } else if (mode === 'bluetooth') {
            this.uiManager.appendSystemMessage('Switched to Bluetooth (BLE 4.0) mode', false);
        } else {
            this.uiManager.appendSystemMessage('Switched to Remote Monitor mode', false);
            this.uiManager.appendSystemMessage('ℹ️ Listening for broadcasts from other devices...', false);
        }
    }

    // Handle device selection (Serial Port or Bluetooth Device)
    async handleSelectDevice() {
        try {
            if (this.activeMode === 'serial') {
                await this.serialManager.requestPort();
                const portInfo = this.serialManager.getPortInfo();
                this.uiManager.updatePortInfo(portInfo);
                this.uiManager.enableConnectButton();
                this.uiManager.showNotification('Port selected successfully', 'success');
                this.savePortInfo(portInfo);
            } else {
                await this.bluetoothManager.requestDevice(this.uiManager.bleFilter, this.uiManager.bleFilterName);
                const deviceInfo = this.bluetoothManager.getDeviceInfo();
                this.uiManager.updateDeviceInfo(deviceInfo);
                this.uiManager.enableConnectButton();
                this.uiManager.showNotification('Device selected successfully', 'success');
            }
        } catch (error) {
            if (error.message !== 'No port selected' && error.message !== 'No device selected') {
                this.uiManager.showNotification(error.message, 'error');
            }
        }
    }

    // Try to auto-reconnect to previously used port
    async tryAutoReconnect() {
        this.isAutoReconnecting = true;
        try {
            // Get previously authorized ports
            const ports = await navigator.serial.getPorts();

            if (ports.length === 0) {
                this.uiManager.appendSystemMessage('Click "Select Port" to get started', false);
                return;
            }

            // Load saved port info
            const savedPortInfo = this.loadPortInfo();
            const savedConfig = this.loadSerialConfig();

            // Try to find matching port
            let targetPort = null;

            if (savedPortInfo) {
                // Try to match by vendor/product ID
                targetPort = ports.find(port => {
                    const info = port.getInfo();
                    const vendorId = info.usbVendorId ? `0x${info.usbVendorId.toString(16).toUpperCase()}` : 'N/A';
                    const productId = info.usbProductId ? `0x${info.usbProductId.toString(16).toUpperCase()}` : 'N/A';
                    return vendorId === savedPortInfo.usbVendorId && productId === savedPortInfo.usbProductId;
                });
            }

            // If no match found, use the first port
            if (!targetPort && ports.length > 0) {
                targetPort = ports[0];
            }

            if (targetPort) {
                // Set up the port
                this.serialManager.port = targetPort;

                const portInfo = this.serialManager.getPortInfo();
                this.uiManager.updatePortInfo(portInfo);
                this.uiManager.enableConnectButton();

                // Try to auto-connect
                try {
                    this.uiManager.appendSystemMessage('Reconnecting to previous device...', false);
                    this.uiManager.updateConnectionStatus('connecting');

                    const config = savedConfig || this.uiManager.getSerialConfig();
                    await this.serialManager.connect(config);

                    this.uiManager.showNotification('Reconnected to previous device', 'success');
                } catch (connectError) {
                    // Connection failed, but port is selected
                    console.log('Auto-reconnect failed, port selected but not connected:', connectError.message);
                    this.uiManager.updateConnectionStatus('disconnected');
                    this.uiManager.appendSystemMessage('Previous device detected. Click "Connect" to reconnect.', false);
                }
            } else {
                this.uiManager.appendSystemMessage('Click "Select Port" to get started', false);
            }
        } catch (error) {
            // Silently handle auto-reconnect failures
            console.log('Auto-reconnect skipped:', error.message);
            this.uiManager.appendSystemMessage('Click "Select Port" to get started', false);
            this.uiManager.updateConnectionStatus('disconnected');
        } finally {
            this.isAutoReconnecting = false;
        }
    }

    // Save port info to localStorage
    savePortInfo(portInfo) {
        if (portInfo) {
            localStorage.setItem('esp32-monitor-last-port', JSON.stringify(portInfo));
        }
    }

    // Load port info from localStorage
    loadPortInfo() {
        const saved = localStorage.getItem('esp32-monitor-last-port');
        return saved ? JSON.parse(saved) : null;
    }

    // Save serial configuration
    saveSerialConfig(config) {
        localStorage.setItem('esp32-monitor-last-config', JSON.stringify(config));
    }

    // Load serial configuration
    loadSerialConfig() {
        const saved = localStorage.getItem('esp32-monitor-last-config');
        return saved ? JSON.parse(saved) : null;
    }

    // Handle connect/disconnect toggle
    async handleConnectToggle() {
        if (this.activeMode === 'remote') {
            if (this.activeManager.isConnected) {
                this.activeManager.disconnect();
            } else {
                const targetId = document.getElementById('targetSessionId').value.trim();
                if (!targetId) {
                    this.uiManager.showNotification('Please enter a Target Session ID', 'warning');
                    return;
                }
                this.activeManager.connect(targetId);
            }
            return;
        }

        if (this.activeManager.isConnected) {
            // Disconnect
            await this.activeManager.disconnect();
        } else {
            // Connect
            try {
                if (this.activeMode === 'serial' && !this.serialManager.port) {
                    this.uiManager.showNotification('Please select a port first', 'warning');
                    return;
                }

                if (this.activeMode === 'bluetooth' && !this.bluetoothManager.device) {
                    this.uiManager.showNotification('Please scan for a device first', 'warning');
                    return;
                }

                this.uiManager.updateConnectionStatus('connecting');

                // Get config based on mode
                let config = {};
                if (this.activeMode === 'serial') {
                    config = this.uiManager.getSerialConfig();
                } else {
                    // Get bluetooth config if we had UI for it, otherwise use defaults
                    config = this.bluetoothManager.config;
                }

                await this.activeManager.connect(config);

                // Save config if successful (and in serial mode)
                if (this.activeMode === 'serial') {
                    this.saveSerialConfig(config);
                }
            } catch (error) {
                this.uiManager.updateConnectionStatus('error');

                // Format error message for display
                const errorMsg = error.message.replace(/\n/g, '<br>');
                this.uiManager.showNotification(errorMsg, 'error', 5000);

                // Also log to console for debugging
                console.error('Connection error:', error);
            }
        }
    }

    // Handle apply configuration
    handleApplyConfig() {
        const config = this.uiManager.getSerialConfig();
        this.serialManager.updateConfig(config);
        this.uiManager.showNotification('Configuration updated', 'info');

        if (this.serialManager.isConnected) {
            this.uiManager.showNotification('Please reconnect for changes to take effect', 'warning');
        }
    }

    // Handle save profile
    handleSaveProfile() {
        const config = this.uiManager.getSerialConfig();
        const profileName = prompt('Enter profile name:');

        if (profileName) {
            const profiles = JSON.parse(localStorage.getItem('esp32-monitor-profiles') || '{}');
            profiles[profileName] = config;
            localStorage.setItem('esp32-monitor-profiles', JSON.stringify(profiles));
            this.uiManager.showNotification(`Profile "${profileName}" saved`, 'success');
        }
    }

    // Handle send command
    async handleSendCommand() {
        if (!this.activeManager.isConnected) {
            this.uiManager.showNotification('Not connected to a device', 'warning');
            return;
        }

        const command = this.uiManager.getCommand();
        if (!command.trim()) {
            return;
        }

        try {
            const lineEnding = this.uiManager.getLineEnding();
            await this.activeManager.write(command, lineEnding);

            // Add to UI
            this.uiManager.appendMessage(command, 'sent');

            // Add to history
            this.uiManager.addToHistory(command);

            // Clear input
            this.uiManager.clearCommandInput();
        } catch (error) {
            this.uiManager.showNotification(`Failed to send: ${error.message}`, 'error');
        }
    }

    // Execute shortcut command
    async executeShortcutCommand(command, explicitLineEnding = null) {
        if (!this.activeManager.isConnected) {
            this.uiManager.showNotification('Not connected to a device', 'warning');
            return;
        }

        try {
            // Use explicit line ending if provided (even if empty string for None)
            // Otherwise fall back to global setting (though for shortcuts we likely want explicit)
            // But if called without arg (e.g. legacy), use global?
            // Actually our shortcutsManager now always passes it (defaulting to '').
            // If explicitLineEnding is null/undefined, use global.
            let lineEnding;
            if (explicitLineEnding !== null && explicitLineEnding !== undefined) {
                lineEnding = this.uiManager.resolveLineEnding(explicitLineEnding);
            } else {
                lineEnding = this.uiManager.getLineEnding();
            }

            await this.activeManager.write(command, lineEnding);

            // Add to UI
            this.uiManager.appendMessage(command, 'sent');

            // Add to history
            this.uiManager.addToHistory(command);

            this.uiManager.showNotification(`Sent: ${command}`, 'info', 1500);
        } catch (error) {
            this.uiManager.showNotification(`Failed to send: ${error.message}`, 'error');
        }
    }

    // Start statistics updater
    startStatsUpdater() {
        this.statsInterval = setInterval(() => {
            const stats = this.activeManager.getStats();
            this.uiManager.updateStats(stats);
        }, 1000);
    }

    // Stop statistics updater
    stopStatsUpdater() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }

    // Show browser compatibility error
    showBrowserError() {
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; font-family: sans-serif; padding: 20px; text-align: center;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4m0 4h.01"/>
                </svg>
                <h1 style="margin-top: 20px; color: #2c3e50;">Web Serial API Not Supported</h1>
                <p style="color: #5a6c7d; max-width: 500px; margin-top: 10px;">
                    This application requires the Web Serial API, which is only available in Chrome and Edge browsers.
                </p>
                <p style="color: #5a6c7d; max-width: 500px; margin-top: 10px;">
                    Please use <strong>Google Chrome</strong> (version 89+) or <strong>Microsoft Edge</strong> (version 89+).
                </p>
                <a href="https://www.google.com/chrome/" style="margin-top: 20px; padding: 10px 20px; background: #3498db; color: white; text-decoration: none; border-radius: 8px;">
                    Download Chrome
                </a>
            </div>
        `;
    }
}

// Initialize application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new App();
    });
} else {
    new App();
}
