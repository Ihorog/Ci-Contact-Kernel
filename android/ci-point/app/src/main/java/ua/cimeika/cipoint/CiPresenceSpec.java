package ua.cimeika.cipoint;

import android.graphics.Color;

final class CiPresenceSpec {
    enum Activity {
        IDLE,
        TOUCH,
        LISTENING,
        THINKING,
        SEARCHING,
        CALCULATING,
        DELEGATING,
        WAITING_EXTERNAL,
        SCREEN_ACTION,
        APP_OPENING,
        RESULT,
        ERROR,
        RETRACTING,
        HIDDEN
    }

    static final int LOGO_DP = 72;
    static final int EDGE_INSET_DP = 18;
    static final int HIDDEN_VISIBLE_DP = 12;

    static final int CONTEXT_CELL_COUNT = 3;
    static final int CONTEXT_CELL_WIDTH_DP = 176;
    static final int CONTEXT_CELL_HEIGHT_DP = 72;
    static final int CONTEXT_GAP_DP = 14;
    static final int CONTEXT_ARC_STEP_DP = 78;
    static final float CONTEXT_STROKE_DP = 1.25f;

    static final float CONTEXT_NEAR_ALPHA = 0.82f;
    static final float CONTEXT_FAR_ALPHA = 0f;
    static final float CONTENT_ALPHA = 0.88f;
    static final float PASSIVE_ALPHA = 0.94f;
    static final float IDLE_DIM_ALPHA = 0.62f;
    static final float DOCKED_ALPHA = 0.72f;
    static final float HIDDEN_ALPHA = 0.34f;
    static final float ACTIVE_ALPHA = 1f;
    static final float PASSIVE_BREATH_SCALE = 1.026f;

    static final long PASSIVE_BREATH_UP_MS = 1220L;
    static final long PASSIVE_BREATH_DOWN_MS = 1380L;
    static final long IDLE_DIM_DELAY_MS = 6000L;
    static final long GESTURE_TRAIL_MS = 420L;
    static final long CONTEXT_REVEAL_MS = 360L;
    static final long CONTEXT_RETRACT_MS = 320L;
    static final long RESULT_CONVERGE_MS = 520L;
    static final long ERROR_MS = 360L;
    static final long WAITING_THRESHOLD_MS = 280L;

    static final int GOLD = Color.rgb(0xD8, 0xB1, 0x5A);
    static final int BLUE = Color.rgb(0x84, 0xD8, 0xFF);
    static final int COOL_NEUTRAL = Color.rgb(0xAF, 0xC2, 0xD0);

    static Activity parseActivity(String raw) {
        if (raw == null) return Activity.IDLE;
        switch (raw.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "listening": return Activity.LISTENING;
            case "thinking": return Activity.THINKING;
            case "searching":
            case "web_search":
            case "search": return Activity.SEARCHING;
            case "calculating":
            case "calculation": return Activity.CALCULATING;
            case "delegating":
            case "external":
            case "tool_call": return Activity.DELEGATING;
            case "waiting":
            case "waiting_external": return Activity.WAITING_EXTERNAL;
            case "screen_action": return Activity.SCREEN_ACTION;
            case "app_opening":
            case "opening_app": return Activity.APP_OPENING;
            case "result":
            case "done": return Activity.RESULT;
            case "error": return Activity.ERROR;
            case "retracting":
            case "retract": return Activity.RETRACTING;
            case "hidden": return Activity.HIDDEN;
            case "touch": return Activity.TOUCH;
            default: return Activity.IDLE;
        }
    }

    private CiPresenceSpec() { }
}
