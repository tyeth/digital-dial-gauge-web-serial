/**
 * Digital Dial Gauge Serial Handler
 * A modular library for communicating with digital dial gauges via serial connections
 */

class SerialGaugeHandler {
    constructor(options = {}) {
        // Configuration options
        this.options = {
            loggingEnabled: options.loggingEnabled !== undefined ? options.loggingEnabled : true,
            logCallback: options.logCallback || console.log,
            valueCallback: options.valueCallback || null,
            defaultUnit: options.defaultUnit || 'mm',
            bufferSize: options.bufferSize || 1024,
            ...options
        };

        // Serial port and reader
        this.port = null;
        this.reader = null;
        this.readableStreamClosed = null;

        // State tracking
        this.currentUnit = this.options.defaultUnit;
        this.offset = 0;
        this.recentMeasurements = [];
        this.MAX_RECENT_MEASUREMENTS = 5;
        this.hasReceivedNegativeValue = false;
        this.dataArray = [];
        this.isReading = false;
        
        // Bind methods
        this.log = this.log.bind(this);
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.readBinaryData = this.readBinaryData.bind(this);
        this.processPacket = this.processPacket.bind(this);
        this.isConsistentMeasurement = this.isConsistentMeasurement.bind(this);
        this.addToRecentMeasurements = this.addToRecentMeasurements.bind(this);
        this.updateValue = this.updateValue.bind(this);
        this.zeroGauge = this.zeroGauge.bind(this);
        this.toggleUnit = this.toggleUnit.bind(this);
        this.resetMemory = this.resetMemory.bind(this);
    }

    // Logging helper
    log(message, type = 'info') {
        if (!this.options.loggingEnabled) return;
        
        const timestamp = new Date().toLocaleTimeString('en-US', {hour12: false, fractionalSecondDigits: 3});
        const logMessage = `[${timestamp}] ${message}`;
        
        // Send to callback if provided
        if (this.options.logCallback) {
            this.options.logCallback(logMessage, type);
        }
        
        // Also log to console
        console.log(logMessage);
        
        return logMessage;
    }

    // Connect to serial device
    async connect(requestOptions = {}) {
        if (this.port) {
            this.log('Already connected to a device. Disconnect first.', 'warning');
            return false;
        }
        
        try {
            // Request port access
            this.port = await navigator.serial.requestPort();
            
            // Default serial options
            const serialOptions = {
                baudRate: requestOptions.baudRate || 9600,
                dataBits: requestOptions.dataBits || 8,
                parity: requestOptions.parity || 'none',
                stopBits: requestOptions.stopBits || 1,
                flowControl: requestOptions.flowControl || 'none'
            };
            
            // Open the port with settings
            await this.port.open(serialOptions);
            
            this.log(`Opening port with ${serialOptions.baudRate} baud, ${serialOptions.dataBits}${serialOptions.parity.charAt(0).toUpperCase()}${serialOptions.stopBits}`);
            
            // Set up binary data reader
            try {
                this.reader = this.port.readable.getReader();
                this.readableStreamClosed = new Promise(resolve => {
                    this.reader.closed.then(() => {
                        this.log('Reader closed');
                        resolve();
                    });
                });
                
                this.log('Binary reader set up');
                this.log(`Serial port parameters: ${serialOptions.baudRate} baud, ${serialOptions.dataBits}${serialOptions.parity.charAt(0).toUpperCase()}${serialOptions.stopBits}`);
                
                // Start reading binary data
                this.isReading = true;
                this.readBinaryData();
                
                return true;
            } catch (error) {
                this.log(`Error setting up binary reader: ${error.message}`, 'error');
                await this.disconnect();
                return false;
            }
        } catch (error) {
            this.log(`Error connecting to serial device: ${error.message}`, 'error');
            return false;
        }
    }

