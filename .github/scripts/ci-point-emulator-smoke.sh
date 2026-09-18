#!/usr/bin/env bash
set -euo pipefail

APK="android/ci-point/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="ua.cimeika.ci"
ACTIVITY="ua.cimeika.cipoint.MainActivity"

test -f "$APK"
adb install -r "$APK"
adb shell pm grant "$PACKAGE" android.permission.RECORD_AUDIO
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS || true
adb shell appops set "$PACKAGE" SYSTEM_ALERT_WINDOW allow
adb logcat -c

adb shell am start -W -n "$PACKAGE/$ACTIVITY"
sleep 5

PACKAGE_DUMP="$(adb shell dumpsys package "$PACKAGE")"
[[ "$PACKAGE_DUMP" == *"versionName=0.5.1"* ]]

SERVICE_DUMP="$(adb shell dumpsys activity services "$PACKAGE")"
[[ "$SERVICE_DUMP" == *"CiOverlayService"* ]]

PID="$(adb shell pidof "$PACKAGE" | tr -d '\r\n')"
test -n "$PID"

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
CRASH_BLOCK="$(printf '%s\n' "$LOGS" | grep -A8 'FATAL EXCEPTION' || true)"
if [[ "$CRASH_BLOCK" == *"Process: $PACKAGE"* ]]; then
  echo "Ci-Point crash detected"
  printf '%s\n' "$CRASH_BLOCK"
  exit 1
fi

echo "CI_POINT_ANDROID_SMOKE=PASS"
echo "CI_POINT_PID=$PID"
