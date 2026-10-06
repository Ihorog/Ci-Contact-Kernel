package ua.cimeika.cipoint;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;

final class CiSwipeVisualLayer {
    private static final int WIDTH_DP = 420;
    private static final int HEIGHT_DP = 260;
    private static final long DURATION_MS = 620L;

    private enum Mode { CONTEXT_LEFT, ACTION_RIGHT }

    private final Context context;
    private final WindowManager windowManager;
    private ParticleView view;
    private WindowManager.LayoutParams params;
    private ValueAnimator animator;
    private boolean callbackFired;
    private boolean suppressCallback;
    private long generation;

    CiSwipeVisualLayer(Context context, WindowManager windowManager) {
        this.context = context;
        this.windowManager = windowManager;
    }

    void showContext(int anchorX, int anchorY, int pointSize, int screenWidth, int screenHeight, Runnable onFormed) {
        show(Mode.CONTEXT_LEFT, anchorX, anchorY, pointSize, screenWidth, screenHeight, onFormed);
    }

    void showAction(int anchorX, int anchorY, int pointSize, int screenWidth, int screenHeight, Runnable onFormed) {
        show(Mode.ACTION_RIGHT, anchorX, anchorY, pointSize, screenWidth, screenHeight, onFormed);
    }

    void clear() {
        generation++;
        suppressCallback = true;
        if (animator != null) {
            animator.cancel();
            animator = null;
        }
        if (view != null) {
            try { windowManager.removeView(view); } catch (Exception ignored) { }
            view = null;
            params = null;
        }
        callbackFired = false;
    }

