package ua.cimeika.cipoint;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class CiResultProjection {
    private final Context context;
    private final WindowManager windowManager;
    private final List<TextView> cards = new ArrayList<>();
    private final List<WindowManager.LayoutParams> params = new ArrayList<>();
    private final List<String> values = new ArrayList<>();
    private static final int CARD_WIDTH_DP = 220;
    private static final int CARD_GAP_DP = 18;
    private static final int CARD_STACK_TOP_DP = 72;
    private static final int CARD_STACK_STEP_DP = 68;
    private static final int CARD_EDGE_DP = 12;

    private int anchorX;
    private int anchorY;
    private int pointSize;

    CiResultProjection(Context context, WindowManager windowManager) {
        this.context = context;
        this.windowManager = windowManager;
    }

    void show(JSONObject result, int x, int y, int size, int screenWidth, int screenHeight) {
        clear();
        anchorX = x;
        anchorY = y;
        pointSize = size;
        JSONObject projection = result.optJSONObject("projection");
        JSONArray items = projection != null ? projection.optJSONArray("items") : null;
        if (items != null) {
            for (int i = 0; i < items.length() && values.size() < 3; i++) {
                Object raw = items.opt(i);
                String label = labelOf(raw);
                if (!label.isEmpty()) values.add(label);
            }
        }
        if (values.isEmpty()) {
            String message = projection != null ? projection.optString("message", "") : "";
            if (message.isEmpty()) message = result.optString("answer", "");
            if (!message.trim().isEmpty()) values.add(message.trim());
        }
        for (int i = 0; i < values.size(); i++) {
            addCard(values.get(i), i, values.size(), screenWidth, screenHeight);
        }
    }

    void reposition(int x, int y, int size, int screenWidth, int screenHeight) {
        anchorX = x;
        anchorY = y;
        pointSize = size;
        for (int i = 0; i < cards.size(); i++) {
            WindowManager.LayoutParams p = params.get(i);
            place(p, i, cards.size(), screenWidth, screenHeight);
            try { windowManager.updateViewLayout(cards.get(i), p); } catch (Exception ignored) { }
        }
    }

    void clear() {
        for (TextView card : cards) {
            try { windowManager.removeView(card); } catch (Exception ignored) { }
        }
        cards.clear();
        params.clear();
        values.clear();
    }

    boolean isVisible() {
        return !cards.isEmpty();
    }

    private void addCard(String text, int index, int totalCount, int screenWidth, int screenHeight) {
        TextView card = new TextView(context);
        card.setText(text);
        card.setTextColor(Color.WHITE);
        card.setTextSize(14f);
        card.setGravity(Gravity.CENTER_VERTICAL);
        int padH = dp(14);
        int padV = dp(9);
        card.setPadding(padH, padV, padH, padV);
        card.setMaxLines(2);
        card.setEllipsize(android.text.TextUtils.TruncateAt.END);

        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.argb(218, 18, 21, 27));
        background.setCornerRadius(dp(16));
        background.setStroke(dp(1), Color.argb(70, 255, 255, 255));
        card.setBackground(background);
        card.setElevation(dp(8));

        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                dp(CARD_WIDTH_DP), WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        p.gravity = Gravity.TOP | Gravity.START;
        place(p, index, totalCount, screenWidth, screenHeight);
        cards.add(card);
        params.add(p);
        windowManager.addView(card, p);
    }

    private void place(WindowManager.LayoutParams p, int index, int totalCount, int screenWidth, int screenHeight) {
        int cardWidth = dp(CARD_WIDTH_DP);
        int gap = dp(CARD_GAP_DP);
        boolean placeLeft = anchorX + pointSize / 2 > screenWidth / 2;
        int x = placeLeft ? anchorX - cardWidth - gap : anchorX + pointSize + gap;
        x = Math.max(dp(CARD_EDGE_DP), Math.min(x, screenWidth - cardWidth - dp(CARD_EDGE_DP)));
        int step = dp(CARD_STACK_STEP_DP);
        int baseY = anchorY - dp(CARD_STACK_TOP_DP);
        int maxBaseY = screenHeight - dp(CARD_STACK_TOP_DP) - Math.max(0, totalCount - 1) * step;
        baseY = Math.max(dp(CARD_EDGE_DP), Math.min(baseY, Math.max(dp(CARD_EDGE_DP), maxBaseY)));
        int y = baseY + index * step;
        p.x = x;
        p.y = y;
    }

    private String labelOf(Object raw) {
        if (raw instanceof JSONObject) {
            JSONObject object = (JSONObject) raw;
            String label = object.optString("label", "");
            if (label.isEmpty()) label = object.optString("name", "");
            if (label.isEmpty()) label = object.optString("path", "");
            return label.trim();
        }
        return raw == null ? "" : String.valueOf(raw).trim();
    }

    private int dp(int value) {
        float density = context.getResources().getDisplayMetrics().density;
        return Math.max(1, Math.round(value * density));
    }
}
