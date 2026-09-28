package ua.cimeika.cipoint;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.os.SystemClock;
import android.view.View;

final class CiPresenceView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF oval = new RectF();

    private int anchorX;
    private int anchorY;
    private int anchorSize;

    private CiPresenceSpec.Activity activity = CiPresenceSpec.Activity.IDLE;
    private long activityStartedAt;
    private long activityDurationMs;

    private String gestureDirection = "";
    private long gestureStartedAt;

    private boolean contextVisible;
    private boolean contextRetracting;
    private long contextTransitionAt;

    private boolean hasTarget;
    private float targetX;
    private float targetY;

    private boolean moveMode;
    private long circularStartedAt;
    private boolean circularClockwise;

    CiPresenceView(Context context) {
        super(context);
        setBackgroundColor(android.graphics.Color.TRANSPARENT);
        setWillNotDraw(false);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
    }

    void setAnchor(int x, int y, int size) {
        anchorX = x;
        anchorY = y;
        anchorSize = size;
        invalidateFrame();
    }

    void acknowledgeTouch() {
        setActivity(CiPresenceSpec.Activity.TOUCH, 240L);
    }

    void swipe(String direction) {
        gestureDirection = direction == null ? "" : direction;
        gestureStartedAt = SystemClock.uptimeMillis();
        if ("left".equals(gestureDirection)) {
            showContextScaffold();
        } else if ("right".equals(gestureDirection) && contextVisible) {
            retractContext();
        }
        invalidateFrame();
    }

    void setMoveMode(boolean enabled) {
        moveMode = enabled;
        invalidateFrame();
    }

    void circularGesture(boolean clockwise) {
        circularClockwise = clockwise;
        circularStartedAt = SystemClock.uptimeMillis();
        invalidateFrame();
    }

    void showContextScaffold() {
        contextVisible = true;
        contextRetracting = false;
        contextTransitionAt = SystemClock.uptimeMillis();
        invalidateFrame();
    }

    void retractContext() {
        if (!contextVisible && contextTransitionAt == 0L) return;
        contextVisible = true;
        contextRetracting = true;
        contextTransitionAt = SystemClock.uptimeMillis();
        setActivity(CiPresenceSpec.Activity.RETRACTING, CiPresenceSpec.CONTEXT_RETRACT_MS);
    }

    boolean isContextScaffoldVisible() {
        return contextVisible;
    }

    void setActivity(CiPresenceSpec.Activity next) {
        setActivity(next, defaultDuration(next));
    }

    void setActivity(CiPresenceSpec.Activity next, long durationMs) {
        activity = next == null ? CiPresenceSpec.Activity.IDLE : next;
        activityStartedAt = SystemClock.uptimeMillis();
        activityDurationMs = Math.max(0L, durationMs);
        if (activity == CiPresenceSpec.Activity.HIDDEN) {
            contextVisible = false;
            contextRetracting = false;
            contextTransitionAt = 0L;
            gestureStartedAt = 0L;
            circularStartedAt = 0L;
            moveMode = false;
        }
        if (activity != CiPresenceSpec.Activity.SCREEN_ACTION
                && activity != CiPresenceSpec.Activity.APP_OPENING) {
            hasTarget = false;
        }
        invalidateFrame();
    }

    void showScreenAction(float x, float y) {
        targetX = x;
        targetY = y;
        hasTarget = true;
        setActivity(CiPresenceSpec.Activity.SCREEN_ACTION, 720L);
    }

    void showAppOpening(float x, float y) {
        targetX = x;
        targetY = y;
        hasTarget = true;
        setActivity(CiPresenceSpec.Activity.APP_OPENING, 900L);
    }

    CiPresenceSpec.Activity activity() {
        return activity;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        long now = SystemClock.uptimeMillis();

        if (activity == CiPresenceSpec.Activity.HIDDEN) return;

        drawContextScaffold(canvas, now);
        drawGestureTrail(canvas, now);
        drawActivity(canvas, now);

        if (needsNextFrame(now)) {
            postInvalidateOnAnimation();
        }
    }

    private void drawContextScaffold(Canvas canvas, long now) {
        float progress = contextProgress(now);
        if (progress <= 0f) return;

        int cellW = dp(CiPresenceSpec.CONTEXT_CELL_WIDTH_DP);
        int cellH = dp(CiPresenceSpec.CONTEXT_CELL_HEIGHT_DP);
        int gap = dp(CiPresenceSpec.CONTEXT_GAP_DP);
        int step = dp(CiPresenceSpec.CONTEXT_ARC_STEP_DP);
        int inset = Math.max(8, Math.round(cellH * 0.23f));

        float baseAlpha = CiPresenceSpec.CONTEXT_NEAR_ALPHA * progress;
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(CiPresenceSpec.CONTEXT_STROKE_DP));

        float logoCx = anchorX + anchorSize / 2f;
        float logoCy = anchorY + anchorSize / 2f;

        for (int i = 0; i < CiPresenceSpec.CONTEXT_CELL_COUNT; i++) {
            float left = anchorX - cellW - gap - (i == 1 ? dp(10) : 0);
            float top = logoCy - cellH / 2f + (i - 1) * step;
            float right = left + cellW;
            float bottom = top + cellH;
            float midY = (top + bottom) * 0.5f;

            // Strong near Ci (right); intentionally open/faded on the remote left.
            drawFadingLine(canvas, right, midY, right - inset, top, baseAlpha, 1f, 0.88f);
            drawFadingLine(canvas, right - inset, top, left + inset * 0.75f, top, baseAlpha, 0.88f, 0.02f);
            drawFadingLine(canvas, right, midY, right - inset, bottom, baseAlpha, 1f, 0.88f);
            drawFadingLine(canvas, right - inset, bottom, left + inset * 0.75f, bottom, baseAlpha, 0.88f, 0.02f);

            // Matter visibly travels from Ci into the scaffold while it materializes/retracts.
            if (contextTransitionAt > 0L) {
                float travel = contextRetracting ? 1f - progress : progress;
                if (contextRetracting) {
                    drawTravelParticles(
                            canvas,
                            right,
                            midY,
                            logoCx,
                            logoCy,
                            travel,
                            CiPresenceSpec.GOLD,
                            0.64f * Math.max(0.22f, progress),
                            9 + i * 2
                    );
                } else {
                    drawTravelParticles(
                            canvas,
                            logoCx,
                            logoCy,
                            right,
                            midY,
                            travel,
                            CiPresenceSpec.GOLD,
                            0.64f * progress,
                            9 + i * 2
                    );
                }
            }
        }
        paint.setStyle(Paint.Style.FILL);
    }

    private float contextProgress(long now) {
        if (contextTransitionAt == 0L) return contextVisible ? 1f : 0f;
        long duration = contextRetracting
                ? CiPresenceSpec.CONTEXT_RETRACT_MS
                : CiPresenceSpec.CONTEXT_REVEAL_MS;
        float t = clamp01((now - contextTransitionAt) / (float) duration);
        if (t >= 1f) {
            contextTransitionAt = 0L;
            if (contextRetracting) {
                contextRetracting = false;
                contextVisible = false;
                if (activity == CiPresenceSpec.Activity.RETRACTING) {
                    activity = CiPresenceSpec.Activity.IDLE;
                    activityStartedAt = now;
                    activityDurationMs = 0L;
                }
                return 0f;
            }
            return 1f;
        }
        float eased = easeOutCubic(t);
        return contextRetracting ? 1f - eased : eased;
    }

    private void drawGestureTrail(Canvas canvas, long now) {
        if (gestureStartedAt == 0L) return;
        float p = (now - gestureStartedAt) / (float) CiPresenceSpec.GESTURE_TRAIL_MS;
        if (p >= 1f) {
            gestureStartedAt = 0L;
            gestureDirection = "";
            return;
        }

        float dx = 0f;
        float dy = 0f;
        int color = CiPresenceSpec.GOLD;
        if ("left".equals(gestureDirection)) dx = -1f;
        else if ("right".equals(gestureDirection)) dx = 1f;
        else if ("up".equals(gestureDirection)) {
            dy = -1f;
            color = CiPresenceSpec.BLUE;
        } else if ("down".equals(gestureDirection)) {
            dy = 1f;
            color = blend(CiPresenceSpec.BLUE, CiPresenceSpec.COOL_NEUTRAL, 0.58f);
        } else {
            return;
        }

        float cx = anchorX + anchorSize / 2f;
        float cy = anchorY + anchorSize / 2f;
        float max = dp(112);
        int count = 22;
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < count; i++) {
            float q = i / (float) (count - 1);
            float along = clamp01(p * 1.34f - q * 0.42f);
            if (along <= 0f) continue;
            float dist = max * (0.08f + 0.92f * along);
            float wobble = (float) Math.sin(i * 1.77 + p * 6.0) * dp(4) * (0.25f + q);
            float x = cx + dx * dist + (-dy) * wobble;
            float y = cy + dy * dist + dx * wobble;
            float alpha = 0.72f * (1f - p) * (0.35f + 0.65f * (1f - q));
            setPaintColor(color, alpha);
            canvas.drawCircle(x, y, dp(1) + dp(2) * (1f - q), paint);
        }
    }

    private void drawCircularGesture(Canvas canvas, long now) {
        if (circularStartedAt == 0L) return;
        float p = (now - circularStartedAt) / 620f;
        if (p >= 1f) {
            circularStartedAt = 0L;
            return;
        }
        float cx = anchorX + anchorSize / 2f;
        float cy = anchorY + anchorSize / 2f;
        float radius = dp(34) + dp(8) * easeOutCubic(p);
        float direction = circularClockwise ? 1f : -1f;
        int count = 16;
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < count; i++) {
            float q = i / (float) count;
            double angle = direction * (p * Math.PI * 3.2 + q * Math.PI * 2);
            int color = circularClockwise || i % 3 != 0
                    ? CiPresenceSpec.GOLD
                    : CiPresenceSpec.BLUE;
            setPaintColor(color, 0.62f * (1f - p) * (0.45f + 0.55f * q));
            canvas.drawCircle(
                    cx + (float)Math.cos(angle) * radius,
                    cy + (float)Math.sin(angle) * radius,
                    dpf(1.4f + (i % 2) * 0.45f),
                    paint
            );
        }
    }

    private void drawMoveMode(Canvas canvas, long now) {
        float cx = anchorX + anchorSize / 2f;
        float cy = anchorY + anchorSize / 2f;
        float phase = (now % 1700L) / 1700f;
        drawOrbitParticles(canvas, cx, cy, dp(30), phase, CiPresenceSpec.GOLD, 8, 0.38f);
    }

    private void drawActivity(Canvas canvas, long now) {
        float cx = anchorX + anchorSize / 2f;
        float cy = anchorY + anchorSize / 2f;
        float elapsed = now - activityStartedAt;
        float phase = (elapsed % 2200L) / 2200f;

        switch (activity) {
            case TOUCH:
                drawTouch(canvas, cx, cy, elapsed);
                break;
            case LISTENING:
                drawListening(canvas, cx, cy, phase);
                break;
            case THINKING:
                drawThinking(canvas, cx, cy, phase);
                break;
            case SEARCHING:
                drawSearching(canvas, cx, cy, phase);
                break;
            case CALCULATING:
                drawCalculating(canvas, cx, cy, phase);
                break;
            case DELEGATING:
                drawDelegating(canvas, cx, cy, phase);
                break;
            case WAITING_EXTERNAL:
                drawWaiting(canvas, cx, cy, phase);
                break;
            case SCREEN_ACTION:
                drawTargetAction(canvas, cx, cy, elapsed, false);
                break;
            case APP_OPENING:
                drawTargetAction(canvas, cx, cy, elapsed, true);
                break;
            case RESULT:
                drawResult(canvas, cx, cy, elapsed);
                break;
            case ERROR:
                drawError(canvas, cx, cy, elapsed);
                break;
            case RETRACTING:
            case HIDDEN:
            case IDLE:
            default:
                break;
        }

        if (activityDurationMs > 0L && elapsed >= activityDurationMs
                && activity != CiPresenceSpec.Activity.RETRACTING) {
            activity = CiPresenceSpec.Activity.IDLE;
            activityStartedAt = now;
            activityDurationMs = 0L;
            hasTarget = false;
        }
    }

    private void drawTouch(Canvas canvas, float cx, float cy, float elapsed) {
        float t = clamp01(elapsed / 240f);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.2f));
        setPaintColor(CiPresenceSpec.GOLD, 0.55f * (1f - t));
        float r = dp(18) + dp(18) * t;
        canvas.drawCircle(cx, cy, r, paint);
        paint.setStyle(Paint.Style.FILL);
        drawOrbitParticles(canvas, cx, cy, dp(22), t, CiPresenceSpec.GOLD, 8, 0.52f * (1f - t));
    }

    private void drawListening(Canvas canvas, float cx, float cy, float phase) {
        float pulse = 0.5f + 0.5f * (float) Math.sin(phase * Math.PI * 2);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.35f));
        setPaintColor(CiPresenceSpec.BLUE, 0.28f + pulse * 0.28f);
        canvas.drawCircle(cx, cy, dp(28) + dp(4) * pulse, paint);
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < 10; i++) {
            double a = i * Math.PI * 2 / 10.0 + phase * 0.9;
            float outer = dp(46);
            float inner = dp(25);
            float t = (phase + i / 10f) % 1f;
            float r = outer - (outer - inner) * t;
            setPaintColor(CiPresenceSpec.BLUE, 0.18f + 0.42f * t);
            canvas.drawCircle(
                    cx + (float) Math.cos(a) * r,
                    cy + (float) Math.sin(a) * r,
                    dpf(1.5f),
                    paint
            );
        }
    }

    private void drawThinking(Canvas canvas, float cx, float cy, float phase) {
        float convergence = 0.55f + 0.45f * (float) Math.sin(phase * Math.PI * 2);
        float radius = dp(31) - dp(7) * convergence;
        drawOrbitParticles(canvas, cx, cy, radius, phase * 1.25f, CiPresenceSpec.GOLD, 12, 0.58f);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.0f));
        setPaintColor(CiPresenceSpec.GOLD, 0.16f + 0.16f * convergence);
        canvas.drawCircle(cx, cy, dp(21) + dp(3) * convergence, paint);
    }

    private void drawSearching(Canvas canvas, float cx, float cy, float phase) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.0f));
        for (int ring = 0; ring < 3; ring++) {
            float t = (phase + ring / 3f) % 1f;
            float r = dp(24) + dp(78) * t;
            setPaintColor(CiPresenceSpec.GOLD, 0.38f * (1f - t));
            canvas.drawCircle(cx, cy, r, paint);
        }
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < 14; i++) {
            float t = (phase + i / 14f) % 1f;
            double a = i * 2.399963 + phase * 0.8;
            float r = dp(25) + dp(72) * t;
            int c = t > 0.72f ? CiPresenceSpec.BLUE : CiPresenceSpec.GOLD;
            setPaintColor(c, 0.18f + 0.42f * (1f - t));
            canvas.drawCircle(cx + (float)Math.cos(a)*r, cy + (float)Math.sin(a)*r, dpf(1.4f), paint);
        }
    }

    private void drawCalculating(Canvas canvas, float cx, float cy, float phase) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.0f));
        setPaintColor(CiPresenceSpec.GOLD, 0.22f);
        float r = dp(31);
        for (int i = 0; i < 6; i++) {
            double a1 = phase * Math.PI * 2 + i * Math.PI / 3;
            double a2 = phase * Math.PI * 2 + (i + 1) * Math.PI / 3;
            canvas.drawLine(
                    cx + (float)Math.cos(a1)*r, cy + (float)Math.sin(a1)*r,
                    cx + (float)Math.cos(a2)*r, cy + (float)Math.sin(a2)*r,
                    paint
            );
        }
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < 6; i++) {
            double a = phase * Math.PI * 2 + i * Math.PI / 3;
            setPaintColor(CiPresenceSpec.GOLD, 0.62f);
            canvas.drawCircle(cx + (float)Math.cos(a)*r, cy + (float)Math.sin(a)*r, dpf(2.0f), paint);
        }
    }

    private void drawDelegating(Canvas canvas, float cx, float cy, float phase) {
        int count = 3;
        for (int s = 0; s < count; s++) {
            double angle = -0.55 + s * 0.55;
            float ex = cx + (float)Math.cos(angle) * Math.max(getWidth(), getHeight()) * 0.42f;
            float ey = cy + (float)Math.sin(angle) * Math.max(getWidth(), getHeight()) * 0.42f;
            drawTravelParticles(canvas, cx, cy, ex, ey, phase, CiPresenceSpec.GOLD, 0.48f, 13);
        }
    }

    private void drawWaiting(Canvas canvas, float cx, float cy, float phase) {
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.35f));
        float r = dp(30);
        oval.set(cx - r * 1.35f, cy - r, cx + r * 1.35f, cy + r);
        setPaintColor(CiPresenceSpec.COOL_NEUTRAL, 0.20f + 0.16f * (float)Math.sin(phase * Math.PI));
        canvas.drawArc(oval, 205f, 235f, false, paint);
        setPaintColor(CiPresenceSpec.GOLD, 0.24f);
        canvas.drawArc(oval, 25f, 70f, false, paint);
    }

    private void drawTargetAction(Canvas canvas, float cx, float cy, float elapsed, boolean opening) {
        if (!hasTarget) return;
        float duration = opening ? 900f : 720f;
        float p = clamp01(elapsed / duration);
        drawTravelParticles(canvas, cx, cy, targetX, targetY, p, CiPresenceSpec.GOLD, 0.62f, 18);

        float hit = easeOutCubic(clamp01((p - 0.35f) / 0.65f));
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.35f));
        setPaintColor(CiPresenceSpec.GOLD, 0.52f * (1f - 0.55f * hit));
        canvas.drawCircle(targetX, targetY, dp(8) + dp(26) * hit, paint);

        if (opening) {
            paint.setStyle(Paint.Style.FILL);
            setPaintColor(CiPresenceSpec.GOLD, 0.08f * (1f - p));
            canvas.drawCircle(targetX, targetY, dp(28) + dp(150) * hit, paint);
        }
    }

    private void drawResult(Canvas canvas, float cx, float cy, float elapsed) {
        float p = clamp01(elapsed / (float) CiPresenceSpec.RESULT_CONVERGE_MS);
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < 18; i++) {
            double a = i * 2.399963 + 0.4;
            float outer = dp(86) + dp(12) * (i % 3);
            float r = outer * (1f - easeOutCubic(p)) + dp(8) * p;
            int color = i % 4 == 0 ? CiPresenceSpec.BLUE : CiPresenceSpec.GOLD;
            setPaintColor(color, 0.50f * (1f - p) + 0.08f);
            canvas.drawCircle(cx + (float)Math.cos(a)*r, cy + (float)Math.sin(a)*r, dpf(1.6f), paint);
        }
    }

    private void drawError(Canvas canvas, float cx, float cy, float elapsed) {
        float p = clamp01(elapsed / (float) CiPresenceSpec.ERROR_MS);
        float shake = (float)Math.sin(p * Math.PI * 7) * dp(3) * (1f - p);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dpf(1.4f));
        setPaintColor(CiPresenceSpec.GOLD, 0.46f * (1f - 0.45f * p));
        oval.set(cx - dp(28) + shake, cy - dp(23), cx + dp(28) + shake, cy + dp(23));
        canvas.drawArc(oval, 18f, 94f, false, paint);
        canvas.drawArc(oval, 178f, 72f, false, paint);
    }

    private void drawOrbitParticles(
            Canvas canvas,
            float cx,
            float cy,
            float radius,
            float phase,
            int color,
            int count,
            float alpha) {
        paint.setStyle(Paint.Style.FILL);
        for (int i = 0; i < count; i++) {
            double a = phase * Math.PI * 2 + i * Math.PI * 2 / count;
            float wobble = dp(2) * (float)Math.sin(i * 1.3 + phase * 5.0);
            setPaintColor(color, alpha * (0.55f + 0.45f * ((i % 3) / 2f)));
            canvas.drawCircle(
                    cx + (float)Math.cos(a) * (radius + wobble),
                    cy + (float)Math.sin(a) * (radius + wobble),
                    dpf(1.35f + (i % 2) * 0.45f),
                    paint
            );
        }
    }

    private void drawTravelParticles(
            Canvas canvas,
            float sx,
            float sy,
            float ex,
            float ey,
            float progress,
            int color,
            float alpha,
            int count) {
        paint.setStyle(Paint.Style.FILL);
        float vx = ex - sx;
        float vy = ey - sy;
        float length = (float)Math.hypot(vx, vy);
        float nx = length > 0.01f ? -vy / length : 0f;
        float ny = length > 0.01f ? vx / length : 0f;
        for (int i = 0; i < count; i++) {
            float tail = i / (float)Math.max(1, count - 1);
            float t = clamp01(progress * 1.18f - tail * 0.38f);
            if (t <= 0f) continue;
            float wobble = (float)Math.sin(i * 1.91 + progress * 7.0) * dp(3) * tail;
            setPaintColor(color, alpha * (0.32f + 0.68f * (1f - tail)));
            canvas.drawCircle(
                    sx + vx * t + nx * wobble,
                    sy + vy * t + ny * wobble,
                    dpf(1.1f + (1f - tail) * 0.9f),
                    paint
            );
        }
    }

    private void drawFadingLine(
            Canvas canvas,
            float x1, float y1,
            float x2, float y2,
            float baseAlpha,
            float startFactor,
            float endFactor) {
        final int segments = 9;
        for (int i = 0; i < segments; i++) {
            float a = i / (float) segments;
            float b = (i + 1) / (float) segments;
            float factor = lerp(startFactor, endFactor, (a + b) * 0.5f);
            setPaintColor(CiPresenceSpec.GOLD, baseAlpha * factor);
            canvas.drawLine(
                    lerp(x1, x2, a),
                    lerp(y1, y2, a),
                    lerp(x1, x2, b),
                    lerp(y1, y2, b),
                    paint
            );
        }
    }

    private boolean needsNextFrame(long now) {
        if (gestureStartedAt > 0L) return true;
        if (contextTransitionAt > 0L) return true;
        if (activity == CiPresenceSpec.Activity.LISTENING
                || activity == CiPresenceSpec.Activity.THINKING
                || activity == CiPresenceSpec.Activity.SEARCHING
                || activity == CiPresenceSpec.Activity.CALCULATING
                || activity == CiPresenceSpec.Activity.DELEGATING
                || activity == CiPresenceSpec.Activity.WAITING_EXTERNAL) {
            return true;
        }
        return activityDurationMs > 0L && now - activityStartedAt <= activityDurationMs + 34L;
    }

    private long defaultDuration(CiPresenceSpec.Activity value) {
        if (value == CiPresenceSpec.Activity.TOUCH) return 240L;
        if (value == CiPresenceSpec.Activity.RESULT) return CiPresenceSpec.RESULT_CONVERGE_MS;
        if (value == CiPresenceSpec.Activity.ERROR) return CiPresenceSpec.ERROR_MS;
        if (value == CiPresenceSpec.Activity.RETRACTING) return CiPresenceSpec.CONTEXT_RETRACT_MS;
        return 0L;
    }

    private void setPaintColor(int color, float alpha) {
        int a = Math.max(0, Math.min(255, Math.round(alpha * 255f)));
        paint.setColor((color & 0x00FFFFFF) | (a << 24));
    }

    private int blend(int a, int b, float t) {
        t = clamp01(t);
        int ar = (a >> 16) & 0xFF;
        int ag = (a >> 8) & 0xFF;
        int ab = a & 0xFF;
        int br = (b >> 16) & 0xFF;
        int bg = (b >> 8) & 0xFF;
        int bb = b & 0xFF;
        return android.graphics.Color.rgb(
                Math.round(lerp(ar, br, t)),
                Math.round(lerp(ag, bg, t)),
                Math.round(lerp(ab, bb, t))
        );
    }

    private float easeOutCubic(float t) {
        float q = 1f - clamp01(t);
        return 1f - q * q * q;
    }

    private float clamp01(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    private float lerp(float a, float b, float t) {
        return a + (b - a) * t;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private float dpf(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    private void invalidateFrame() {
        if (android.os.Build.VERSION.SDK_INT >= 16) postInvalidateOnAnimation();
        else invalidate();
    }
}
