package ua.cimeika.cipoint;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class CiContextHalo {
    interface Callback {
        void onCardTap(CiContextCard card);
        void onCardSwipe(CiContextCard card, String direction);
    }

    private static final int CARD_WIDTH_DP = 176;
    private static final int CARD_HEIGHT_DP = 72;
    private static final int GAP_DP = 14;
    private static final int EDGE_DP = 12;
    private static final int ARC_STEP_DP = 78;

    private final Context context;
    private final WindowManager windowManager;
    private final Callback callback;
    private final List<TextView> views = new ArrayList<>();
    private final List<WindowManager.LayoutParams> params = new ArrayList<>();
    private final List<CiContextCard> models = new ArrayList<>();

    private int anchorX;
    private int anchorY;
    private int pointSize;
    private int screenWidth;
    private int screenHeight;

    CiContextHalo(Context context, WindowManager windowManager, Callback callback) {
        this.context = context;
        this.windowManager = windowManager;
        this.callback = callback;
    }

    void show(JSONObject payload, int x, int y, int size, int width, int height) {
        clear();
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;
        JSONArray cards = payload != null ? payload.optJSONArray("cards") : null;
        if (cards == null) return;
        for (int i = 0; i < cards.length() && models.size() < 3; i++) {
            JSONObject raw = cards.optJSONObject(i);
            if (raw == null) continue;
            CiContextCard model = CiContextCard.from(raw);
            models.add(model);
            addCard(model, models.size() - 1);
        }
    }

    void reposition(int x, int y, int size, int width, int height) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        screenWidth = width;
        screenHeight = height;
        for (int i = 0; i < views.size(); i++) {
            WindowManager.LayoutParams p = params.get(i);
            place(p, i);
            try {
                windowManager.updateViewLayout(views.get(i), p);
            } catch (Exception ignored) { }
        }
    }

    boolean isVisible() {
        return !views.isEmpty();
    }

    void clear() {
        for (TextView view : views) {
            try {
                windowManager.removeView(view);
            } catch (Exception ignored) { }
        }
        views.clear();
        params.clear();
        models.clear();
    }

    private void addCard(CiContextCard model, int index) {
        TextView card = new TextView(context);
        card.setText(model.label);
        card.setTextColor(Color.WHITE);
        card.setTextSize(13f);
        card.setGravity(Gravity.CENTER);
        card.setMaxLines(2);
        card.setEllipsize(android.text.TextUtils.TruncateAt.END);
        card.setPadding(dp(24), dp(8), dp(24), dp(8));
        card.setContentDescription("Сі: " + model.label);
        card.setBackground(backgroundFor(model));
        card.setElevation(dp(14));
        card.setAlpha(0f);
        card.setScaleX(0.82f);
        card.setScaleY(0.82f);
        attachTouch(card, model);

        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                dp(CARD_WIDTH_DP), dp(CARD_HEIGHT_DP),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        p.gravity = Gravity.TOP | Gravity.START;
        place(p, index);
        views.add(card);
        params.add(p);
        windowManager.addView(card, p);

        long delay = 25L + index * 45L;
        card.animate().alpha(0.96f).scaleX(1f).scaleY(1f)
                .translationZ(dp(10 + index * 2))
                .setStartDelay(delay).setDuration(170L).start();
    }

    private Drawable backgroundFor(CiContextCard card) {
        int alpha = "predicted".equals(card.state) ? 174 : 214;
        if ("past".equals(card.state)) alpha = 156;
        return new CiHexagonDrawable(
                Color.argb(alpha, 15, 18, 24),
                Color.argb(92, 255, 255, 255),
                dp(1)
        );
    }

    private void attachTouch(TextView view, CiContextCard model) {
        final float[] down = new float[2];
        final long[] downAt = new long[1];
        view.setOnTouchListener((v, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                down[0] = event.getRawX();
                down[1] = event.getRawY();
                downAt[0] = System.currentTimeMillis();
                v.animate().scaleX(0.95f).scaleY(0.95f)
                        .translationZ(dp(4)).setDuration(70L).start();
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                float dx = event.getRawX() - down[0];
                float dy = event.getRawY() - down[1];
                long dt = System.currentTimeMillis() - downAt[0];
                v.animate().scaleX(1f).scaleY(1f)
                        .translationZ(dp(12)).setDuration(120L).start();
                if (Math.hypot(dx, dy) >= dp(28) && dt <= 700L) {
                    String direction = Math.abs(dx) >= Math.abs(dy)
                            ? (dx >= 0 ? "right" : "left")
                            : (dy >= 0 ? "down" : "up");
                    callback.onCardSwipe(model, direction);
                } else {
                    callback.onCardTap(model);
                }
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                v.animate().scaleX(1f).scaleY(1f).setDuration(90L).start();
                return true;
            }
            return true;
        });
    }

    private void place(WindowManager.LayoutParams p, int index) {
        int cardWidth = dp(CARD_WIDTH_DP);
        int cardHeight = dp(CARD_HEIGHT_DP);
        int gap = dp(GAP_DP);
        boolean left = anchorX + pointSize / 2 > screenWidth / 2;
        int x = left ? anchorX - cardWidth - gap : anchorX + pointSize + gap;
        if (index == 1) x += left ? -dp(10) : dp(10);
        int yOffset = (index - 1) * dp(ARC_STEP_DP);
        int y = anchorY + pointSize / 2 - cardHeight / 2 + yOffset;
        int edge = dp(EDGE_DP);
        p.x = Math.max(edge, Math.min(x, screenWidth - cardWidth - edge));
        p.y = Math.max(edge, Math.min(y, screenHeight - cardHeight - edge));
    }

    private int dp(int value) {
        return Math.max(1, Math.round(value * context.getResources().getDisplayMetrics().density));
    }
}
