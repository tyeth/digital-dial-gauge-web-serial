# Digital Dial Gauge Serial Logger

This project provides scripts for reading and parsing digital dial gauge data from a serial port, in both Python and Node.js. It is useful for logging, automation, and integration with other tools.

There is also a web-serial version (no installation - only a Chrome based browser needed):
### [https://tyeth.github.io/digital-dial-gauge-web-serial/](https://tyeth.github.io/digital-dial-gauge-web-serial/)

## Features
- Reads data from a digital dial gauge via serial port
- Parses and logs values in millimeters
- Supports reading a single value, multiple values, or continuous logging
- Timeout option to avoid waiting forever
- Usable as a CLI tool or as an importable module (Python and Node.js)

---

## Python Usage

### As a CLI tool
```bash
python3 serial-gauge-log.py /dev/ttyUSB0 --count 5 --timeout 3
```
- `--count N`: Number of values to read before exiting (0 = infinite)
- `--timeout SECONDS`: Timeout in seconds (0 = no timeout)

**Example output:**
```
[RESULT] [(12.345, '12.345'), (12.346, '12.346'), ...]
```

### As a module
```python
from serial_gauge_log import get_gauge_values
values = get_gauge_values('/dev/ttyUSB0', count=5, timeout=3)
print(values)
```

---

## Node.js Usage

### As a CLI tool
```bash
node serial-gauge-log.js /dev/ttyUSB0 --count 5 --timeout 3
```
- `--count N`: Number of values to read before exiting (0 = infinite)
- `--timeout SECONDS`: Timeout in seconds (0 = no timeout)

**Example output:**
```
[RESULT] [[12.345,"12.345"], [12.346,"12.346"], ...]
```

### As a module
```js
const { getGaugeValues } = require('./serial-gauge-log.js');
getGaugeValues({ portPath: '/dev/ttyUSB0', count: 5, timeout: 3 }).then(values => {
  console.log(values);
});
```

---

## Requirements
- Python 3 with `pyserial` (`pip install pyserial`)
- Node.js with `serialport` (`npm install serialport`)

---

## Notes
- Adjust `EXPECTED_DIGIT_LENGTH` in the scripts if your gauge sends a different number of digits.
- Both scripts log raw and parsed data for debugging.
- The scripts are designed for easy extension and integration.

---

## License
MIT License
