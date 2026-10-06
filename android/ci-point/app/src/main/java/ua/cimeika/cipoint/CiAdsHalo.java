package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

final class CiAdsHalo {
    static final String STATUS_READY = "готово";
    static final String STATUS_WORKING = "в роботі";
    static final String STATUS_BLOCKED = "заблоковано";
    static final String STATUS_DECISION = "потрібне рішення";

    private static final String PREFS = "ci_ads_operator";
    private static final String KEY_STATUS = "status";
    private static final String KEY_CHANNEL = "channel";
    private static final String KEY_BUDGET = "budget_cap";
    private static final String KEY_NEXT = "next_action";

    private static final int WIDTH_DP = 292;
    private static final int HEIGHT_DP = 220;
    private static final int CENTER_X_DP = 205;
    private static final int CENTER_Y_DP = 132;

    private final Context context;
    private final WindowManager windowManager;
    private final SharedPreferences prefs;

    private AdsView view;
    private WindowManager.LayoutParams params;
    private int anchorX;
    private int anchorY;
    private int pointSize;
    private int screenWidth;
    private int screenHeight;

    CiAdsHalo(Context context, WindowManager windowManager) {
        this.context = context.getApplicationContext();
        this.windowManager = windowManager;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    void show(int x, int y, int size, int width, int height) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;

        if (view == null) {
            view = new AdsView(context);
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
            view.setAlpha(0f);
            view.setScaleX(0.94f);
            view.setScaleY(0.94f);
            view.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(170L).start();
        } else {
            place();
            try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) { }
        }
        refresh();
    }

    void refresh() {
        if (view == null) return;
        view.setModel(
                prefs.getString(KEY_STATUS, STATUS_DECISION),
                prefs.getString(KEY_CHANNEL, "?"),
                prefs.getString(KEY_BUDGET, "?"),
                prefs.getString(KEY_NEXT, "Визначити кампанію")
        );
    }

    void update(String status, String channel, String budget, String nextAction) {
        SharedPreferences.Editor editor = prefs.edit();
        if (status != null && !status.trim().isEmpty()) {
            editor.putString(KEY_STATUS, normalizeStatus(status));
        }
        if (channel != null && !channel.trim().isEmpty()) editor.putString(KEY_CHANNEL, channel.trim());
        if (budget != null && !budget.trim().isEmpty()) editor.putString(KEY_BUDGET, budget.trim());
        if (nextAction != null && !nextAction.trim().isEmpty()) editor.putString(KEY_NEXT, nextAction.trim());
        editor.apply();
        refresh();
    }

    void markDecisionRequired() {
        update(STATUS_DECISION, null, null, null);
    }

    void markWorking() {
        update(STATUS_WORKING, null, null, null);
    }

    private String normalizeStatus(String value) {
        String s = value == null ? "" : value.trim().toLowerCase(java.util.Locale.ROOT);
        if (STATUS_READY.equals(s) || "ready".equals(s) || "done".equals(s) || "completed".equals(s)) {
            return STATUS_READY;
        }
        if (STATUS_WORKING.equals(s) || "working".equals(s) || "in_progress".equals(s) || "running".equals(s)) {
            return STATUS_WORKING;
        }
        if (STATUS_BLOCKED.equals(s) || "blocked".equals(s) || "unavailable".equals(s)) {
            return STATUS_BLOCKED;
        }
        if (STATUS_DECISION.equals(s) || "decision_required".equals(s)
                || "needs_decision".equals(s) || "approval_required".equals(s)) {
            return STATUS_DECISION;
        }
        return STATUS_DECISION;
    }

    void reposition(int x, int y, int size, int width, int height) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;
        if (view == null || params == null) return;
        place();
        try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) { }
    }

    boolean isVisible() {
        return view != null;
    }

    void clear() {
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
        params.x = anchorX + pointSize / 2 - centerX;
        params.y = anchorY + pointSize / 2 - centerY;

        int edge = dp(8);
        params.x = Math.max(edge - dp(WIDTH_DP), Math.min(params.x, screenWidth - edge));
        params.y = Math.max(edge, Math.min(params.y, screenHeight - dp(HEIGHT_DP) - edge));
    }

    private int dp(int value) {
        return Math.max(1, Math.round(value * context.getResources().getDisplayMetrics().density));
    }

    private static final class AdsView extends View {
        private final float density;
        private final Paint titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint statusPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint labelPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint valuePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint accentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

        private String status = STATUS_DECISION;
        private String channel = "?";
        private String budget = "?";
        private String nextAction = "Визначити кампанію";

        AdsView(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setBackgroundColor(Color.TRANSPARENT);

            titlePaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            titlePaint.setTextSize(dpF(14f));

            statusPaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            statusPaint.setTextSize(dpF(19f));

            labelPaint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
            labelPaint.setTextSize(dpF(11f));

            valuePaint.setTypeface(android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL));
            valuePaint.setTextSize(dpF(13.5f));

            accentPaint.setStyle(Paint.Style.STROKE);
            accentPaint.setStrokeCap(Paint.Cap.ROUND);
            accentPaint.setStrokeWidth(dpF(2.2f));
        }

        void setModel(String status, String channel, String budget, String nextAction) {
            this.status = safe(status, STATUS_DECISION);
            this.channel = safe(channel, "?");
            this.budget = safe(budget, "?");
            this.nextAction = safe(nextAction, "Визначити кампанію");
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);

            boolean night = (getResources().getConfiguration().uiMode
                    & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            int text = night ? Color.WHITE : Color.rgb(30, 30, 32);
            int muted = night ? Color.rgb(188, 188, 194) : Color.rgb(92, 92, 98);
            int accent = statusColor(status, night);

            titlePaint.setColor(muted);
            statusPaint.setColor(accent);
            labelPaint.setColor(muted);
            valuePaint.setColor(text);
            accentPaint.setColor(accent);

            float x = dpF(12f);
            canvas.drawText("Ci Ads", x, dpF(24f), titlePaint);
            canvas.drawText(status, x, dpF(51f), statusPaint);

            row(canvas, "Канал", channel, x, dpF(84f));
            row(canvas, "Ліміт", budget, x, dpF(116f));
            row(canvas, "Далі", nextAction, x, dpF(148f));

            float cx = dpF(CENTER_X_DP);
            float cy = dpF(CENTER_Y_DP);
            float radius = dpF(49f);
            canvas.drawArc(cx - radius, cy - radius, cx + radius, cy + radius,
                    -52f, 104f, false, accentPaint);
        }

        private void row(Canvas canvas, String label, String value, float x, float y) {
            canvas.drawText(label, x, y, labelPaint);
            float valueX = x + dpF(52f);
            String clipped = value;
            while (valuePaint.measureText(clipped) > dpF(142f) && clipped.length() > 4) {
                clipped = clipped.substring(0, clipped.length() - 2);
            }
            if (!clipped.equals(value)) clipped = clipped.trim() + "…";
            canvas.drawText(clipped, valueX, y, valuePaint);
        }

        private int statusColor(String value, boolean night) {
            String s = value == null ? "" : value.toLowerCase(java.util.Locale.ROOT);
            if (s.contains("готов")) return Color.rgb(58, 178, 112);
            if (s.contains("робот")) return Color.rgb(70, 145, 245);
            if (s.contains("блок")) return Color.rgb(222, 82, 78);
            return night ? Color.rgb(218, 177, 133) : Color.rgb(150, 103, 69);
        }

        private String safe(String value, String fallback) {
            if (value == null || value.trim().isEmpty()) return fallback;
            return value.trim();
        }

        private float dpF(float value) {
            return value * density;
        }
    }
}
