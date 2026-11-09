# NodeMCU ESP8266 desk device

This sketch reads three two-terminal buttons (momentary or maintained ON/OFF switches) and controls two LEDs. Each button's debounced state change selects Available, Busy, or Away; the most recently clicked button overrides the previous selection, even if that switch remains latched ON. Away turns both LEDs off. The board exposes `GET http://<board-ip>/api/state` on the local Wi-Fi network. The website polls this endpoint and maps the selected faculty member's declaration to the live button state.

## Parts and wiring

Use a NodeMCU ESP8266 development board (not an ESP32). The two resistors are LED current limiters; button inputs use the ESP8266 internal pull-ups. Use red/green LEDs as available and busy (the UI's second LED is amber).

| Part lead | NodeMCU connection |
|---|---|
| Available button terminal 1 | D1 (GPIO5) |
| Available button terminal 2 | GND |
| Busy button terminal 1 | D2 (GPIO4) |
| Busy button terminal 2 | GND |
| Away button terminal 1 | D5 (GPIO14) |
| Away button terminal 2 | GND |
| Available LED anode (long leg) | D6 (GPIO12) through 220-470 Ω resistor |
| Available LED cathode (short leg) | GND |
| Busy LED anode (long leg) | D7 (GPIO13) through 220-470 Ω resistor |
| Busy LED cathode (short leg) | GND |

```text
NodeMCU D1 ───── [ Available button ] ───── GND
NodeMCU D2 ───── [ Busy button      ] ───── GND
NodeMCU D5 ───── [ Away button      ] ───── GND

NodeMCU D6 ──[220-470 Ω]───|>|─── GND   Available LED
NodeMCU D7 ──[220-470 Ω]───|>|─── GND   Busy LED
                             ↑
                         LED anode (+)
```

Each button is a simple contact across its two terminals; GPIO to GND is intentional because the sketch enables `INPUT_PULLUP`. Do not connect a GPIO directly to 3.3 V or 5 V. NodeMCU GPIO is 3.3 V only. Put one resistor in series with each LED. Power the board over USB.

## Upload and connect

1. In Arduino IDE, install the ESP8266 board package and select a NodeMCU 1.0 (ESP-12E Module) board and its serial port.
2. Edit `WIFI_SSID` and `WIFI_PASSWORD` in the sketch for a 2.4 GHz Wi-Fi network. The computer/phone showing the site and board must be on the same LAN; client isolation on guest Wi-Fi must be off.
3. Upload the sketch and open Serial Monitor at 115200 baud. Note the printed address, such as `http://192.168.1.50`.
4. Open the CampusPulse site over local HTTP (for development, run `pnpm dev -- --hostname 0.0.0.0` from `web`; then use `http://<computer-LAN-IP>:3000` on a device on the same Wi-Fi). In the desk panel, select the faculty record and enter the NodeMCU address. A live connection label confirms polling.
5. Press a button. The status, declaration time and LED update; disconnecting the board marks the record offline after polling fails.

The hosted static site is HTTPS; browsers commonly block its requests to a plain HTTP ESP8266 as mixed content. Use the local HTTP site for this direct-LAN prototype. To support an HTTPS public site and multiple devices, add a secure relay/backend. This demo keeps status in the current browser only; it does not publish campus-wide data. The ESP8266 HTTP endpoint is unauthenticated and intended only for a trusted prototype LAN.
