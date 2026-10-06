#!/usr/bin/env bash
set -euo pipefail

APK="${CI_POINT_APK:-android/ci-point/app/build/outputs/apk/release/app-release.apk}"
PACKAGE="ua.cimeika.ci"
ACTIVITY="ua.cimeika.cipoint.MainActivity"
EXPECTED_VERSION="${CI_POINT_VERSION:-0.7.0}"

test -f "$APK"
adb install -r "$APK"
adb shell pm grant "$PACKAGE" android.permission.RECORD_AUDIO
adb shell pm grant "$PACKAGE" android.permission.POST_NOTIFICATIONS
adb shell appops set "$PACKAGE" SYSTEM_ALERT_WINDOW allow
adb logcat -c

adb shell am start -W -n "$PACKAGE/$ACTIVITY"

PACKAGE_DUMP="$(adb shell dumpsys package "$PACKAGE")"
[[ "$PACKAGE_DUMP" == *"versionName=$EXPECTED_VERSION"* ]]
if [[ "$PACKAGE_DUMP" == *"DEBUGGABLE"* ]]; then
  echo "Ci Point hardened build is unexpectedly debuggable"
  exit 1
fi

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
echo "CI_POINT_APK=$APK"
echo "CI_POINT_PID=$PID"
