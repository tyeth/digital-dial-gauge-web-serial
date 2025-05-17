/**
 * Digital Dial Gauge Node.js Test Script
 * Test the serial handler module with real hardware using node-serialport
 * 
 * Install requirements:
 *   npm install serialport
 * 
 * Usage:
 *   node test-serial.js [PORT] [BAUD]
 *   
 *   Example: node test-serial.js /dev/ttyUSB0 9600
 */

// Import serialport
let SerialPort;
try {
    SerialPort = require('serialport').SerialPort;
} catch (e) {
    console.error('Error loading SerialPort module. Make sure you have installed it:');
    console.error('  npm install serialport');
    process.exit(1);
}

// Import our SerialGaugeHandler (modified for Node.js)
const SerialGaugeHandler = require('./serial-handler-node.js');

// Default settings
const DEFAULT_PORT = '/dev/ttyUSB0';
const DEFAULT_BAUD = 9600;

// Get command line args
const args = process.argv.slice(2);
const PORT = args[0] || DEFAULT_PORT;
const BAUD_RATE = parseInt(args[1] || DEFAULT_BAUD, 10);

// Create a raw buffer to store incoming data
let rawBuffer = Buffer.alloc(0);
let packetLog = [];
const MAX_PACKETS = 100; // Store the last 100 packets

// Set up the SerialGaugeHandler
const gaugeHandler = new SerialGaugeHandler({
    loggingEnabled: true,
    logCallback: (message, type) => {
        console.log(message);
    },
    valueCallback: (value, unit) => {
        console.log(`\n** MEASUREMENT: ${value.toFixed(3)} ${unit} **\n`);
    }
});

// Log the raw buffer as hex when it changes
function logRawBuffer() {
    if (rawBuffer.length === 0) return;
    
    console.log('Raw buffer:');
    console.log(rawBuffer.toString('hex').match(/.{1,2}/g).join(' '));
    
    // Also log as ASCII
    const asciiChars = [...rawBuffer].map(byte => {
        return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.';
    }).join('');
    console.log(`ASCII: ${asciiChars}`);
    
    // Store in packet log
    packetLog.push({
        timestamp: new Date().toISOString(),
        hex: rawBuffer.toString('hex'),
        ascii: asciiChars
    });
    
    // Trim log if too large
    if (packetLog.length > MAX_PACKETS) {
        packetLog.shift();
    }
}

// Main function
async function main() {
    console.log(`Opening serial port ${PORT} at ${BAUD_RATE} baud...`);
    
    // Create serial port
    const port = new SerialPort({
        path: PORT,
        baudRate: BAUD_RATE,
        dataBits: 8,
        parity: 'none',
        stopBits: 1,
        flowControl: false
    });
    
    // Set up event handlers
    port.on('open', () => {
        console.log('Serial port opened successfully');
        console.log('Waiting for data...');
    });
    
    port.on('error', (err) => {
        console.error('Serial port error:', err.message);
    });
    
    port.on('close', () => {
        console.log('Serial port closed');
    });
    
    // Data handler - log the raw data and pass to our handler
    port.on('data', (data) => {
        // Log the raw data
        console.log(`Received ${data.length} bytes:`, data.toString('hex').match(/.{1,2}/g).join(' '));
        
        // Append to raw buffer
        const newBuffer = Buffer.alloc(rawBuffer.length + data.length);
        newBuffer.set(new Uint8Array(rawBuffer), 0);
        newBuffer.set(new Uint8Array(data), rawBuffer.length);
        rawBuffer = newBuffer;
        
        // Log updated buffer
        logRawBuffer();
        
        // Process with our gauge handler
        gaugeHandler.processPacket(new Uint8Array(data));
    });
    
    // Handle keyboard input for commands
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
        // Ctrl+C to exit
        if (key.toString() === '\u0003') {
            console.log('Exiting...');
            port.close();
            setTimeout(() => process.exit(0), 100);
        }
        
        // 'z' to zero the gauge
        if (key.toString() === 'z') {
            console.log('Zeroing the gauge...');
            gaugeHandler.zeroGauge(0);
        }
        
        // 'u' to toggle units
        if (key.toString() === 'u') {
            console.log('Toggling units...');
            gaugeHandler.toggleUnit(0);
        }
        
        // 'c' to clear the buffer
        if (key.toString() === 'c') {
            console.log('Clearing buffer...');
            rawBuffer = Buffer.alloc(0);
        }
        
        // 'r' to reset memory
        if (key.toString() === 'r') {
            console.log('Resetting memory...');
            gaugeHandler.resetMemory();
        }
        
        // 'p' to print packet log
        if (key.toString() === 'p') {
            console.log('Packet Log:');
            packetLog.forEach((packet, i) => {
                console.log(`[${i}] ${packet.timestamp} - Hex: ${packet.hex}, ASCII: ${packet.ascii}`);
            });
        }
        
        // 's' to save packet log to file
        if (key.toString() === 's') {
            const fs = require('fs');
            const filename = `packet_log_${new Date().toISOString().replace(/:/g, '-')}.json`;
            
            console.log(`Saving packet log to ${filename}...`);
            fs.writeFileSync(filename, JSON.stringify(packetLog, null, 2));
            console.log('Packet log saved.');
        }
    });
}

// Run the main function
main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});