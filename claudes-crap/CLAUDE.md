Digital Dial Gauge Interface Project Summary
Objective
Create an open-source solution to interface with a digital dial gauge that connects via RS232-to-USB adapter, replacing the proprietary Chinese Windows software with a web-based solution.
Hardware Setup

Digital dial gauge with data port
Official data cable with RS232-to-USB adapter
Computer running Chrome-based browser (required for Web Serial API support)

Technical Details Discovered

Communication Protocol: Serial connection at 9600 baud, 8 data bits, no parity, 1 stop bit (8N1)
Reference Project: Hackaday project (https://hackaday.io/project/511-digital-dial-indicator-cnc-surface-probe)
Data Format: The digital gauge outputs a custom protocol at 1.3V levels, structured in 6 nibbles (24 bits) we have converted via custom cable to rs232 with then rs232->usb adapter.
Signal Chain: The gauge's data and clock signals are processed by a microcontroller or the RS232 adapter to convert to standard serial output

Solution Developed
We created a web-based digital dial gauge console using the Web Serial API with the following features:

Connects to the gauge through the RS232-to-USB adapter
Configurable serial parameters (baud rate, data bits, parity, stop bits, flow control)
Real-time display of measurements with a visual gauge
Zero function to set reference points
Unit conversion (mm/inches)
Data logging and CSV export capability

Implementation Notes

Uses HTML/JavaScript with the Web Serial API (Chrome-based browsers only)
Parses ASCII data coming from the RS232 adapter
Must be run in a secure context (HTTPS or localhost)
When embedding in an iframe via oembed (create oembed.json), requires allow="serial; usb" attribute

Next Steps

Test with actual hardware to verify correct data parsing
Potentially enhance data visualization based on needs
Consider adding data analysis features if required
Refine error handling for better robustness

This solution provides a complete replacement for the proprietary software, with additional features like data logging and export that may not be available in the original software.
This repository is for a digital dial gauge application that uses the Web Serial API. The Web Serial API allows websites to communicate with serial devices, making it possible to read data from digital measuring instruments like dial gauges.

## Web Serial API Notes

The Web Serial API is used to communicate with serial devices:

- The API requires user activation (like a button click) to request port access
- Data is sent and received as Uint8Array or similar binary formats
- Serial connections should be properly opened and closed
- Error handling is important for device disconnections
- if you try to read /dev/ttyUSB0 then it should be constantly returning the equivalent of -9.891mm

## Best Practices

- Use asynchronous programming for serial communication
- Implement proper error handling for device connection issues
- Use a clear UI to show connection status and readings
- Provide feedback for successful/failed serial operations
