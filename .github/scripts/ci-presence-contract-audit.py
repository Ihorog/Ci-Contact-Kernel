#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
JAVA = ROOT / "android/ci-point/app/src/main/java/ua/cimeika/cipoint"

errors = []

def need(text, token, label):
    if token not in text:
        errors.append(f"MISSING {label}: {token}")

def forbid(text, token, label):
    if token in text:
        errors.append(f"FORBIDDEN {label}: {token}")

spec = (JAVA / "CiPresenceSpec.java").read_text(encoding="utf-8")
view = (JAVA / "CiPresenceView.java").read_text(encoding="utf-8")
service = (JAVA / "CiOverlayService.java").read_text(encoding="utf-8")
halo = (JAVA / "CiContextHalo.java").read_text(encoding="utf-8")
client = (JAVA / "CiContextClient.java").read_text(encoding="utf-8")
build = (ROOT / "android/ci-point/app/build.gradle").read_text(encoding="utf-8")
workflow = (ROOT / ".github/workflows/ci-point-android.yml").read_text(encoding="utf-8")
smoke = (ROOT / ".github/scripts/ci-point-emulator-smoke.sh").read_text(encoding="utf-8")
docs = (ROOT / "docs/CI_PRESENCE_LAYER_V1.md").read_text(encoding="utf-8")

checks = {
    "LOGO_DP = 72": spec,
    "EDGE_INSET_DP = 18": spec,
    "HIDDEN_VISIBLE_DP = 12": spec,
    "CONTEXT_CELL_COUNT = 3": spec,
    "CONTEXT_CELL_WIDTH_DP = 176": spec,
    "CONTEXT_CELL_HEIGHT_DP = 72": spec,
    "CONTEXT_GAP_DP = 14": spec,
    "CONTEXT_ARC_STEP_DP = 78": spec,
    "CONTEXT_NEAR_ALPHA = 0.82f": spec,
    "PASSIVE_ALPHA = 0.94f": spec,
    "IDLE_DIM_ALPHA = 0.62f": spec,
    "DOCKED_ALPHA = 0.72f": spec,
    "HIDDEN_ALPHA = 0.34f": spec,
    "PASSIVE_BREATH_SCALE = 1.026f": spec,
    "PRESENCE_WINDOW_ALPHA = 0.78f": spec,
    "IDLE_DIM_DELAY_MS = 6000L": spec,
    "GESTURE_TRAIL_MS = 420L": spec,
    "CONTEXT_REVEAL_MS = 360L": spec,
    "CONTEXT_RETRACT_MS = 320L": spec,
    "RESULT_CONVERGE_MS = 520L": spec,
    "ERROR_MS = 360L": spec,
    "GOLD = Color.rgb(0xD8, 0xB1, 0x5A)": spec,
    "BLUE = Color.rgb(0x84, 0xD8, 0xFF)": spec,
    "COOL_NEUTRAL = Color.rgb(0xAF, 0xC2, 0xD0)": spec,
}
for token, text in checks.items():
    need(text, token, "measurable spec")

for state in (
    "IDLE", "LISTENING", "THINKING", "SEARCHING", "CALCULATING",
    "DELEGATING", "WAITING_EXTERNAL", "SCREEN_ACTION", "APP_OPENING",
    "RESULT", "ERROR", "RETRACTING", "HIDDEN"
):
    need(spec, state, f"presence state {state}")

need(view, "i < CiPresenceSpec.CONTEXT_CELL_COUNT", "exact three-cell loop")
need(view, 'if ("left".equals(gestureDirection))', "left swipe scaffold")
need(view, "showContextScaffold();", "scaffold materialization")
need(view, "drawTravelParticles(", "particle transport")
need(view, "drawCircularGesture(canvas, now)", "circular gesture draw pass")
need(view, "if (moveMode) drawMoveMode(canvas, now)", "move mode draw pass")
need(view, "if (circularStartedAt > 0L) return true", "circular frame scheduling")
need(view, "if (moveMode) return true", "move frame scheduling")
need(view, "boolean opensLeft =", "bounded/mirrored scaffold geometry")
need(view, "getWidth() - cellW - edge", "horizontal scaffold clamp")
need(view, "getHeight() - cellH - edge", "vertical scaffold clamp")
need(view, "nearX,\n                            midY,\n                            logoCx", "reverse particle retraction")
need(view, "CiPresenceSpec.GOLD", "gold lateral/action language")
need(view, "CiPresenceSpec.BLUE", "blue upward/listening language")
for method in (
    "drawListening", "drawThinking", "drawSearching", "drawCalculating",
    "drawDelegating", "drawWaiting", "drawTargetAction", "drawResult", "drawError"
):
    need(view, method, f"activity renderer {method}")

