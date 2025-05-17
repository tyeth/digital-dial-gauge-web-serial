/**
 * Digital Dial Gauge Serial Handler (Node.js version)
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

        // State tracking
        this.currentUnit = this.options.defaultUnit;
        this.offset = 0;
        this.recentMeasurements = [];
        this.MAX_RECENT_MEASUREMENTS = 5;
        this.hasReceivedNegativeValue = false;
        this.dataArray = [];
        
        // Bind methods
        this.log = this.log.bind(this);
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
        
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}`;
        
        // Send to callback if provided
        if (this.options.logCallback) {
            this.options.logCallback(logMessage, type);
        }
        
        // Also log to console
        console.log(logMessage);
        
        return logMessage;
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
                // In Node.js we can use Buffer.toString()
                const textData = Buffer.from(packet).toString().trim();
                
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
}

// Export for Node.js
module.exports = SerialGaugeHandler;