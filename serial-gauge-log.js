// serial-gauge-log.js
// Node.js script to read and parse digital dial gauge data from a serial port
// Usage: node serial-gauge-log.js /dev/ttyUSB0


const { SerialPort } = require('serialport');
const { Readline } = require('@serialport/parser-readline');

// Simple argument parser
function parseArgs() {
  const args = process.argv.slice(2);
  let port = null, count = 0, timeout = 0;
  for (let i = 0; i < args.length; ++i) {
    if (!port && !args[i].startsWith('--')) {
      port = args[i];
    } else if (args[i] === '--count') {
      count = parseInt(args[++i], 10);
    } else if (args[i] === '--timeout') {
      timeout = parseFloat(args[++i]);
    }
  }
  return { port, count, timeout };
}


const EXPECTED_DIGIT_LENGTH = 6; // adjust if your gauge sends a different length

function getGaugeValues({ portPath, count = 0, timeout = 0, logFunc } = {}) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: portPath,
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      autoOpen: true,
    });
    let serialBuffer = '';
    let pendingMinus = false;
    let collectedValues = [];
    let done = false;
    let timer = null;
    function logLine(msg) {
      if (logFunc) logFunc(msg);
      else {
        const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
        console.log(line);
      }
    }
    function parseGaugeData(data, opts = {}) {
      const {
        onValue,
        logRaw = logLine,
        logBin = logLine,
        logParsed = logLine,
        logInfo = logLine,
        logWarn = logLine,
        logError = logLine,
      } = opts;
      const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
      logBin(`[BIN] [${data.length} bytes] ${hex}`);
      const text = data.toString('latin1');
      logRaw(`[RAW] ${JSON.stringify(text)}`);
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '-') {
          pendingMinus = true;
          continue;
        }
        if (ch === '\r' || ch === '\n' || ch === '\u0012') {
          if (serialBuffer.length > 0) {
            if (serialBuffer.length === EXPECTED_DIGIT_LENGTH) {
              let numStr = serialBuffer.replace(/^0+/, '');
              if (numStr.length === 0) numStr = '0';
              if (numStr.length > 3) {
                numStr = numStr.slice(0, -3) + '.' + numStr.slice(-3);
              } else if (numStr.length === 3) {
                numStr = '0.' + numStr;
              } else if (numStr.length === 2) {
                numStr = '0.0' + numStr;
              } else if (numStr.length === 1) {
                numStr = '0.00' + numStr;
              }
              if (pendingMinus) {
                numStr = '-' + numStr;
              }
              const mmVal = parseFloat(numStr);
              if (!isNaN(mmVal)) {
                if (onValue) onValue(mmVal, numStr);
                logParsed(`[PARSED] ${numStr} mm`);
              } else {
                logWarn('[WARN] Could not parse buffered value: ' + JSON.stringify(serialBuffer));
              }
            } else {
              logInfo(`[INFO] Ignored buffer (unexpected length ${serialBuffer.length}): ${JSON.stringify(serialBuffer)}`);
            }
          }
          serialBuffer = '';
          pendingMinus = false;
        } else if (ch >= '0' && ch <= '9') {
          serialBuffer += ch;
        }
      }
    }
    port.on('open', () => {
      logLine('[STATUS] Connected to ' + portPath);
    });
    port.on('error', (err) => {
      logLine('[ERROR] ' + err.message);
      if (!done) {
        done = true;
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });
    port.on('data', (data) => {
      if (done) return;
      parseGaugeData(data, {
        onValue: (mmVal, numStr) => {
          collectedValues.push([mmVal, numStr]);
          logLine(`[VALUE] ${mmVal} mm`);
          if (count && collectedValues.length >= count) {
            logLine(`[DONE] Collected ${collectedValues.length} value(s). Exiting.`);
            done = true;
            if (timer) clearTimeout(timer);
            port.close(() => resolve(collectedValues));
          }
        },
      });
    });
    if (timeout > 0) {
      timer = setTimeout(() => {
        if (!done) {
          logLine(`[TIMEOUT] Timeout reached after ${timeout} seconds.`);
          done = true;
          port.close(() => resolve(collectedValues));
        }
      }, timeout * 1000);
    }
  });
}

// CLI entry point
if (require.main === module) {
  const { port, count: valueCount, timeout } = parseArgs();
  if (!port) {
    console.error('Usage: node serial-gauge-log.js <serial-port> [--count N] [--timeout SECONDS]');
    process.exit(1);
  }
  getGaugeValues({ portPath: port, count: valueCount, timeout })
    .then(values => {
      console.log(`[RESULT]`, JSON.stringify(values));
      process.exit(0);
    })
    .catch(err => {
      console.error('[ERROR]', err);
      process.exit(1);
    });
}
