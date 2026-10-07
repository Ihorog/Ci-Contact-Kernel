package ua.cimeika.cipoint;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

final class CiWatchHalo {
    static final String STATE_IDLE = "idle";
    static final String STATE_READY = "ready";
    static final String STATE_LISTENING = "listening";
    static final String STATE_PROCESSING = "processing";
    static final String STATE_CONFIRM = "confirm";
    static final String STATE_CONFIRMED = "confirmed";
    static final String STATE_ERROR = "error";

    private static final int WIDTH_DP = 260;
    private static final int HEIGHT_DP = 250;
    private static final int CENTER_X_DP = 150;
    private static final int CENTER_Y_DP = 145;

    private final Context context;
    private final WindowManager windowManager;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private WatchView view;
    private WindowManager.LayoutParams params;
    private int anchorX;
    private int anchorY;
    private int pointSize;
    private int screenWidth;
    private int screenHeight;
    private Runnable ticker;

    CiWatchHalo(Context context, WindowManager windowManager) {
        this.context = context.getApplicationContext();
        this.windowManager = windowManager;
    }

    void show(int x, int y, int size, int width, int height) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;

        if (view == null) {
            view = new WatchView(context);
            view.setAlpha(0f);
            params = new WindowManager.LayoutParams(
                    dp(WIDTH_DP),
                    dp(HEIGHT_DP),
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                            : WindowManager.LayoutParams.TYPE_PHONE,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT
            );
            params.gravity = Gravity.TOP | Gravity.START;
            place();
            windowManager.addView(view, params);
            view.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(180L).start();
        } else {
            place();
            try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) { }
            view.setAlpha(1f);
        }
        view.setPointSize(pointSize);
        view.setState(STATE_IDLE);
        startTicker();
    }

    void reposition(int x, int y, int size, int width, int height) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;
        if (view == null || params == null) return;
        view.setPointSize(pointSize);
        place();
        try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) { }
    }

    void setVoiceState(String state) {
        if (view == null) return;
        view.setState(state == null ? STATE_IDLE : state);
    }

    void confirmed() {
        if (view == null) return;
        view.setState(STATE_CONFIRMED);
        handler.postDelayed(() -> {
            if (view != null && STATE_CONFIRMED.equals(view.state)) {
                view.setState(STATE_IDLE);
            }
        }, 900L);
    }

    boolean isVisible() {
        return view != null;
    }

    void clear() {
        stopTicker();
        if (view != null) {
            try { windowManager.removeView(view); } catch (Exception ignored) { }
        }
        view = null;
        params = null;
    }

    private void place() {
        if (params == null) return;
        int centerX = dp(CENTER_X_DP);
        int centerY = dp(CENTER_Y_DP);
        int width = dp(WIDTH_DP);
        int height = dp(HEIGHT_DP);

        int requestedX = anchorX + pointSize / 2 - centerX;
        int requestedY = anchorY + pointSize / 2 - centerY;

        int maxX = Math.max(0, screenWidth - width);
        int maxY = Math.max(0, screenHeight - height);
        params.x = Math.max(0, Math.min(requestedX, maxX));
        params.y = Math.max(0, Math.min(requestedY, maxY));
    }

    private void startTicker() {
        stopTicker();
        ticker = new Runnable() {
            @Override public void run() {
                if (view == null) return;
                view.invalidate();
                handler.postDelayed(this, 250L);
            }
        };
        handler.post(ticker);
    }

    private void stopTicker() {
        if (ticker != null) handler.removeCallbacks(ticker);
        ticker = null;
    }

    private int dp(int value) {
        return Math.max(1, Math.round(value * context.getResources().getDisplayMetrics().density));
    }

    private static final class WatchView extends View {
        private final float density;
        private final Locale locale = Locale.forLanguageTag("uk-UA");
        private final SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", locale);
        private final SimpleDateFormat dateFormat = new SimpleDateFormat("EEEE, d MMMM", locale);

        private final Paint pipPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint hourPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint minutePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint secondPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint timePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint datePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint statePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint centerPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        private int pointSize;
        private String state = STATE_IDLE;

        WatchView(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setBackgroundColor(Color.TRANSPARENT);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);

            pipPaint.setStyle(Paint.Style.FILL);

            hourPaint.setStyle(Paint.Style.STROKE);
            hourPaint.setStrokeCap(Paint.Cap.ROUND);
            hourPaint.setStrokeWidth(dpF(4.2f));

            minutePaint.setStyle(Paint.Style.STROKE);
            minutePaint.setStrokeCap(Paint.Cap.ROUND);
            minutePaint.setStrokeWidth(dpF(3.1f));

            secondPaint.setStyle(Paint.Style.STROKE);
            secondPaint.setStrokeCap(Paint.Cap.ROUND);
            secondPaint.setStrokeWidth(dpF(1.35f));

            timePaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            timePaint.setTextSize(dpF(27f));
            datePaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
            datePaint.setTextSize(dpF(12.5f));

            statePaint.setStyle(Paint.Style.STROKE);
            statePaint.setStrokeCap(Paint.Cap.ROUND);
            statePaint.setStrokeWidth(dpF(1.8f));

            centerPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            centerPaint.setTextAlign(Paint.Align.CENTER);
            centerPaint.setTextSize(dpF(28f));
        }

        void setPointSize(int size) {
            pointSize = size;
            invalidate();
        }

        void setState(String next) {
            state = next == null ? STATE_IDLE : next;
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            final float cx = dpF(CENTER_X_DP);
            final float cy = dpF(CENTER_Y_DP);
            final float pointRadius = Math.max(dpF(28f), pointSize / 2f);
            final float innerRadius = pointRadius + dpF(6f);
            final float pipRadius = dpF(89f);

            boolean night = (getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;

            int rose = night ? Color.rgb(218, 177, 133) : Color.rgb(150, 103, 69);
            int text = night ? Color.WHITE : Color.rgb(28, 28, 30);
            int blue = night ? Color.rgb(72, 170, 255) : Color.rgb(0, 110, 220);

            pipPaint.setColor(rose);
            hourPaint.setColor(rose);
            minutePaint.setColor(rose);
            secondPaint.setColor(blue);
            timePaint.setColor(text);
            datePaint.setColor(Color.argb(night ? 205 : 190, Color.red(text), Color.green(text), Color.blue(text)));

            drawPips(canvas, cx, cy, pipRadius);

            Calendar now = Calendar.getInstance();
            float second = now.get(Calendar.SECOND) + now.get(Calendar.MILLISECOND) / 1000f;
            float minute = now.get(Calendar.MINUTE) + second / 60f;
            float hour = (now.get(Calendar.HOUR) % 12) + minute / 60f;

            drawHand(canvas, cx, cy, hour * 30f, innerRadius, dpF(58f), hourPaint);
            drawHand(canvas, cx, cy, minute * 6f, innerRadius, dpF(76f), minutePaint);
            drawHand(canvas, cx, cy, second * 6f, innerRadius, dpF(84f), secondPaint);

            Date date = new Date();
            String dateText = dateFormat.format(date);
            if (!dateText.isEmpty()) {
                dateText = dateText.substring(0, 1).toUpperCase(locale) + dateText.substring(1);
            }

            canvas.drawText(timeFormat.format(date), dpF(12f), dpF(31f), timePaint);
            canvas.drawText(dateText, dpF(12f), dpF(52f), datePaint);

            drawVoiceState(canvas, cx, cy, pointRadius, blue, rose, text);
        }

        private void drawPips(Canvas canvas, float cx, float cy, float radius) {
            for (int i = 0; i < 60; i++) {
                double angle = Math.toRadians(i * 6d - 90d);
                float x = cx + (float) Math.cos(angle) * radius;
                float y = cy + (float) Math.sin(angle) * radius;
                float r = i % 5 == 0 ? dpF(1.75f) : dpF(0.85f);
                int alpha = i % 5 == 0 ? 220 : 112;
                pipPaint.setAlpha(alpha);
                canvas.drawCircle(x, y, r, pipPaint);
            }
            pipPaint.setAlpha(255);
        }

        private void drawHand(Canvas canvas, float cx, float cy, float degrees,
                              float fromRadius, float length, Paint paint) {
            double angle = Math.toRadians(degrees - 90d);
            float sx = cx + (float) Math.cos(angle) * fromRadius;
            float sy = cy + (float) Math.sin(angle) * fromRadius;
            float ex = cx + (float) Math.cos(angle) * length;
            float ey = cy + (float) Math.sin(angle) * length;
            canvas.drawLine(sx, sy, ex, ey, paint);
        }

        private void drawVoiceState(Canvas canvas, float cx, float cy, float pointRadius,
                                    int blue, int rose, int text) {
            if (STATE_IDLE.equals(state)) return;

            int color = blue;
            if (STATE_CONFIRM.equals(state)) color = rose;
            if (STATE_CONFIRMED.equals(state)) color = Color.rgb(70, 190, 125);
            if (STATE_ERROR.equals(state)) color = Color.rgb(220, 75, 70);

            float phase = (System.currentTimeMillis() % 1200L) / 1200f;
            int alpha = STATE_LISTENING.equals(state)
                    ? 120 + Math.round(105f * (0.5f + 0.5f * (float) Math.sin(phase * Math.PI * 2d)))
                    : 205;

            statePaint.setColor(color);
            statePaint.setAlpha(alpha);
            float ring = pointRadius + dpF(10f);

            if (STATE_READY.equals(state) || STATE_PROCESSING.equals(state)) {
                canvas.drawArc(cx - ring, cy - ring, cx + ring, cy + ring, -70f, 140f, false, statePaint);
                canvas.drawArc(cx - ring, cy - ring, cx + ring, cy + ring, 110f, 140f, false, statePaint);
            } else {
                canvas.drawCircle(cx, cy, ring, statePaint);
            }

            if (STATE_CONFIRMED.equals(state)) {
                centerPaint.setColor(color);
                centerPaint.setAlpha(235);
                canvas.drawText("✓", cx, cy + dpF(10f), centerPaint);
            } else if (STATE_CONFIRM.equals(state)) {
                centerPaint.setColor(text);
                centerPaint.setAlpha(205);
                centerPaint.setTextSize(dpF(18f));
                canvas.drawText("•", cx, cy + dpF(6f), centerPaint);
                centerPaint.setTextSize(dpF(28f));
            }
            statePaint.setAlpha(255);
        }

        private float dpF(float value) {
            return value * density;
        }
    }
}
