# CI Presence Layer v1 — measurable acceptance contract

Status: implementation contract. No animation may run unless it corresponds to a real input or runtime state.

## 1. Invariants

1. Static Ci is allowed only in IDLE/HIDDEN.
2. Every non-idle state has a distinct motion signature.
3. Presence is a non-touchable full-screen overlay; only the 72 dp Ci hit target receives input.
4. Motion never blocks the underlying app.
5. Context scaffold is exactly three cells.
6. Left swipe reveals the three-cell scaffold immediately; content is optional and arrives separately from Ci.
7. Context cells have no fill and no closed outer frame. Their contour is strongest near Ci and fades to transparent away from Ci.
8. Dismiss/retract returns the scaffold to Ci as particles.
9. Runtime work must emit a presence state; visual state is telemetry, never a timer pretending that work exists.
10. After terminal RESULT/ERROR, Presence returns to IDLE.

## 2. Geometry and optical constants

| Metric | Value | Acceptance |
|---|---:|---|
| Ci visual/hit size | 72 dp | ±0 dp in layout |
| Edge inset | 18 dp | overlay center stays within safe inset while free |
| Hidden visible sliver | 12 dp | only when explicitly hidden |
| Context cell width | 176 dp | exactly |
| Context cell height | 72 dp | exactly |
| Context gap from Ci | 14 dp | exactly |
| Context vertical step | 78 dp | exactly |
| Context cells | 3 | never 2 or 4 |
| Context contour stroke | 1.25 dp | anti-aliased |
| Near-Ci contour alpha | 0.82 | ±0.05 |
| Far contour alpha | 0.00 | must fade before the remote edge closes |
| Content alpha | 0.88 | only when content exists |
| Passive logo alpha | 0.94 | normal idle |
| Idle-dim logo alpha | 0.62 | after 6 s with no interaction/work |
| Docked logo alpha | 0.72 | docked |
| Hidden logo alpha | 0.34 | hidden/sliver |
| Active logo alpha | 1.00 | all active states |
| Passive breath scale | 1.000 → 1.026 → 1.000 | 2.6% max |
| Passive breath period | 2600 ms | ±150 ms |
| Gesture trail lifetime | 420 ms | ±30 ms |
| Context reveal | 360 ms | ±30 ms |
| Context retract | 320 ms | ±30 ms |
| Result convergence | 520 ms | ±40 ms |
| Error disturbance | 360 ms | ±40 ms |
| Frame target | 60 fps where device permits | no allocations required per frame beyond Paths/Paints already held |

## 3. Color language

- GOLD = #D8B15A. Ci agency, lateral gesture, screen action, outgoing work.
- BLUE = #84D8FF. Upward gesture, listening/input, incoming/attention response.
- COOL_NEUTRAL = #AFC2D0. Down/collapse and non-semantic waiting support.
- No red alarm language in Presence v1.

Particles are always translucent. Peak particle alpha: 0.72. Typical: 0.18–0.58.

## 4. User input → visual response

| Input | Immediate visual | Semantic/result |
|---|---|---|
| ACTION_DOWN | 90 ms compression + local gold dust | contact acknowledged |
| single tap | gold inward pulse, then LISTENING if voice starts | activate Ci |
| double tap | current material retracts into Ci | zero/reset |
| long press | logo rises to scale 1.08, active gold micro-orbit | move mode |
| drag | logo follows finger; presence anchor follows exactly | reposition |
| drag release | spring settle; edge proximity may dock | position saved |
| swipe left | gold trail left + exactly 3 open cells formed from particles | materialize context |
| swipe right | gold trail right + existing cells retract | dismiss/forward/reset depending current command |
| swipe up | blue trail upward | upward/tools/newer semantic |
| swipe down | cool desaturated blue trail downward | collapse/older semantic |
| circular clockwise | gold orbit accelerates clockwise | next stage |
| circular counter-clockwise | blue-gold orbit counter-clockwise | previous state |

