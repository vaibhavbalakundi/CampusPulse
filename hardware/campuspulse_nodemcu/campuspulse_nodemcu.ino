#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

// Change these to the 2.4 GHz Wi-Fi network used by the website's browser.
const char* WIFI_SSID = "PLACEMENT";
const char* WIFI_PASSWORD = "qwertyuiop";

ESP8266WebServer server(80);
const uint8_t BUTTON_AVAILABLE = D1;
const uint8_t BUTTON_BUSY = D2;
const uint8_t BUTTON_AWAY = D5;
const uint8_t LED_AVAILABLE = D6;
const uint8_t LED_BUSY = D7;

const uint32_t DEBOUNCE_MS = 35;
uint8_t statusCode = 2; // 0=available, 1=busy, 2=away
uint8_t lastRead[3] = {HIGH, HIGH, HIGH};
uint8_t stableRead[3] = {HIGH, HIGH, HIGH};
uint32_t changedAt[3] = {0, 0, 0};
const uint8_t buttonPins[3] = {BUTTON_AVAILABLE, BUTTON_BUSY, BUTTON_AWAY};

void setStatus(uint8_t next) {
  statusCode = next;
  digitalWrite(LED_AVAILABLE, next == 0 ? HIGH : LOW);
  digitalWrite(LED_BUSY, next == 1 ? HIGH : LOW);
}

void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Cache-Control", "no-store");
}

void handleOptions() {
  sendCors();
  server.send(204);
}

void handleState() {
  sendCors();
  String label = statusCode == 0 ? "AVAILABLE" : statusCode == 1 ? "BUSY" : "AWAY";
  String body = "{\"status\":\"" + label + "\",\"uptime\":" + String(millis()) + "}";
  server.send(200, "application/json", body);
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_AVAILABLE, INPUT_PULLUP);
  pinMode(BUTTON_BUSY, INPUT_PULLUP);
  pinMode(BUTTON_AWAY, INPUT_PULLUP);
  pinMode(LED_AVAILABLE, OUTPUT);
  pinMode(LED_BUSY, OUTPUT);
  setStatus(2);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print('.'); }
  Serial.println();
  Serial.print("NodeMCU address: http://"); Serial.println(WiFi.localIP());

  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/state", HTTP_OPTIONS, handleOptions);
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) { handleOptions(); return; }
    sendCors();
    server.send(404, "text/plain", "Use GET /api/state");
  });
  server.begin();
}

void loop() {
  server.handleClient();
  uint32_t now = millis();
  for (uint8_t i = 0; i < 3; i++) {
    uint8_t reading = digitalRead(buttonPins[i]);
    if (reading != lastRead[i]) { lastRead[i] = reading; changedAt[i] = now; }
    if ((uint32_t)(now - changedAt[i]) >= DEBOUNCE_MS && reading != stableRead[i]) {
      stableRead[i] = reading;
      // Treat either edge as a click so maintained ON/OFF switches work too.
      // A previous switch can stay latched; only the switch that just changed
      // selects a status, so it cannot reassert itself on later loop passes.
      setStatus(i);
      Serial.print("Button selected status: ");
      Serial.println(i == 0 ? "AVAILABLE" : i == 1 ? "BUSY" : "AWAY");
    }
  }
}
