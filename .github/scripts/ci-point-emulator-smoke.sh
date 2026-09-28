#!/usr/bin/env bash
set -euo pipefail

APK="android/ci-point/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="ua.cimeika.ci"
ACTIVITY="ua.cimeika.cipoint.MainActivity"
EXPECTED_VERSION="0.6.0"

test -f "$APK"
adb install -r "$APK"
adb shell pm grant "$PACKAGE" android.permission.RECORD_AUDIO
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS
adb shell appops set "$PACKAGE" SYSTEM_ALERT_WINDOW allow
adb logcat -c

adb shell am start -W -n "$PACKAGE/$ACTIVITY"

PACKAGE_DUMP="$(adb shell dumpsys package "$PACKAGE")"
[[ "$PACKAGE_DUMP" == *"versionName=$EXPECTED_VERSION"* ]]

SERVICE_READY=0
for _ in $(seq 1 20); do
  SERVICE_DUMP="$(adb shell dumpsys activity services "$PACKAGE")"
  if [[ "$SERVICE_DUMP" == *"CiOverlayService"* ]]; then
    SERVICE_READY=1
    break
  fi
  sleep 1
done
if [[ "$SERVICE_READY" -ne 1 ]]; then
  echo "CiOverlayService did not become ready"
  exit 1
fi

PID="$(adb shell pidof "$PACKAGE" | tr -d '\r\n')"
test -n "$PID"

# Exercise the real overlay hit target. Fresh-install position is 72% x / 62% y.
DIMS="$(adb shell wm size | tail -n1 | tr -d '\r' | sed -E 's/.*: ([0-9]+x[0-9]+).*/\1/')"
WIDTH="${DIMS%x*}"
HEIGHT="${DIMS#*x}"
CI_X=$((WIDTH * 72 / 100))
CI_Y=$((HEIGHT * 62 / 100))
adb shell input swipe "$CI_X" "$CI_Y" "$((CI_X - 260))" "$CI_Y" 220
sleep 1
adb shell input swipe "$CI_X" "$CI_Y" "$CI_X" "$((CI_Y - 260))" 220
sleep 1

# Drive telemetry states through the exported debug Activity; it forwards internally
# to the non-exported foreground service.
for STATE in thinking searching calculating delegating waiting_external result error; do
  adb shell am start -W -n "$PACKAGE/$ACTIVITY" --es ci_presence_state "$STATE" >/dev/null
  sleep 0.15
done
adb shell am start -W -n "$PACKAGE/$ACTIVITY" \
  --es ci_presence_state screen_action --ef target_x 420 --ef target_y 640 >/dev/null
sleep 0.4

PRESENCE_LOGS="$(adb logcat -d -v brief | grep 'CiPresence' || true)"
[[ "$PRESENCE_LOGS" == *"gesture=left scaffold=true"* ]]
[[ "$PRESENCE_LOGS" == *"gesture=up"* ]]
for EXPECTED in thinking searching calculating delegating waiting_external result error screen_action; do
  [[ "$PRESENCE_LOGS" == *"state=$EXPECTED"* ]]
done

adb shell input keyevent KEYCODE_HOME
sleep 2
SERVICE_DUMP="$(adb shell dumpsys activity services "$PACKAGE")"
[[ "$SERVICE_DUMP" == *"CiOverlayService"* ]]

adb shell am start -W -a android.settings.SETTINGS
sleep 2
ACTIVITY_DUMP="$(adb shell dumpsys activity activities)"
if [[ "$ACTIVITY_DUMP" != *"com.android.settings"* ]]; then
  echo "Settings did not become foreground"
  exit 1
fi

SERVICE_DUMP="$(adb shell dumpsys activity services "$PACKAGE")"
[[ "$SERVICE_DUMP" == *"CiOverlayService"* ]]
PID="$(adb shell pidof "$PACKAGE" | tr -d '\r\n')"
test -n "$PID"

LOGS="$(adb logcat -d -v brief)"
CRASH_BLOCK="$(printf '%s\n' "$LOGS" | grep -A12 'FATAL EXCEPTION' || true)"
if [[ "$CRASH_BLOCK" == *"Process: $PACKAGE"* ]]; then
  echo "Ci-Point crash detected"
  printf '%s\n' "$CRASH_BLOCK"
  exit 1
fi

echo "CI_POINT_ANDROID_SMOKE=PASS"
echo "CI_POINT_VERSION=$EXPECTED_VERSION"
echo "CI_POINT_PID=$PID"
echo "CI_PRESENCE_GESTURES=PASS"
echo "CI_PRESENCE_TELEMETRY=PASS"