    // Disconnect from device
    async disconnect() {
        this.isReading = false;
        
        try {
            if (this.reader) {
                await this.reader.cancel();
                await this.readableStreamClosed;
                this.reader = null;
                this.readableStreamClosed = null;
            }
            
            if (this.port) {
                await this.port.close();
                this.port = null;
            }
            
            this.log('Disconnected from device');
            return true;
        } catch (error) {
            this.log(`Error disconnecting: ${error.message}`, 'error');
            return false;
        }
    }

    // Read binary data from the serial port
    async readBinaryData() {
        if (!this.reader || !this.isReading) return;
        
        try {
            let packetSize = 8; // Start with a larger packet size to capture more context
            let autoPacketSize = true; // Auto-detect packet size based on data patterns
            let buffer = new Uint8Array(0);
            let lastProcessTime = Date.now();
            let bytesReceived = 0;
            let patternSizes = {}; // Track frequency of different data pattern sizes
            let lastPacketTime = Date.now();
            let noDataTime = 0;
            
            this.log('Started reading binary data from device...');
            
            // Create processing mode with short timeout
            const scanMode = { timeout: 500 };
            
            while (this.isReading) {
                try {
                    const { value, done } = await this.reader.read();
                    
                    if (done) {
                        this.log('Binary reader closed');
                        break;
                    }
                    
                    if (value && value.length > 0) {
                        bytesReceived += value.length;
                        
                        // Convert bytes to hex for logging
                        const hexData = Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' ');
                        this.log(`Received ${value.length} bytes (${bytesReceived} total) - Hex: ${hexData}`);
                        
                        // Try to interpret as ASCII text directly for decimal values
                        try {
                            const textData = new TextDecoder().decode(value).trim();
                            this.log(`Raw ASCII data: "${textData}"`);
                            
                            // Look for well-formed decimal values (e.g., matching "14.862")
                            const decimalMatches = textData.match(/[-]?\d+\.\d{3}/g);
                            if (decimalMatches && decimalMatches.length > 0) {
                                this.log(`INFO: Found decimal values in raw data: ${decimalMatches.join(', ')}`);
                                
                                // Process each match as a separate reading
                                decimalMatches.forEach(match => {
                                    const packet = new TextEncoder().encode(match);
                                    this.processPacket(packet);
                                    lastPacketTime = Date.now();
                                });
                            }
                            
                            // Look for 6-digit formats that might be measurements
                            const digitFormats = textData.match(/[-]?\d{6}/g);
                            if (digitFormats && digitFormats.length > 0) {
                                this.log(`INFO: Found 6-digit format values in raw data: ${digitFormats.join(', ')}`);
                                
                                // Process each digit format
                                digitFormats.forEach(match => {
                                    const packet = new TextEncoder().encode(match);
                                    this.processPacket(packet);
                                    lastPacketTime = Date.now();
                                });
                            }
                        } catch (e) {
                            // Just continue if text decoding fails
                        }
                        
                        // Auto-detect packet size based on recurring patterns
                        if (autoPacketSize && value.length > 3) {
                            for (let i = 1; i < value.length - 2; i++) {
                                // Check for potential marker bytes
                                if (value[i] === value[i+1] && (i+2 < value.length && value[i] === value[i+2])) {
                                    const possibleSize = i;
                                    if (possibleSize > 1 && possibleSize <= 24) {
                                        patternSizes[possibleSize] = (patternSizes[possibleSize] || 0) + 1;
                                        
                                        // If we've seen this pattern enough times, use it
                                        if (patternSizes[possibleSize] >= 3) {
                                            if (packetSize !== possibleSize) {
                                                this.log(`INFO: Auto-detected packet size: ${possibleSize} bytes (previously ${packetSize})`);
                                                packetSize = possibleSize;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Concatenate with existing buffer
                        const newBuffer = new Uint8Array(buffer.length + value.length);
                        newBuffer.set(buffer);
                        newBuffer.set(value, buffer.length);
                        buffer = newBuffer;
                        
                        // Process complete packets
                        let packetsProcessed = 0;
                        while (buffer.length >= packetSize) {
                            const packet = buffer.slice(0, packetSize);
                            this.processPacket(packet);
                            packetsProcessed++;
                            
                            // Remove processed packet
                            buffer = buffer.slice(packetSize);
                            lastPacketTime = Date.now();
                        }
                        
                        if (packetsProcessed > 0) {
                            this.log(`INFO: Processed ${packetsProcessed} complete packets`);
                        }
                        
                        // Process fragments that might contain valid readings
                        if (buffer.length > 0) {
                            try {
                                const bufferText = new TextDecoder().decode(buffer);
                                
                                // Check for standard decimal format
                                const decimalMatch = bufferText.match(/[-]?\d+\.\d{3}/);
                                if (decimalMatch) {
                                    this.log(`INFO: Found decimal value "${decimalMatch[0]}" in buffer fragment`);
                                    const packet = new TextEncoder().encode(decimalMatch[0]);
                                    this.processPacket(packet);
                                    
                                    // Remove processed portion
                                    const matchIndex = bufferText.indexOf(decimalMatch[0]);
                                    if (matchIndex >= 0) {
                                        const endIndex = matchIndex + decimalMatch[0].length;
                                        buffer = buffer.slice(endIndex);
                                    }
                                } 
                                // Check for 6-digit format
                                else {
                                    const digitMatch = bufferText.match(/[-]?\d{6}/);
                                    if (digitMatch) {
                                        this.log(`INFO: Found 6-digit value "${digitMatch[0]}" in buffer fragment`);
                                        const packet = new TextEncoder().encode(digitMatch[0]);
                                        this.processPacket(packet);
                                        
                                        // Remove processed portion
                                        const matchIndex = bufferText.indexOf(digitMatch[0]);
                                        if (matchIndex >= 0) {
                                            const endIndex = matchIndex + digitMatch[0].length;
                                            buffer = buffer.slice(endIndex);
                                        }
                                    }
                                    
                                    lastPacketTime = Date.now();
                                }
                            } catch (e) {
                                // Continue if this fails
                            }
                        }
                        
                        lastProcessTime = Date.now();
                        noDataTime = 0;
                    } else {
                        // Track periods with no data
                        const currentTime = Date.now();
                        noDataTime = currentTime - lastProcessTime;
                        
                        // Log every 5 seconds of no data
                        if (noDataTime > 5000 && noDataTime % 5000 < 100) {
                            this.log(`INFO: No data received for ${Math.floor(noDataTime/1000)} seconds`);
                        }
                    }
                    
                    // Process partial packet after timeout
                    if (buffer.length > 0 && Date.now() - lastProcessTime > scanMode.timeout) {
                        this.log(`INFO: Processing buffer fragment after ${scanMode.timeout}ms timeout: ${buffer.length} bytes`);
                        this.processPacket(buffer);
                        buffer = new Uint8Array(0);
                        lastProcessTime = Date.now();
                    }
                    
                    // Try different packet sizes if nothing works
                    if (Date.now() - lastPacketTime > 10000 && buffer.length > 0) {
                        const alternativeSizes = [2, 3, 4, 6, 8];
                        const nextSize = alternativeSizes.find(size => size !== packetSize && buffer.length >= size) || packetSize;
                        
                        if (nextSize !== packetSize) {
                            this.log(`WARNING: No valid data detected for 10s. Trying alternative packet size: ${nextSize} bytes`);
                            packetSize = nextSize;
                            // Process with new size
                            if (buffer.length >= packetSize) {
                                const packet = buffer.slice(0, packetSize);
                                this.processPacket(packet);
                                buffer = buffer.slice(packetSize);
                                lastPacketTime = Date.now();
                            }
                        }
                    }
                } catch (innerError) {
                    this.log(`Error in read loop: ${innerError.message}`, 'error');
                    // Continue reading if possible
                    if (!this.isReading) break;
                }
            }
        } catch (error) {
            this.log(`Error reading binary data: ${error.message}`, 'error');
        } finally {
            if (this.reader) {
                try {
                    this.reader.releaseLock();
                    this.log('Binary reader lock released');
                } catch (e) {
                    this.log(`Error releasing lock: ${e.message}`, 'error');
                }
            }
        }
    }

    // Process a packet of binary data
    processPacket(packet) {
        try {
            // Convert to hex for logging
            const hexData = Array.from(packet).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`Processing packet: ${hexData}`);
            
            // Display as binary for pattern recognition
            const binData = Array.from(packet).map(b => b.toString(2).padStart(8, '0')).join(' ');
            this.log(`Binary representation: ${binData}`);
            
            // Check for known patterns
            const pattern = this.detectPattern(packet);
            if (pattern) {
                if (pattern.skip) {
                    return; // Skip further processing for non-measurement patterns
                }
                
                if (pattern.value !== undefined) {
                    this.updateValue(pattern.value, this.currentUnit);
                    return;
                }
            }
            
            // Extract values using multiple strategies
            let interpretations = [];
            
            // Strategy 1: ASCII string interpretation
            try {
                const textData = new TextDecoder().decode(packet).trim();
                
                // Check for explicit decimal format (eg. -12.345)
                const decimalMatch = textData.match(/^[-]?\d+\.\d{3}$/);
                if (decimalMatch) {
                    const value = parseFloat(decimalMatch[0]);
                    if (!isNaN(value)) {
                        interpretations.push({
                            method: "Decimal format", 
                            rawValue: value,
                            adjustedValue: value - this.offset,
                            confidence: "very high" 
                        });
                    }
                }
                
                // Check for 6-digit format (eg. 012345 or -012345)
                const digitMatch = textData.match(/^[-]?\d{6}$/);
                if (digitMatch) {
                    const numValue = parseInt(digitMatch[0], 10);
                    if (!isNaN(numValue)) {
                        // Convert to mm by dividing by 1000
                        const measuredValue = numValue / 1000;
                        interpretations.push({
                            method: "6-digit format (÷1000)", 
                            rawValue: numValue,
                            adjustedValue: measuredValue - this.offset,
                            confidence: "very high",
                            isNegative: numValue < 0
                        });
                    }
                }
                
                // Fall back to general numeric extraction
                if (interpretations.length === 0) {
                    const cleanedText = textData.replace(/[^\d.-]/g, '');
                    if (cleanedText.length > 0) {
                        const textValue = parseFloat(cleanedText);
                        if (!isNaN(textValue)) {
                            interpretations.push({
                                method: "ASCII text", 
                                rawValue: textValue,
                                adjustedValue: textValue - this.offset,
                                confidence: "medium"
                            });
                        }
                    }
                }
            } catch (e) {
                this.log(`Could not interpret as ASCII: ${e.message}`);
            }
            
            // Strategy 2: 16-bit integer interpretation
            if (packet.length >= 2) {
                // Try as 16-bit with different byte orders
                const value1 = (packet[packet.length-2] << 8) | packet[packet.length-1]; // big-endian
                const value2 = (packet[packet.length-1] << 8) | packet[packet.length-2]; // little-endian
                
                // Test different scale factors
                const scales = [1, 0.1, 0.01, 0.001];
                
                scales.forEach(scale => {
                    const adjustedValue1 = value1 * scale - this.offset;
                    const adjustedValue2 = value2 * scale - this.offset;
                    
                    // If values are in reasonable range for a digital gauge
                    if (adjustedValue1 >= -100 && adjustedValue1 <= 100) {
                        interpretations.push({
                            method: `16-bit BE ×${scale}`, 
                            rawValue: value1,
                            adjustedValue: adjustedValue1,
                            confidence: scale === 0.01 ? "high" : "medium" // Most gauges use 0.01mm precision
                        });
                    }
                    
                    if (adjustedValue2 >= -100 && adjustedValue2 <= 100) {
                        interpretations.push({
                            method: `16-bit LE ×${scale}`, 
                            rawValue: value2,
                            adjustedValue: adjustedValue2,
                            confidence: scale === 0.01 ? "high" : "medium"
                        });
                    }
                });
            }
            
            // Strategy 3: 24-bit value 
            if (packet.length >= 3) {
                // Try big-endian 24-bit
                const value = (packet[packet.length-3] << 16) | 
                            (packet[packet.length-2] << 8) | 
                            packet[packet.length-1];
                
                // Test different scale factors
                const scales = [0.001, 0.0001, 0.00001];
                
                scales.forEach(scale => {
                    const adjustedValue = value * scale - this.offset;
                    if (adjustedValue >= -100 && adjustedValue <= 100) {
                        interpretations.push({
                            method: `24-bit ×${scale}`, 
                            rawValue: value,
                            adjustedValue: adjustedValue,
                            confidence: "medium"
                        });
                    }
                });
            }
            
            // Log all interpretations
            if (interpretations.length > 0) {
                this.log(`Found ${interpretations.length} possible interpretations:`);
                interpretations.forEach(interp => {
                    this.log(`  - ${interp.method}: raw=${interp.rawValue}, value=${interp.adjustedValue.toFixed(3)} ${this.currentUnit} (confidence: ${interp.confidence})`);
                });
                
                // Sort by confidence
                const confidenceOrder = {"very high": 4, "high": 3, "medium": 2, "low": 1};
                interpretations.sort((a, b) => {
                    return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
                });
                
                const bestInterp = interpretations[0];
                
                // Check if consistent with recent measurements
                const consistentValue = this.isConsistentMeasurement(bestInterp.adjustedValue);
                
                if (consistentValue || bestInterp.confidence === "very high" || bestInterp.confidence === "high") {
                    this.log(`SELECTED interpretation: ${bestInterp.method} = ${bestInterp.adjustedValue.toFixed(3)} ${this.currentUnit}`);
                    
                    // Update the gauge display via callback
                    this.updateValue(bestInterp.adjustedValue, this.currentUnit);
                    
                    // Add to data array for export
                    this.dataArray.push({
                        timestamp: new Date().toISOString(),
                        value: bestInterp.adjustedValue,
                        unit: this.currentUnit,
                        raw: hexData,
                        method: bestInterp.method,
                        consistent: consistentValue
                    });
                    
                    // Add to recent measurements
                    this.addToRecentMeasurements(bestInterp.adjustedValue);
                } else {
                    this.log(`INFO: Skipping inconsistent measurement: ${bestInterp.adjustedValue.toFixed(3)} ${this.currentUnit}`);                        
                }
            } else {
                this.log(`WARNING: Could not interpret data - no valid measurements found`);
            }
        } catch (error) {
            this.log(`ERROR: Processing packet failed: ${error.message}`, 'error');
        }
    }

    // Detect known patterns in raw data
    detectPattern(packet) {
        // Look for repeated bytes (might indicate idle or error state)
        if (packet.length > 1) {
            const allSame = packet.every(b => b === packet[0]);
            if (allSame) {
                this.log(`PATTERN DETECTED: All bytes are identical (${packet[0].toString(16)})`);  
                return { skip: true };
            }
        }
        
        // Look for incrementing/decrementing sequence (might be noise or handshake)
        if (packet.length > 2) {
            let incrementing = true;
            let decrementing = true;
            
            for (let i = 1; i < packet.length; i++) {
                if (packet[i] !== packet[i-1] + 1) incrementing = false;
                if (packet[i] !== packet[i-1] - 1) decrementing = false;
            }
            
            if (incrementing) {
                this.log(`PATTERN DETECTED: Incrementing sequence`);  
                return { skip: true };
            }
            if (decrementing) {
                this.log(`PATTERN DETECTED: Decrementing sequence`);  
                return { skip: true };
            }
        }
        
        // No specific pattern detected
        return null;
    }

    // Check if measurement is consistent with recent values
    isConsistentMeasurement(value) {
        if (this.recentMeasurements.length === 0) {
            this.log(`INFO: First measurement (${value.toFixed(3)}) accepted as baseline`);
            return true; // First measurement is always accepted
        }
        
        // Detect sign change
        const lastMeasurement = this.recentMeasurements[this.recentMeasurements.length - 1];
        const isSignChange = (value < 0 && lastMeasurement >= 0) || (value >= 0 && lastMeasurement < 0);
        
        // Accept sign changes
        if (isSignChange) {
            this.log(`INFO: Sign change detected (${lastMeasurement.toFixed(3)} → ${value.toFixed(3)}), accepting new value`);
            return true;
        }
        
        // Check if the value is close to recent measurements
        const isDifferentFromAll = this.recentMeasurements.every(recentValue => {
            const diff = Math.abs(value - recentValue);
            // Allow small changes but reject large jumps
            return diff > 1.0; // Threshold for what's considered a jump
        });
        
        // Log results
        if (isDifferentFromAll) {
            this.log(`WARNING: Value ${value.toFixed(3)} differs significantly from recent values [${this.recentMeasurements.map(v => v.toFixed(3)).join(', ')}]`);
        } else {
            this.log(`INFO: Value ${value.toFixed(3)} is consistent with recent measurements`);
        }
        
        // Reject if very different from all recent measurements
        return !isDifferentFromAll;
    }

    // Add a measurement to the recent measurements list
    addToRecentMeasurements(value) {
        this.recentMeasurements.push(value);
        if (this.recentMeasurements.length > this.MAX_RECENT_MEASUREMENTS) {
            const removed = this.recentMeasurements.shift(); // Remove oldest
            this.log(`INFO: Updated measurement history. Removed ${removed.toFixed(3)}, added ${value.toFixed(3)}`);
        } else {
            this.log(`INFO: Added ${value.toFixed(3)} to measurement history (${this.recentMeasurements.length}/${this.MAX_RECENT_MEASUREMENTS})`);
        }
        
        // Track negative values
        if (value < 0 && !this.hasReceivedNegativeValue) {
            this.hasReceivedNegativeValue = true;
            this.log(`INFO: First negative value detected: ${value.toFixed(3)}`);
        }
    }

    // Update the displayed value (via callback)
    updateValue(value, unit) {
        // Call the provided callback with the value
        if (this.options.valueCallback) {
            this.options.valueCallback(value, unit);
        }
    }

    // Zero the gauge (set current reading as reference)
    zeroGauge(currentValue) {
        if (currentValue !== undefined) {
            this.offset = currentValue + this.offset;
            this.log(`Gauge zeroed. New offset: ${this.offset} ${this.currentUnit}`);
            
            // Update display with zero
            this.updateValue(0, this.currentUnit);
            return true;
        }
        return false;
    }

    // Toggle between mm and inches
    toggleUnit(currentValue) {
        if (this.currentUnit === 'mm') {
            this.currentUnit = 'in';
            
            // Convert from mm to inches if a value is provided
            if (currentValue !== undefined) {
                const inValue = currentValue * 0.03937;
                this.updateValue(inValue, this.currentUnit);
            }
        } else {
            this.currentUnit = 'mm';
            
            // Convert from inches to mm if a value is provided
            if (currentValue !== undefined) {
                const mmValue = currentValue * 25.4;
                this.updateValue(mmValue, this.currentUnit);
            }
        }
        
        this.log(`Unit changed to ${this.currentUnit}`);
        return this.currentUnit;
    }

    // Reset measurement memory
    resetMemory() {
        this.recentMeasurements = [];
        this.hasReceivedNegativeValue = false;
        this.log(`INFO: Memory reset - cleared measurement history and sign tracking`);
        return true;
    }
    
    // Get data for export
    getData() {
        return this.dataArray;
    }
    
    // Check if connected
    isConnected() {
        return !!this.port;
    }
}

// Export for use in Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SerialGaugeHandler;
} else if (typeof window !== 'undefined') {
    window.SerialGaugeHandler = SerialGaugeHandler;
}