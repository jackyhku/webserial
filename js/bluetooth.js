// Web Bluetooth API Handler
class BluetoothManager {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.rxCharacteristic = null;
        this.txCharacteristic = null;
        this.isConnected = false;

        // Configuration
        this.config = {
            // Default to Nordic UART Service
            serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
            txUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Write to this
            rxUUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // Read/Notify from this
            mtu: 20 // Default MTU size
        };

        // Known BLE UART profiles (for compatibility with common BLE-to-Serial modules)
        this.knownProfiles = [
            {
                name: 'Nordic UART',
                serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
                txUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
                rxUUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
            },
            {
                // Common on HM-10 style BLE UART firmware
                name: 'HM-10 UART',
                serviceUUID: '0000ffe0-0000-1000-8000-00805f9b34fb',
                txUUID: '0000ffe1-0000-1000-8000-00805f9b34fb',
                rxUUID: '0000ffe1-0000-1000-8000-00805f9b34fb'
            }
        ];

        // Service UUIDs advertised by common BLE UART modules.
        // Used to filter the device picker down to likely-serial devices.
        // Note: a device only appears if its *advertisement* includes one of these.
        this.bleFilterServices = [
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (ESP32, nRF)
            '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / BT-04A style
            '0000fff0-0000-1000-8000-00805f9b34fb', // Common clone variant
            '0000ffd0-0000-1000-8000-00805f9b34fb'  // Common clone variant
        ];

        this.onDataReceived = null;
        this.onConnectionChange = null;
        this.onError = null;

        // RX polling (fallback for characteristics that don't support notify)
        this.rxPollTimer = null;

