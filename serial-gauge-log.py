# serial_gauge_log.py
# Python script to read and parse digital dial gauge data from a serial port
# Usage: python3 serial_gauge_log.py /dev/ttyUSB0


import sys
import serial
import time
import argparse


parser = argparse.ArgumentParser(description='Read and parse digital dial gauge data from a serial port')
parser.add_argument('port', help='Serial port path, e.g. /dev/ttyUSB0')
parser.add_argument('--count', type=int, default=0, help='Number of values to read before exiting (0 = infinite)')
parser.add_argument('--timeout', type=float, default=0, help='Timeout in seconds to wait for values (0 = no timeout)')
args = parser.parse_args()

port_path = args.port
EXPECTED_DIGIT_LENGTH = 6  # adjust if your gauge sends a different length

ser = serial.Serial(
    port=port_path,
    baudrate=9600,
    bytesize=serial.EIGHTBITS,
    stopbits=serial.STOPBITS_ONE,
    parity=serial.PARITY_NONE,
    timeout=1
)

serial_buffer = ''
pending_minus = False
collected_values = []

def default_log_line(msg):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line)

def parse_gauge_data(
    data,
    on_value=None,
    log_raw=None,
    log_bin=None,
    log_parsed=None,
    log_info=None,
    log_warn=None,
    log_error=None
):
    global serial_buffer, pending_minus
    log_raw = log_raw or default_log_line
    log_bin = log_bin or default_log_line
    log_parsed = log_parsed or default_log_line
    log_info = log_info or default_log_line
    log_warn = log_warn or default_log_line
    log_error = log_error or default_log_line

    # Log raw binary as hex
    hexstr = ' '.join(f'{b:02x}' for b in data)
    log_bin(f"[BIN] [{len(data)} bytes] {hexstr}")
    text = data.decode('latin1', errors='replace')
    log_raw(f"[RAW] {repr(text)}")
    for ch in text:
        if ch == '-':
            pending_minus = True
            continue
        if ch in ('\r', '\n', '\u0012'):
            if serial_buffer:
                if len(serial_buffer) == EXPECTED_DIGIT_LENGTH:
                    num_str = serial_buffer.lstrip('0') or '0'
                    if len(num_str) > 3:
                        num_str = num_str[:-3] + '.' + num_str[-3:]
                    elif len(num_str) == 3:
                        num_str = '0.' + num_str
                    elif len(num_str) == 2:
                        num_str = '0.0' + num_str
                    elif len(num_str) == 1:
                        num_str = '0.00' + num_str
                    if pending_minus:
                        num_str = '-' + num_str
                    try:
                        mm_val = float(num_str)
                        if on_value:
                            on_value(mm_val, num_str)
                        log_parsed(f"[PARSED] {num_str} mm")
                    except Exception:
                        log_warn(f"[WARN] Could not parse buffered value: {repr(serial_buffer)}")
                else:
                    log_info(f"[INFO] Ignored buffer (unexpected length {len(serial_buffer)}): {repr(serial_buffer)}")
            serial_buffer = ''
            pending_minus = False
        elif '0' <= ch <= '9':
            serial_buffer += ch

def on_value_callback(mm_val, num_str):
    collected_values.append((mm_val, num_str))
    print(f"[VALUE] {mm_val} mm")

def main():
    default_log_line(f"[STATUS] Connected to {port_path}")
    start_time = time.time()
    try:
        while True:
            if args.timeout and (time.time() - start_time) > args.timeout:
                default_log_line(f"[TIMEOUT] Timeout reached after {args.timeout} seconds.")
                break
            data = ser.read(ser.in_waiting or 1)
            if not data:
                time.sleep(0.01)
                continue
            parse_gauge_data(
                data,
                on_value=on_value_callback,
            )
            if args.count and len(collected_values) >= args.count:
                default_log_line(f"[DONE] Collected {len(collected_values)} value(s). Exiting.")
                break
    except KeyboardInterrupt:
        default_log_line('[STATUS] Disconnected')
    finally:
        ser.close()

if __name__ == '__main__':
    main()