    private void show(
            Mode mode,
            int anchorX,
            int anchorY,
            int pointSize,
            int screenWidth,
            int screenHeight,
            Runnable onFormed
    ) {
        clear();
        final long visualGeneration = generation;
        suppressCallback = false;

        int edge = dp(8);
        int width = Math.max(1, Math.min(dp(WIDTH_DP), screenWidth - edge * 2));
        int height = Math.max(1, Math.min(dp(HEIGHT_DP), screenHeight - edge * 2));
        float anchorCenterX = anchorX + pointSize / 2f;
        float anchorCenterY = anchorY + pointSize / 2f;

        int x;
        if (mode == Mode.CONTEXT_LEFT) {
            x = Math.round(anchorCenterX - width + dp(54));
        } else {
            x = Math.round(anchorCenterX - dp(54));
        }
        int y = Math.round(anchorCenterY - height / 2f);
        x = Math.max(edge, Math.min(x, screenWidth - width - edge));
        y = Math.max(edge, Math.min(y, screenHeight - height - edge));

        view = new ParticleView(context);
        view.configure(mode, anchorCenterX - x, anchorCenterY - y);

        params = new WindowManager.LayoutParams(
                width,
                height,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = x;
        params.y = y;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.alpha = 0.79f;
        }
        windowManager.addView(view, params);

        callbackFired = false;
        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(DURATION_MS);
        animator.setInterpolator(new DecelerateInterpolator(1.35f));
        animator.addUpdateListener(a -> {
            if (view == null) return;
            float p = (float) a.getAnimatedValue();
            view.setProgress(p);
            if (generation == visualGeneration
                    && !callbackFired
                    && p >= 0.70f) {
                callbackFired = true;
                if (onFormed != null) onFormed.run();
            }
        });
        animator.addListener(new AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(Animator animation) {
                if (generation == visualGeneration
                        && !suppressCallback
                        && !callbackFired) {
                    callbackFired = true;
                    if (onFormed != null) onFormed.run();
                }
                if (generation != visualGeneration) return;
                if (view != null) {
                    try { windowManager.removeView(view); } catch (Exception ignored) { }
                }
                view = null;
                params = null;
                animator = null;
            }
        });
        animator.start();
    }

    private int dp(int value) {
        return Math.max(1, Math.round(value * context.getResources().getDisplayMetrics().density));
    }

    private static final class ParticleView extends View {
        private static final int PARTICLE_COUNT = 42;

        private final Paint particlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint structurePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path hexPath = new Path();

        private Mode mode = Mode.CONTEXT_LEFT;
        private float originX;
        private float originY;
        private float progress;

        ParticleView(Context context) {
            super(context);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            structurePaint.setStyle(Paint.Style.STROKE);
            structurePaint.setStrokeWidth(dpF(1.5f));
            glowPaint.setStyle(Paint.Style.STROKE);
            glowPaint.setStrokeWidth(dpF(5f));
        }

        void configure(Mode mode, float originX, float originY) {
            this.mode = mode;
            this.originX = originX;
            this.originY = originY;
            this.progress = 0f;
        }

        void setProgress(float progress) {
            this.progress = Math.max(0f, Math.min(1f, progress));
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (mode == Mode.CONTEXT_LEFT) drawContext(canvas);
            else drawAction(canvas);
        }

        private void drawContext(Canvas canvas) {
            float t = smooth(Math.min(1f, progress / 0.72f));
            float structureT = clamp01((progress - 0.50f) / 0.30f);
            float fade = 1f - clamp01((progress - 0.90f) / 0.10f);
            float cx = Math.max(dpF(86f), originX - dpF(132f));
            float cy = originY;
            float hexRadius = dpF(27f);

            for (int i = 0; i < PARTICLE_COUNT; i++) {
                int cell = i % 7;
                float[] center = honeycombCenter(cell, cx, cy, hexRadius * 1.58f);
                float angle = (float) (i * 2.399963229728653);
                float jitter = dpF(5f + (i % 4) * 2f);
                float targetX = center[0] + (float) Math.cos(angle) * jitter;
                float targetY = center[1] + (float) Math.sin(angle) * jitter;
                float drift = (1f - t) * dpF(20f) * (float) Math.sin(i * 0.91f + progress * 8f);
                float x = lerp(originX, targetX, t) + drift;
                float y = lerp(originY, targetY, t) + (1f - t) * dpF(14f) * (float) Math.cos(i * 0.67f);
                int color = mixColor(Color.rgb(188, 255, 82), Color.rgb(42, 224, 210), i / (float) (PARTICLE_COUNT - 1));
                particlePaint.setColor(color);
                particlePaint.setAlpha(Math.round(220f * fade * (0.45f + 0.55f * t)));
                float radius = dpF(1.4f + (i % 3) * 0.55f);
                canvas.drawCircle(x, y, radius, particlePaint);
            }

            if (structureT > 0f) {
                int alpha = Math.round(210f * structureT * fade);
                structurePaint.setColor(Color.rgb(57, 230, 207));
                structurePaint.setAlpha(alpha);
                glowPaint.setColor(Color.rgb(117, 255, 177));
                glowPaint.setAlpha(Math.round(38f * structureT * fade));
                for (int i = 0; i < 7; i++) {
                    float[] center = honeycombCenter(i, cx, cy, hexRadius * 1.58f);
                    drawHex(canvas, center[0], center[1], hexRadius, glowPaint);
                    drawHex(canvas, center[0], center[1], hexRadius, structurePaint);
                }
            }
        }

        private void drawAction(Canvas canvas) {
            float t = smooth(Math.min(1f, progress / 0.72f));
            float nodeT = clamp01((progress - 0.50f) / 0.28f);
            float fade = 1f - clamp01((progress - 0.92f) / 0.08f);
            float cx = Math.min(getWidth() - dpF(74f), originX + dpF(128f));
            float cy = originY;

            for (int i = 0; i < PARTICLE_COUNT; i++) {
                float angle = (float) (i * 2.399963229728653);
                float ring = dpF(20f + (i % 5) * 2.7f);
                float targetX = cx + (float) Math.cos(angle) * ring;
                float targetY = cy + (float) Math.sin(angle) * ring;
                float arc = (1f - t) * dpF(24f) * (float) Math.sin(i * 0.83f + progress * 7f);
                float x = lerp(originX, targetX, t);
                float y = lerp(originY, targetY, t) + arc;
                int color = mixColor(Color.rgb(124, 66, 255), Color.rgb(212, 126, 255), i / (float) (PARTICLE_COUNT - 1));
                particlePaint.setColor(color);
                particlePaint.setAlpha(Math.round(225f * fade * (0.45f + 0.55f * t)));
                canvas.drawCircle(x, y, dpF(1.5f + (i % 4) * 0.45f), particlePaint);
            }

            if (nodeT > 0f) {
                float pulse = 1f + 0.04f * (float) Math.sin(progress * Math.PI * 8f);
                float outer = dpF(33f) * pulse;
                glowPaint.setColor(Color.rgb(145, 82, 255));
                glowPaint.setAlpha(Math.round(52f * nodeT * fade));
                glowPaint.setStrokeWidth(dpF(7f));
                canvas.drawCircle(cx, cy, outer, glowPaint);

                structurePaint.setColor(Color.rgb(199, 119, 255));
                structurePaint.setAlpha(Math.round(230f * nodeT * fade));
                structurePaint.setStrokeWidth(dpF(1.8f));
                canvas.drawCircle(cx, cy, dpF(27f), structurePaint);
                canvas.drawCircle(cx, cy, dpF(13f), structurePaint);

                particlePaint.setColor(Color.rgb(238, 205, 255));
                particlePaint.setAlpha(Math.round(240f * nodeT * fade));
                canvas.drawCircle(cx, cy, dpF(4.2f), particlePaint);
            }
        }

        private float[] honeycombCenter(int index, float cx, float cy, float d) {
            if (index == 0) return new float[]{cx, cy};
            double angle = Math.PI / 3d * (index - 1);
            return new float[]{
                    cx + (float) Math.cos(angle) * d,
                    cy + (float) Math.sin(angle) * d
            };
        }

        private void drawHex(Canvas canvas, float cx, float cy, float radius, Paint paint) {
            hexPath.reset();
            for (int i = 0; i < 6; i++) {
                double a = Math.PI / 3d * i;
                float x = cx + (float) Math.cos(a) * radius;
                float y = cy + (float) Math.sin(a) * radius;
                if (i == 0) hexPath.moveTo(x, y);
                else hexPath.lineTo(x, y);
            }
            hexPath.close();
            canvas.drawPath(hexPath, paint);
        }

        private float dpF(float value) {
            return value * getResources().getDisplayMetrics().density;
        }

        private static float lerp(float a, float b, float t) {
            return a + (b - a) * t;
        }

        private static float smooth(float t) {
            t = clamp01(t);
            return t * t * (3f - 2f * t);
        }

        private static float clamp01(float v) {
            return Math.max(0f, Math.min(1f, v));
        }

        private static int mixColor(int a, int b, float t) {
            t = clamp01(t);
            int r = Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * t);
            int g = Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * t);
            int bl = Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t);
            return Color.rgb(r, g, bl);
        }
    }
}
