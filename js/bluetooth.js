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

        this.onDataReceived = null;
        this.onConnectionChange = null;
        this.onError = null;

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
    async requestDevice() {
        if (!this.isSupported()) {
            throw new Error('Web Bluetooth API is not supported in this browser. Please use Chrome or Edge.');
        }

        try {
            console.log('Requesting Bluetooth Device...');

            const optionalServices = Array.from(new Set([
                this.config.serviceUUID,
                ...this.knownProfiles.map(profile => profile.serviceUUID)
            ]));

            this.device = await navigator.bluetooth.requestDevice({
                // Use acceptAllDevices so modules that don't advertise service UUIDs in scan response
                // can still be selected in the chooser.
                acceptAllDevices: true,
                optionalServices
            });

            this.device.addEventListener('gattserverdisconnected', this.handleDisconnection.bind(this));
            return this.device;
        } catch (error) {
            if (error.name === 'NotFoundError') {
                throw new Error('No device selected');
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
                throw lastError || new Error('No compatible BLE UART service found on device');
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

            // Start notifications
            await this.rxCharacteristic.startNotifications();
            this.rxCharacteristic.addEventListener('characteristicvaluechanged', this.handleCharacteristicValueChanged.bind(this));

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