## 5. Runtime activity → visual response

| Runtime state | Motion signature |
|---|---|
| IDLE | only passive breathing; may idle-dim |
| LISTENING | blue breathing ring + small particles drawn toward Ci |
| THINKING | compact gold particles orbit and periodically converge |
| SEARCHING | gold particles propagate outward in scanning waves; return fragments in blue |
| CALCULATING | six ordered points rotate on a hexagonal ring; no random scatter |
| DELEGATING | one or more narrow gold streams leave Ci toward the screen perimeter |
| WAITING_EXTERNAL | slow stretched neutral/gold arc; movement continues but is restrained |
| SCREEN_ACTION | gold particle path from Ci to exact target x/y + target pulse |
| APP_OPENING | path to target/center followed by a low-alpha gold bloom on the newly opened surface |
| RESULT | outer particles converge back into Ci and stabilize |
| ERROR | rhythm is broken briefly; no red flash; returns to idle |
| RETRACTING | context contour dissolves and particles return to Ci |
| HIDDEN | no activity drawing; only 12 dp sliver if explicitly hidden |

## 6. Runtime telemetry contract

Presence accepts these exact state ids:
`idle`, `listening`, `thinking`, `searching`, `calculating`, `delegating`, `waiting_external`, `screen_action`, `app_opening`, `result`, `error`, `retracting`.

Android service action:
`ua.cimeika.ci.action.ACTIVITY`

Extras:
- `state` — one state id above.
- `target_x`, `target_y` — optional absolute screen pixels, required for screen_action.
- `duration_ms` — optional; terminal visual may use it but may not fabricate work after state ends.

Current local request lifecycle must emit:
- request starts → THINKING
- request is outstanding after short local preparation → WAITING_EXTERNAL
- response → RESULT
- failure → ERROR

SEARCHING/CALCULATING/DELEGATING are displayed only when the executing runtime explicitly emits those states.

## 7. Context scaffold acceptance

A left swipe passes only if:
1. gold dust visibly leaves Ci toward the left;
2. three and only three cells appear;
3. cells are present before network content returns;
4. cells contain no fabricated placeholder text;
5. right/near-Ci contour is strongest;
6. line fades to alpha 0 toward the far-left edge;
7. far edge is not closed;
8. if Ci returns content, labels appear inside the already-existing cells without adding filled cards;
9. dismissal dissolves the same contours and returns particles to Ci.

## 8. Interference / hiding

- Presence drawing window is FLAG_NOT_TOUCHABLE + FLAG_NOT_FOCUSABLE.
- User can keep interacting with YouTube or any foreground app through Presence.
- After 6 s of true IDLE the logo dims to alpha 0.62 without disappearing.
- Any touch, voice, runtime state, result or error restores active visibility immediately.
- Docked state reduces alpha to 0.72 and partially parks at the edge.
- Explicit HIDE leaves only 12 dp visible; it does not continue activity animation.
- Active work, listening, visible context, or screen action must never auto-dim.

## 9. Acceptance gates

P0-A Motion language: all input rows map to implemented effects.
P0-B Context scaffold: exact 3 open fading cells; no filled card backgrounds.
P0-C Telemetry truth: no SEARCH/CALCULATE/DELEGATE visual without a corresponding runtime event.
P0-D Cross-app overlay: service survives HOME and Settings/other foreground app, does not consume underlying touches.
P0-E Lifecycle: THINKING → WAITING_EXTERNAL → RESULT/ERROR → IDLE is observable in code/runtime.
P0-F Interference: idle-dim/dock/hide values match section 2.
P0-G Android build: lint + assembleDebug green.
P0-H Android 35 smoke: install, overlay service survives foreground-app change, no crash.
P0-I Audit: source-level acceptance script validates constants, exact cell count, telemetry ids and overlay flags.

Release is not accepted unless P0-A through P0-I all pass.