need(service, "ACTION_CI_ACTIVITY", "runtime activity input")
need(service, "FLAG_NOT_TOUCHABLE", "non-interference overlay")
need(service, "FLAG_NOT_FOCUSABLE", "non-focus overlay")
need(service, "presenceParams.alpha = CiPresenceSpec.PRESENCE_WINDOW_ALPHA", "bounded Presence window opacity")
need(service, "presenceView.swipe(direction)", "gesture to presence")
need(service, "presenceView.circularGesture(clockwise)", "circular gesture presence")
need(service, "CiPresenceSpec.Activity.THINKING", "thinking lifecycle")
need(service, "CiPresenceSpec.Activity.WAITING_EXTERNAL", "external wait lifecycle")
need(service, "CiPresenceSpec.Activity.RESULT", "result lifecycle")
need(service, "CiPresenceSpec.Activity.ERROR", "error lifecycle")
need(service, "showScreenAction(x, y)", "screen target telemetry")
need(service, "showAppOpening(x, y)", "app opening telemetry")
need(service, "scheduleIdleDim()", "idle dim lifecycle")
need(service, "idleDimmed = true", "stable idle dim state")
need(service, "cancelPassiveBreath();", "idle dim stops passive breath")
need(service, "restoreFromIdleDim()", "interaction restores passive state")

need(halo, "setBackgroundColor(Color.TRANSPARENT)", "frameless context content")
forbid(halo, "CiHexagonDrawable", "filled/closed legacy context card")
forbid(halo, "backgroundFor(", "legacy context background")

need(client, '"ci-android-empty-context"', "empty context fallback")
forbid(client, '"Ймовірно: продовжити"', "fabricated placeholder context")
need(build, "versionName '0.6.0'", "0.6.0 version")
need(workflow, "delivery/Ci-Point-v0.6.0.apk", "0.6.0 release asset")
need(smoke, "CI_PRESENCE_TOUCH_THROUGH=PASS", "Android foreground touch-through smoke")
forbid(workflow, "delivery/Ci-Point-v0.5.3.apk", "stale release asset")
if workflow.count(".github/scripts/ci-presence-contract-audit.py") < 2:
    errors.append("MISSING Presence audit path coverage for both PR and main push")
if workflow.count("docs/CI_PRESENCE_LAYER_V1.md") < 2:
    errors.append("MISSING Presence contract path coverage for both PR and main push")

for phrase in (
    "Static Ci is allowed only in IDLE/HIDDEN",
    "Context scaffold is exactly three cells",
    "Presence drawing window is FLAG_NOT_TOUCHABLE + FLAG_NOT_FOCUSABLE",
    "Release is not accepted unless P0-A through P0-I all pass",
    "passive breathing stops so the dim level remains stable",
    "mirrors to the free side only when there is insufficient left clearance",
    "uses window alpha 0.78",
):
    need(docs, phrase, "acceptance contract")

# Open remote edge: no closed-path implementation is allowed in the Presence renderer.
forbid(view, ".close()", "closed context geometry")

if errors:
    print("CI_PRESENCE_CONTRACT=FAIL")
    for error in errors:
        print(error)
    sys.exit(1)

print("CI_PRESENCE_CONTRACT=PASS")
print("CI_PRESENCE_VERSION=0.6.0")
print("CI_PRESENCE_CELLS=3")
print("CI_PRESENCE_NON_INTERFERENCE=PASS")