        // Statistics
        this.bytesReceived = 0;
        this.bytesSent = 0;
        this.connectionStartTime = null;
    }

    // Check if Web Bluetooth API is supported
    isSupported() {
        return 'bluetooth' in navigator;
    }

    // Scan for devices
    // filterOnly:  true -> only show devices matching the filter below
    // namePattern: comma-separated device name prefixes (e.g. "BT-04, BT04").
    //              When blank, filters by known UART service UUIDs instead.
    async requestDevice(filterOnly = false, namePattern = '') {
        if (!this.isSupported()) {
            throw new Error('Web Bluetooth API is not supported in this browser. Please use Chrome or Edge.');
        }

        try {
            console.log('Requesting Bluetooth Device...', { filterOnly, namePattern });

            const optionalServices = Array.from(new Set([
                this.config.serviceUUID,
                ...this.knownProfiles.map(profile => profile.serviceUUID)
            ]));

            const requestOptions = {
                // Use acceptAllDevices so modules that don't advertise service UUIDs in scan response
                // can still be selected in the chooser.
                acceptAllDevices: !filterOnly,
                optionalServices
            };

            if (filterOnly) {
                const names = String(namePattern || '').split(',')
                    .map(n => n.trim())
                    .filter(n => n.length > 0);

                if (names.length > 0) {
                    // Show only devices whose advertised name starts with one of these prefixes
                    requestOptions.filters = names.map(name => ({ namePrefix: name }));
                } else {
                    // No name given: show only devices advertising a known UART service
                    requestOptions.filters = [{ services: this.bleFilterServices }];
                }
                delete requestOptions.optionalServices;
            }

            this.device = await navigator.bluetooth.requestDevice(requestOptions);

            this.device.addEventListener('gattserverdisconnected', this.handleDisconnection.bind(this));
            return this.device;
        } catch (error) {
            if (error.name === 'NotFoundError') {
                throw new Error(filterOnly
                    ? 'No device selected — if your module is missing, check the name pattern (Settings) or turn the filter off'
                    : 'No device selected');
            }
            throw error;
        }
    }

    // Get device info
    getDeviceInfo() {
        if (!this.device) return null;
        return {
            name: this.device.name || 'Unknown Device',
            id: this.device.id
        };
    }

    // Update configuration
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    isCharacteristicWritable(characteristic) {
        return !!(
            characteristic?.properties?.write ||
            characteristic?.properties?.writeWithoutResponse
        );
    }

    isCharacteristicReadable(characteristic) {
        return !!(
            characteristic?.properties?.notify ||
            characteristic?.properties?.indicate ||
            characteristic?.properties?.read
        );
    }

    async resolveServiceCharacteristics(service, profile) {
        let txCharacteristic = null;
        let rxCharacteristic = null;

        try {
            txCharacteristic = await service.getCharacteristic(profile.txUUID);
        } catch (_) {
            txCharacteristic = null;
        }

        try {
            rxCharacteristic = await service.getCharacteristic(profile.rxUUID);
        } catch (_) {
            rxCharacteristic = null;
        }

        if (
            txCharacteristic &&
            rxCharacteristic &&
            this.isCharacteristicWritable(txCharacteristic) &&
            this.isCharacteristicReadable(rxCharacteristic)
        ) {
            return { txCharacteristic, rxCharacteristic };
        }

        const allCharacteristics = await service.getCharacteristics();

        if (!txCharacteristic || !this.isCharacteristicWritable(txCharacteristic)) {
            txCharacteristic = allCharacteristics.find(characteristic => this.isCharacteristicWritable(characteristic)) || null;
        }

        if (!rxCharacteristic || !this.isCharacteristicReadable(rxCharacteristic)) {
            rxCharacteristic = allCharacteristics.find(characteristic => this.isCharacteristicReadable(characteristic)) || null;
        }

        if (!txCharacteristic || !rxCharacteristic) {
            throw new Error('No compatible TX/RX characteristics found in BLE service');
        }

        return { txCharacteristic, rxCharacteristic };
    }

    // Auto-detect UART-like characteristics in any service.
    // Fallback for modules (e.g. BT-04A firmware variants) that use
    // non-standard service/characteristic UUIDs not in knownProfiles.
    async detectGenericUart() {
        const services = await this.server.getPrimaryServices();
        let lastError = null;

        for (const service of services) {
            let characteristics;
            try {
                characteristics = await service.getCharacteristics();
            } catch (error) {
                lastError = error;
                continue;
            }

            let tx = null;
            let rx = null;

            for (const characteristic of characteristics) {
                const isWritable = this.isCharacteristicWritable(characteristic);
                const isReadable = this.isCharacteristicReadable(characteristic);

                if (isWritable && isReadable) {
                    // Single characteristic used for both directions (common on cheap UART modules)
                    if (!tx) { tx = characteristic; rx = characteristic; break; }
                }
                if (isWritable && !tx) tx = characteristic;
                if (isReadable && !rx) rx = characteristic;
            }

            if (tx && rx) {
                console.log(`Generic UART detected in service ${service.uuid}`, {
                    tx: tx.uuid, rx: rx.uuid
                });
                return { service, txCharacteristic: tx, rxCharacteristic: rx };
            }
        }

        throw lastError || new Error('No UART-like service found on device');
    }

    // Poll rx characteristic as fallback when notifications are unavailable
    startRxPolling(intervalMs = 100) {
        if (this.rxPollTimer) return;
        console.log('RX notifications unavailable, falling back to polling');
        this.rxPollTimer = setInterval(async () => {
            try {
                const value = await this.rxCharacteristic.readValue();
                if (value && value.byteLength > 0) {
                    this.handleCharacteristicValueChanged({ target: { value } });
                }
            } catch (error) {
                this.stopRxPolling();
                console.error('RX polling failed:', error);
            }
        }, intervalMs);
    }

    stopRxPolling() {
        if (this.rxPollTimer) {
            clearInterval(this.rxPollTimer);
            this.rxPollTimer = null;
        }
    }

    // Connect to device
    async connect() {
        if (!this.device) {
            throw new Error('No device selected. Please scan for a device first.');
        }

        if (this.device.gatt.connected) {
            throw new Error('Already connected');
        }

        try {
            console.log('Connecting to GATT Server...');
            this.server = await this.device.gatt.connect();

            const candidates = [];
            const pushUniqueProfile = (profile) => {
                if (!profile?.serviceUUID || !profile?.txUUID || !profile?.rxUUID) return;
                const exists = candidates.some(item =>
                    item.serviceUUID === profile.serviceUUID &&
                    item.txUUID === profile.txUUID &&
                    item.rxUUID === profile.rxUUID
                );
                if (!exists) candidates.push(profile);
            };

            pushUniqueProfile({
                name: 'Custom',
                serviceUUID: this.config.serviceUUID,
                txUUID: this.config.txUUID,
                rxUUID: this.config.rxUUID
            });
            this.knownProfiles.forEach(pushUniqueProfile);

            let lastError = null;
            let connectedProfile = null;

            for (const profile of candidates) {
                try {
                    console.log(`Trying BLE profile: ${profile.name}`);
                    this.service = await this.server.getPrimaryService(profile.serviceUUID);

                    const resolved = await this.resolveServiceCharacteristics(this.service, profile);
                    this.txCharacteristic = resolved.txCharacteristic;
                    this.rxCharacteristic = resolved.rxCharacteristic;

                    connectedProfile = profile;
                    break;
                } catch (error) {
                    lastError = error;
                }
            }

            if (!connectedProfile) {
                // Fallback: auto-detect UART characteristics in any service.
                // Allows devices like BT-04A that use non-standard service UUIDs.
                try {
                    console.log('Known profiles failed, falling back to generic auto-detection...');
                    const detected = await this.detectGenericUart();
                    this.service = detected.service;
                    this.txCharacteristic = detected.txCharacteristic;
                    this.rxCharacteristic = detected.rxCharacteristic;
                    connectedProfile = {
                        name: `Generic (${detected.service.uuid})`,
                        serviceUUID: detected.service.uuid,
                        txUUID: detected.txCharacteristic.uuid,
                        rxUUID: detected.rxCharacteristic.uuid
                    };
                } catch (genericError) {
                    throw lastError || genericError || new Error('No compatible BLE UART service found on device');
                }
            }

            this.config = {
                ...this.config,
                serviceUUID: connectedProfile.serviceUUID,
                txUUID: this.txCharacteristic.uuid,
                rxUUID: this.rxCharacteristic.uuid
            };
            console.log(`Connected using BLE profile: ${connectedProfile.name}`);
            console.log('Resolved BLE characteristics:', {
                txUUID: this.txCharacteristic.uuid,
                txProps: this.txCharacteristic.properties,
                rxUUID: this.rxCharacteristic.uuid,
                rxProps: this.rxCharacteristic.properties
            });

            // Start notifications (fall back to polling if not supported)
            const supportsNotify = !!(
                this.rxCharacteristic.properties?.notify ||
                this.rxCharacteristic.properties?.indicate
            );

            if (supportsNotify) {
                try {
                    await this.rxCharacteristic.startNotifications();
                    this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.handleCharacteristicValueChanged.bind(this));
                } catch (notifyError) {
                    console.warn('startNotifications failed, using RX polling instead:', notifyError);
                    this.startRxPolling();
                }
            } else {
                this.startRxPolling();
            }

            this.isConnected = true;
            this.connectionStartTime = Date.now();
            this.bytesReceived = 0;
            this.bytesSent = 0;

            if (this.onConnectionChange) {
                this.onConnectionChange(true);
            }
            return true;
        } catch (error) {
            console.error('Bluetooth connection failed:', error);
            this.isConnected = false;

            let errorMessage = error.message;
            if (error.name === 'NetworkError') {
                errorMessage = 'Bluetooth connection failed. Ensure device is powered on and in range.';
            }

            if (this.onError) {
                this.onError(new Error(errorMessage));
            }
            throw error;
        }
    }

    // Handle incoming data
    handleCharacteristicValueChanged(event) {
        const value = event.target.value;
        this.bytesReceived += value.byteLength;

        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(value);

        if (this.onDataReceived) {
            this.onDataReceived(text, value);
        }
    }

    // Handle disconnection
    handleDisconnection(event) {
        console.log('Bluetooth Device disconnected');
        this.isConnected = false;
        this.connectionStartTime = null;
        this.stopRxPolling();

        if (this.onConnectionChange) {
            this.onConnectionChange(false);
        }
    }

    // Disconnect
    async disconnect() {
        if (!this.device) return;

        if (this.device.gatt.connected) {
            this.device.gatt.disconnect();
        } else {
            // Already disconnected or never connected, just cleanup
            this.handleDisconnection();
        }
    }

    // Write data
    async write(data, addLineEnding = '') {
        if (!this.isConnected || !this.txCharacteristic) {
            throw new Error('Not connected to a Bluetooth device');
        }

        try {
            const encoder = new TextEncoder();
            const dataToSend = data + addLineEnding;
            const encoded = encoder.encode(dataToSend);

            const supportsWriteWithResponse = !!this.txCharacteristic.properties?.write;
            const supportsWriteWithoutResponse = !!this.txCharacteristic.properties?.writeWithoutResponse;

            // BLE typically has max MTU (20 bytes default)
            const chunkSize = this.config.mtu;
            for (let i = 0; i < encoded.byteLength; i += chunkSize) {
                const chunk = encoded.slice(i, i + chunkSize);

                let writeSucceeded = false;
                let lastWriteError = null;

                const writeAttempts = [];
                if (supportsWriteWithoutResponse && typeof this.txCharacteristic.writeValueWithoutResponse === 'function') {
                    writeAttempts.push(() => this.txCharacteristic.writeValueWithoutResponse(chunk));
                }
                if (supportsWriteWithResponse && typeof this.txCharacteristic.writeValueWithResponse === 'function') {
                    writeAttempts.push(() => this.txCharacteristic.writeValueWithResponse(chunk));
                }
                if (typeof this.txCharacteristic.writeValue === 'function') {
                    writeAttempts.push(() => this.txCharacteristic.writeValue(chunk));
                }

                if (writeAttempts.length === 0) {
                    throw new Error('No supported write method is available on this BLE characteristic');
                }

                for (const attempt of writeAttempts) {
                    try {
                        await attempt();
                        writeSucceeded = true;
                        break;
                    } catch (error) {
                        lastWriteError = error;
                    }
                }

                if (!writeSucceeded) {
                    throw lastWriteError || new Error('Failed to write BLE data');
                }

                this.bytesSent += chunk.byteLength;
            }

            return true;
        } catch (error) {
            console.error('Error writing to Bluetooth:', error);
            if (this.onError) {
                this.onError(error);
            }
            throw error;
        }
    }

    // Get stats (reuse same structure as SerialManager)
    getStats() {
        return {
            bytesReceived: this.bytesReceived,
            bytesSent: this.bytesSent,
            uptime: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BluetoothManager;
}
