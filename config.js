/**
 * Configuration file for WebSerial Monitor
 * Centralized location for all application settings
 */

const CONFIG = {
    // Server settings (if using a backend server)
    server: {
        port: 6011,
        host: 'localhost',
        protocol: 'http' // or 'https'
    },

    // WebSocket settings (if applicable)
    websocket: {
        enabled: true,
        // Dynamically determine URL based on current page location
        // This supports localhost, local IP (192.168.x.x), and production domains (e.g. webserial.qrhk.app)
        url: (typeof window !== 'undefined' && window.location.protocol !== 'file:')
            ? window.location.origin
            : 'http://localhost:6011',
        path: '/socket.io'
    },

    // Serial port default settings
    serial: {
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: 8192
    },

    // Bluetooth default settings (Nordic UART Service)
    bluetooth: {
        serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        txUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
        rxUUID: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
        mtu: 20
    },

    // UI settings
    ui: {
        theme: 'dark', // 'dark' or 'light'
        maxLogLines: 1000,
        autoScroll: true,
        timestampFormat: 'HH:mm:ss.SSS'
    },

    // Application settings
    app: {
        name: 'ESP32 WebSerial Monitor',
        version: '1.1.0',
        debug: false
    }
};

// Export for use in modules (Node.js/CommonJS)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

// Export for use in browser (ES6 modules)
if (typeof window !== 'undefined') {
    window.CONFIG = CONFIG;
}
