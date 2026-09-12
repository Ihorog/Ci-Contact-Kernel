package ua.cimeika.cipoint;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.animation.ValueAnimator;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.view.animation.OvershootInterpolator;
import android.widget.ImageView;

public final class CiOverlayService extends Service {
    public static final String ACTION_SHOW = "ua.cimeika.cipoint.SHOW";
    public static final String ACTION_HIDE = "ua.cimeika.cipoint.HIDE";
    public static final String ACTION_CI_CLICK = "ua.cimeika.ci.action.CLICK";
    public static final String ACTION_CI_GESTURE = "ua.cimeika.ci.action.GESTURE";
    public static final String ACTION_CI_RESULT = "ua.cimeika.ci.action.RESULT";

    private static final String CHANNEL_ID = "ci_active_point";
    private static final int NOTIFICATION_ID = 7;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";
    private static final String CI_GPT_URL = "https://chatgpt.com/g/g-Uc7qoEi2e";
    private static final String PREFS = "ci_point";
    private static final String PREF_X = "x";
    private static final String PREF_Y = "y";
    private static final String PREF_HIDDEN = "hidden";
    private static final String PREF_STATE = "state";
    private static final String PREF_DOCK_SIDE = "dock_side";
    private static final long LONG_PRESS_MS = 420L;
    private static final long SWIPE_MAX_MS = 520L;
    private static final long DOUBLE_TAP_MS = 320L;
    private static final int HIDDEN_VISIBLE_DP = 12;

    private WindowManager windowManager;
    private View activePoint;
    private ImageView ciLogo;
    private WindowManager.LayoutParams pointParams;
    private WindowManager.LayoutParams logoParams;

    private int pointSize;
    private int edgeInset;
    private int touchSlop;
    private Handler handler;
    private SharedPreferences prefs;
    private CiVoiceController voiceController;

    private enum OverlayState { PASSIVE, CONTEXT, MOVE, DOCKED, PULSE, HIDDEN }
    private OverlayState overlayState = OverlayState.PASSIVE;
    private String dockSide = "";
    private Runnable passiveBreath;

    private float downRawX;
    private float downRawY;
    private long downTime;
    private int startX;
    private int startY;
    private boolean dragging;
    private boolean longPressTriggered;
    private long lastTapUpTime;
    private Runnable pendingSingleTap;
    private Runnable pendingLongPress;
    private float gestureCenterX;
    private float gestureCenterY;
    private double lastGestureAngle;
    private double accumulatedGestureAngle;
    private int gestureAngleSamples;

    @Override
    public void onCreate() {
        super.onCreate();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }

        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());

        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        handler = new Handler(Looper.getMainLooper());
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        voiceController = new CiVoiceController(this, new CiVoiceController.Callback() {
            @Override public void onListeningChanged(boolean listening) { handler.post(() -> handleVoiceListening(listening)); }
            @Override public void onTranscript(String text) { handler.post(() -> handleVoiceTranscript(text)); }
            @Override public void onResult(org.json.JSONObject result) { handler.post(() -> handleVoiceResult(result)); }
            @Override public void onError(String error) { handler.post(() -> handleVoiceError(error)); }
        });
        pointSize = dp(72);
        edgeInset = dp(18);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();

        dockSide = prefs.getString(PREF_DOCK_SIDE, "");
        if (Settings.canDrawOverlays(this)) {
            attachCi();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (windowManager == null) {
            return START_NOT_STICKY;
        }
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_HIDE.equals(action)) {
            hideCi();
            return START_STICKY;
        }
        if (activePoint == null && Settings.canDrawOverlays(this)) {
            attachCi();
        }
        if (ACTION_SHOW.equals(action) && prefs != null) {
            prefs.edit().putBoolean(PREF_HIDDEN, false).apply();
            if (overlayState == OverlayState.HIDDEN) revealFromHidden(false);
            else showLogo();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        cancelLongPress();
        cancelPassiveBreath();
        if (pendingSingleTap != null && handler != null) handler.removeCallbacks(pendingSingleTap);
        if (voiceController != null) voiceController.close();
        voiceController = null;
        removeOverlay(activePoint);
        removeOverlay(ciLogo);
        activePoint = null;
        ciLogo = null;
        super.onDestroy();
    }

    private void attachCi() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        int preferredX = Math.round(metrics.widthPixels * 0.72f) - pointSize / 2;
        int preferredY = Math.round(metrics.heightPixels * 0.62f) - pointSize / 2;
        int savedX = prefs != null ? prefs.getInt(PREF_X, preferredX) : preferredX;
        int savedY = prefs != null ? prefs.getInt(PREF_Y, preferredY) : preferredY;
        boolean hidden = prefs != null && prefs.getBoolean(PREF_HIDDEN, false);
        overlayState = hidden ? OverlayState.HIDDEN : stableStateFromPrefs();
        int x = overlayState == OverlayState.HIDDEN ? hiddenX(metrics.widthPixels)
                : (overlayState == OverlayState.DOCKED ? dockX(metrics.widthPixels) : clampX(savedX, metrics.widthPixels));
        int y = clampY(savedY, metrics.heightPixels);

        activePoint = new View(this);
        activePoint.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        activePoint.setContentDescription("Сі — активна точка");
        activePoint.setOnTouchListener(this::onPointTouch);

        pointParams = overlayParams(pointSize, pointSize, x, y,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        windowManager.addView(activePoint, pointParams);

        ciLogo = new ImageView(this);
        ciLogo.setImageResource(R.drawable.ci_logo);
        ciLogo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        ciLogo.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        ciLogo.setAlpha(0.96f);
        ciLogo.setElevation(dp(16));
        ciLogo.setTranslationZ(dp(8));

        logoParams = overlayParams(pointSize, pointSize, x, y,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        windowManager.addView(ciLogo, logoParams);
        applyStateVisual(false);
    }

    private WindowManager.LayoutParams overlayParams(int width, int height, int x, int y, int flags) {
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                width,
                height,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                flags,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = x;
        params.y = y;
        return params;
    }

    private boolean onPointTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downTime = System.currentTimeMillis();
                startX = pointParams.x;
                startY = pointParams.y;
                dragging = false;
                longPressTriggered = false;
                gestureCenterX = pointParams.x + pointSize / 2f;
                gestureCenterY = pointParams.y + pointSize / 2f;
                lastGestureAngle = Math.atan2(event.getRawY() - gestureCenterY, event.getRawX() - gestureCenterX);
                accumulatedGestureAngle = 0d;
                gestureAngleSamples = 0;
                pendingLongPress = this::enterMoveMode;
                handler.postDelayed(pendingLongPress, LONG_PRESS_MS);
                return true;

            case MotionEvent.ACTION_MOVE:
                float moveDx = event.getRawX() - downRawX;
                float moveDy = event.getRawY() - downRawY;
                double moveDistance = Math.hypot(moveDx, moveDy);
                if (overlayState != OverlayState.MOVE) updateCircularGesture(event.getRawX(), event.getRawY());
                if (overlayState == OverlayState.MOVE) {
                    dragging = true;
                    moveCi(startX + Math.round(moveDx), startY + Math.round(moveDy));
                } else if (moveDistance > dp(22)) {
                    cancelLongPress();
                }
                return true;

            case MotionEvent.ACTION_UP:
                cancelLongPress();
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                long duration = System.currentTimeMillis() - downTime;
                double distance = Math.hypot(dx, dy);
                if (overlayState == OverlayState.MOVE) {
                    finishMove();
                } else if (isCircularGesture() && duration <= 1800L) {
                    animateCircularGesture(accumulatedGestureAngle > 0d);
                } else if (distance <= touchSlop && duration < 650) {
                    handleTap();
                } else if (distance >= dp(32) && duration <= SWIPE_MAX_MS) {
                    animateSwipe(dx, dy, duration);
                }
                return true;

            case MotionEvent.ACTION_CANCEL:
                cancelLongPress();
                if (overlayState == OverlayState.MOVE) finishMove();
                return true;

            default:
                return true;
        }
    }

    private void cancelLongPress() {
        if (pendingLongPress != null && handler != null) {
            handler.removeCallbacks(pendingLongPress);
            pendingLongPress = null;
        }
    }

    private void handleTap() {
        long now = System.currentTimeMillis();
        if (lastTapUpTime > 0 && now - lastTapUpTime <= DOUBLE_TAP_MS) {
            lastTapUpTime = 0;
            if (pendingSingleTap != null) handler.removeCallbacks(pendingSingleTap);
            pendingSingleTap = null;
            performVoiceDoubleClick();
            return;
        }
        lastTapUpTime = now;
        pendingSingleTap = () -> {
            lastTapUpTime = 0;
            pendingSingleTap = null;
            if (overlayState == OverlayState.HIDDEN) revealFromHidden(false);
            else if (overlayState == OverlayState.DOCKED) undock(true);
            else performCiClick();
        };
        handler.postDelayed(pendingSingleTap, DOUBLE_TAP_MS);
    }

    private void enterMoveMode() {
        if (activePoint == null || ciLogo == null) return;
        if (overlayState == OverlayState.DOCKED || overlayState == OverlayState.HIDDEN) {
            DisplayMetrics metrics = new DisplayMetrics();
            windowManager.getDefaultDisplay().getRealMetrics(metrics);
            int x = "left".equals(dockSide) ? edgeInset : metrics.widthPixels - pointSize - edgeInset;
            moveCi(x, pointParams.y);
            if (prefs != null) prefs.edit().putBoolean(PREF_HIDDEN, false).apply();
            startX = pointParams.x;
            startY = pointParams.y;
        }
        longPressTriggered = true;
        setState(OverlayState.MOVE);
        vibrate();
        ciLogo.animate().cancel();
        ciLogo.animate().alpha(1f).scaleX(1.08f).scaleY(1.08f)
                .rotationX(-4f).translationZ(dp(18)).setDuration(150).start();
    }

    private void moveCi(int requestedX, int requestedY) {
        if (windowManager == null || activePoint == null || ciLogo == null) return;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        int x = clampX(requestedX, metrics.widthPixels);
        int y = clampY(requestedY, metrics.heightPixels);
        pointParams.x = x;
        pointParams.y = y;
        logoParams.x = x;
        logoParams.y = y;
        windowManager.updateViewLayout(activePoint, pointParams);
        windowManager.updateViewLayout(ciLogo, logoParams);
    }

    private int clampX(int value, int width) {
        return Math.max(edgeInset, Math.min(value, width - pointSize - edgeInset));
    }

    private int clampY(int value, int height) {
        return Math.max(edgeInset, Math.min(value, height - pointSize - edgeInset));
    }

    private void savePosition() {
        if (prefs == null || pointParams == null) return;
        prefs.edit().putInt(PREF_X, pointParams.x).putInt(PREF_Y, pointParams.y).apply();
    }

    private void finishMove() {
        if (pointParams == null) return;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        int trigger = dp(42);
        if (pointParams.x <= edgeInset + trigger) {
            dockTo("left");
        } else if (pointParams.x >= metrics.widthPixels - pointSize - edgeInset - trigger) {
            dockTo("right");
        } else {
            savePosition();
            setState(OverlayState.PASSIVE);
            animateWindowTo(pointParams.x, pointParams.y, true, null);
        }
        dragging = false;
        longPressTriggered = false;
    }

    private void dockTo(String side) {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        dockSide = side;
        if (prefs != null) prefs.edit().putString(PREF_DOCK_SIDE, side).putString(PREF_STATE, OverlayState.DOCKED.name()).apply();
        int targetX = "left".equals(side) ? -Math.round(pointSize * 0.42f) : metrics.widthPixels - Math.round(pointSize * 0.58f);
        int targetY = clampY(pointParams.y, metrics.heightPixels);
        animateWindowTo(targetX, targetY, true, () -> {
            savePosition();
            setState(OverlayState.DOCKED);
        });
    }

    private void undock(boolean invokeAfter) {
        if (pointParams == null) return;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        int targetX = "left".equals(dockSide) ? edgeInset : metrics.widthPixels - pointSize - edgeInset;
        int targetY = clampY(pointParams.y, metrics.heightPixels);
        animateWindowTo(targetX, targetY, true, () -> {
            savePosition();
            setState(OverlayState.PASSIVE);
            if (invokeAfter) handler.postDelayed(this::performCiClick, 80L);
        });
    }

    private int dockX(int width) {
        if ("left".equals(dockSide)) return -Math.round(pointSize * 0.42f);
        if ("right".equals(dockSide)) return width - Math.round(pointSize * 0.58f);
        return clampX(prefs != null ? prefs.getInt(PREF_X, edgeInset) : edgeInset, width);
    }

    private int hiddenX(int width) {
        int visible = dp(HIDDEN_VISIBLE_DP);
        if ("left".equals(dockSide)) return -pointSize + visible;
        return width - visible;
    }

    private void revealFromHidden(boolean invokeAfter) {
        if (pointParams == null) return;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        if (prefs != null) prefs.edit().putBoolean(PREF_HIDDEN, false).apply();
        int targetX = dockX(metrics.widthPixels);
        int targetY = clampY(pointParams.y, metrics.heightPixels);
        animateWindowTo(targetX, targetY, true, () -> {
            setState(OverlayState.DOCKED);
            if (invokeAfter) handler.postDelayed(() -> undock(true), 80L);
        });
    }

    private void animateWindowTo(int targetX, int targetY, boolean spring, Runnable endAction) {
        if (pointParams == null || logoParams == null || activePoint == null || ciLogo == null) return;
        int fromX = pointParams.x;
        int fromY = pointParams.y;
        ValueAnimator animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(spring ? 280L : 190L);
        if (spring) animator.setInterpolator(new OvershootInterpolator(0.72f));
        animator.addUpdateListener(a -> {
            float f = (float) a.getAnimatedValue();
            int x = Math.round(fromX + (targetX - fromX) * f);
            int y = Math.round(fromY + (targetY - fromY) * f);
            pointParams.x = x; pointParams.y = y;
            logoParams.x = x; logoParams.y = y;
            try {
                windowManager.updateViewLayout(activePoint, pointParams);
                windowManager.updateViewLayout(ciLogo, logoParams);
            } catch (Exception ignored) { }
        });
        if (endAction != null) animator.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator animation) { endAction.run(); }
        });
        animator.start();
    }

    private OverlayState stableStateFromPrefs() {
        String saved = prefs != null ? prefs.getString(PREF_STATE, OverlayState.PASSIVE.name()) : OverlayState.PASSIVE.name();
        return OverlayState.DOCKED.name().equals(saved) ? OverlayState.DOCKED : OverlayState.PASSIVE;
    }

    private void setState(OverlayState next) {
        overlayState = next;
        if (prefs != null && (next == OverlayState.PASSIVE || next == OverlayState.DOCKED)) {
            prefs.edit().putString(PREF_STATE, next.name()).apply();
        }
        applyStateVisual(true);
    }

    private void applyStateVisual(boolean animate) {
        if (ciLogo == null) return;
        cancelPassiveBreath();
        ciLogo.animate().cancel();
        long d = animate ? 150L : 0L;
        float scale = 1f, alpha = 0.96f, z = dp(8);
        if (overlayState == OverlayState.DOCKED) { scale = 0.94f; alpha = 0.80f; z = dp(5); }
        if (overlayState == OverlayState.HIDDEN) { scale = 0.82f; alpha = 0.34f; z = dp(2); }
        if (overlayState == OverlayState.MOVE) { scale = 1.08f; alpha = 1f; z = dp(18); }
        if (overlayState == OverlayState.CONTEXT || overlayState == OverlayState.PULSE) { scale = 1.06f; alpha = 1f; z = dp(20); }
        ciLogo.animate().alpha(alpha).scaleX(scale).scaleY(scale).rotationX(0f).rotationY(0f).translationZ(z).setDuration(d).start();
        if (overlayState == OverlayState.PASSIVE || overlayState == OverlayState.DOCKED) schedulePassiveBreath();
    }

    private void schedulePassiveBreath() {
        if (handler == null || ciLogo == null) return;
        cancelPassiveBreath();
        passiveBreath = () -> {
            if (ciLogo == null || (overlayState != OverlayState.PASSIVE && overlayState != OverlayState.DOCKED)) return;
            float base = overlayState == OverlayState.DOCKED ? 0.94f : 1f;
            float alpha = overlayState == OverlayState.DOCKED ? 0.80f : 0.96f;
            ciLogo.animate().scaleX(base + 0.018f).scaleY(base + 0.018f).alpha(Math.min(1f, alpha + 0.03f)).setDuration(1200)
                    .withEndAction(() -> ciLogo.animate().scaleX(base).scaleY(base).alpha(alpha).setDuration(1350)
                            .withEndAction(this::schedulePassiveBreath).start()).start();
        };
        handler.postDelayed(passiveBreath, 650L);
    }

    private void cancelPassiveBreath() {
        if (passiveBreath != null && handler != null) handler.removeCallbacks(passiveBreath);
        passiveBreath = null;
    }

    private void animateSwipe(float dx, float dy, long duration) {
        String direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "down" : "up");
        if (overlayState == OverlayState.HIDDEN) {
            boolean inward = ("left".equals(dockSide) && "right".equals(direction))
                    || ("right".equals(dockSide) && "left".equals(direction));
            emitGesture(dx, dy, duration, direction);
            if (inward) revealFromHidden(false);
            return;
        }
        if (overlayState == OverlayState.DOCKED) {
            boolean outward = ("left".equals(dockSide) && "left".equals(direction)) || ("right".equals(dockSide) && "right".equals(direction));
            boolean inward = ("left".equals(dockSide) && "right".equals(direction)) || ("right".equals(dockSide) && "left".equals(direction));
            if (outward) { emitGesture(dx, dy, duration, direction); pulseThenHide(); return; }
            if (inward) { emitGesture(dx, dy, duration, direction); undock(false); return; }
        }
        OverlayState returnState = stableStateFromPrefs();
        setState(OverlayState.PULSE);
        float distance = dp(15);
        float tx = 0f, ty = 0f, rx = 0f, ry = 0f;
        if ("left".equals(direction)) { tx = -distance; ry = -7f; }
        if ("right".equals(direction)) { tx = distance; ry = 7f; }
        if ("up".equals(direction)) { ty = -distance; rx = 7f; }
        if ("down".equals(direction)) { ty = distance; rx = -7f; }
        final float ftx = tx, fty = ty, frx = rx, fry = ry;
        ciLogo.animate().translationX(ftx).translationY(fty).rotationX(frx).rotationY(fry).scaleX(1.05f).scaleY(1.05f).setDuration(105)
                .withEndAction(() -> ciLogo.animate().translationX(0f).translationY(0f).rotationX(0f).rotationY(0f)
                        .scaleX(1f).scaleY(1f).setDuration(180)
                        .withEndAction(() -> setState(returnState)).start()).start();
        emitGesture(dx, dy, duration, direction);
    }

    private void updateCircularGesture(float rawX, float rawY) {
        double radius = Math.hypot(rawX - gestureCenterX, rawY - gestureCenterY);
        if (radius < dp(10)) return;
        double angle = Math.atan2(rawY - gestureCenterY, rawX - gestureCenterX);
        double delta = angle - lastGestureAngle;
        while (delta > Math.PI) delta -= Math.PI * 2d;
        while (delta < -Math.PI) delta += Math.PI * 2d;
        if (Math.abs(delta) < 1.35d) {
            accumulatedGestureAngle += delta;
            gestureAngleSamples++;
        }
        lastGestureAngle = angle;
    }

    private boolean isCircularGesture() {
        return gestureAngleSamples >= 6 && Math.abs(accumulatedGestureAngle) >= 4.2d;
    }

    private void animateCircularGesture(boolean clockwise) {
        if (ciLogo == null) return;
        String semantic = clockwise ? "restore_context" : "collapse_all";
        setState(OverlayState.PULSE);
        float rotation = clockwise ? 180f : -180f;
        float midScale = clockwise ? 1.14f : 0.76f;
        ciLogo.animate().rotation(rotation).scaleX(midScale).scaleY(midScale)
                .alpha(clockwise ? 1f : 0.52f).translationZ(clockwise ? dp(26) : dp(2))
                .setDuration(230).withEndAction(() -> ciLogo.animate()
                        .rotation(0f).scaleX(1f).scaleY(1f).alpha(0.96f).translationZ(dp(8))
                        .setDuration(280).withEndAction(() -> setState(stableStateFromPrefs())).start()).start();
        emitSemanticGesture(semantic, clockwise ? "clockwise" : "counterclockwise");
    }

    private void animateSemanticNudge(String direction, String semantic) {
        float distance = dp(15);
        float tx = 0f, ty = 0f, rx = 0f, ry = 0f;
        if ("left".equals(direction)) { tx = -distance; ry = -7f; }
        if ("right".equals(direction)) { tx = distance; ry = 7f; }
        if ("up".equals(direction)) { ty = -distance; rx = 7f; }
        if ("down".equals(direction)) { ty = distance; rx = -7f; }
        final float ftx = tx, fty = ty, frx = rx, fry = ry;
        setState(OverlayState.PULSE);
        if (ciLogo != null) ciLogo.animate().translationX(ftx).translationY(fty).rotationX(frx).rotationY(fry)
                .setDuration(110).withEndAction(() -> ciLogo.animate().translationX(0f).translationY(0f)
                        .rotationX(0f).rotationY(0f).setDuration(180)
                        .withEndAction(() -> setState(stableStateFromPrefs())).start()).start();
        emitSemanticGesture(semantic, direction);
    }

    private void emitSemanticGesture(String semantic, String direction) {
        Intent event = new Intent(ACTION_CI_GESTURE);
        event.putExtra("semantic", semantic);
        event.putExtra("direction", direction);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-overlay-v3");
        sendBroadcast(event);
    }

    private void pulseThenHide() {
        if (ciLogo == null) { hideCi(); return; }
        setState(OverlayState.PULSE);
        float tx = "left".equals(dockSide) ? -dp(18) : dp(18);
        ciLogo.animate().translationX(tx).alpha(0.16f).scaleX(0.82f).scaleY(0.82f).setDuration(150)
                .withEndAction(this::hideCi).start();
    }

    private void performCiClick() {
        vibrate();
        setState(OverlayState.CONTEXT);
        if (ciLogo != null) {
            ciLogo.animate().alpha(0.48f).scaleX(0.90f).scaleY(0.90f).translationZ(dp(2)).setDuration(80)
                    .withEndAction(() -> ciLogo.animate().alpha(1f).scaleX(1.07f).scaleY(1.07f).translationZ(dp(20))
                            .setDuration(145).start()).start();
        }
        Intent event = new Intent(ACTION_CI_CLICK);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-overlay-v3");
        event.putExtra("action", "invoke-ci-context");
        sendBroadcast(event);
        handler.postDelayed(() -> setState(stableStateFromPrefs()), 420L);
    }

    private void emitGesture(float dx, float dy, long duration, String direction) {
        Intent event = new Intent(ACTION_CI_GESTURE);
        event.putExtra("dx", dx);
        event.putExtra("dy", dy);
        event.putExtra("duration", duration);
        event.putExtra("direction", direction);
        String semantic = "right".equals(direction) ? "previous"
                : ("left".equals(direction) ? "next"
                : ("up".equals(direction) ? "tools" : "collapse_current"));
        event.putExtra("semantic", semantic);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        sendBroadcast(event);
    }

    private void performVoiceDoubleClick() {
        vibrate();
        if (voiceController == null) {
            handleVoiceError("voice_controller_unavailable");
            return;
        }
        voiceController.toggle();
    }

    private void handleVoiceListening(boolean listening) {
        setState(listening ? OverlayState.CONTEXT : OverlayState.PULSE);
        if (ciLogo == null) return;
        ciLogo.animate().cancel();
        if (listening) {
            ciLogo.animate().alpha(1f).scaleX(1.12f).scaleY(1.12f)
                    .translationZ(dp(26)).setDuration(160).start();
        } else {
            ciLogo.animate().alpha(0.96f).scaleX(1.04f).scaleY(1.04f)
                    .translationZ(dp(16)).setDuration(180).start();
        }
    }

    private void handleVoiceTranscript(String text) {
        setState(OverlayState.PULSE);
        Intent event = new Intent(ACTION_CI_CLICK);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-overlay-v3");
        event.putExtra("action", "voice-transcript");
        event.putExtra("text", text);
        sendBroadcast(event);
    }

    private void handleVoiceResult(org.json.JSONObject result) {
        String action = result.optString("action", "answer");
        Intent event = new Intent(ACTION_CI_RESULT);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-overlay-v3");
        event.putExtra("action", action);
        event.putExtra("result", result.toString());
        sendBroadcast(event);
        if ("open_gpt".equals(action)) {
            launchCiGpt();
        } else if ("previous".equals(action)) {
            animateSemanticNudge("right", "previous");
        } else if ("next".equals(action)) {
            animateSemanticNudge("left", "next");
        } else if ("tools".equals(action)) {
            animateSemanticNudge("up", "tools");
        } else if ("collapse_current".equals(action)) {
            animateSemanticNudge("down", "collapse_current");
        } else if ("collapse_all".equals(action)) {
            animateCircularGesture(false);
        } else if ("restore_context".equals(action)) {
            animateCircularGesture(true);
        } else {
            pulseResult();
        }
    }

    private void handleVoiceError(String error) {
        Intent event = new Intent(ACTION_CI_RESULT);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-overlay-v3");
        event.putExtra("action", "error");
        event.putExtra("error", error);
        sendBroadcast(event);
        pulseError();
    }

    private void pulseResult() {
        if (ciLogo == null) return;
        setState(OverlayState.PULSE);
        ciLogo.animate().scaleX(1.13f).scaleY(1.13f).alpha(1f).translationZ(dp(24))
                .setDuration(120).withEndAction(() -> ciLogo.animate()
                        .scaleX(1f).scaleY(1f).alpha(0.96f).translationZ(dp(8))
                        .setDuration(260).withEndAction(() -> setState(stableStateFromPrefs())).start()).start();
    }

    private void pulseError() {
        if (ciLogo == null) return;
        setState(OverlayState.PULSE);
        ciLogo.animate().rotation(-7f).setDuration(70).withEndAction(() -> ciLogo.animate()
                .rotation(7f).setDuration(90).withEndAction(() -> ciLogo.animate()
                        .rotation(0f).setDuration(90).withEndAction(() -> setState(stableStateFromPrefs())).start()).start()).start();
    }

    private void launchChatGpt() {
        launchCiGpt();
    }

    private void launchCiGpt() {
        Intent app = new Intent(Intent.ACTION_VIEW, Uri.parse(CI_GPT_URL));
        app.setPackage(CHATGPT_PACKAGE);
        app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(app);
            return;
        } catch (Exception ignored) {
        }
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse(CI_GPT_URL));
        web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(web);
    }

    private void hideCi() {
        if (pointParams == null || ciLogo == null) return;
        if (prefs != null) prefs.edit().putBoolean(PREF_HIDDEN, true).apply();
        cancelLongPress();
        cancelPassiveBreath();
        if (pendingSingleTap != null && handler != null) handler.removeCallbacks(pendingSingleTap);
        pendingSingleTap = null;
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        if (!"left".equals(dockSide) && !"right".equals(dockSide)) {
            dockSide = pointParams.x + pointSize / 2 < metrics.widthPixels / 2 ? "left" : "right";
            if (prefs != null) prefs.edit().putString(PREF_DOCK_SIDE, dockSide).apply();
        }
        int targetX = hiddenX(metrics.widthPixels);
        int targetY = clampY(pointParams.y, metrics.heightPixels);
        overlayState = OverlayState.HIDDEN;
        animateWindowTo(targetX, targetY, false, () -> applyStateVisual(true));
    }

    private void detachCiViews() {
        removeOverlay(activePoint);
        removeOverlay(ciLogo);
        activePoint = null;
        ciLogo = null;
        pointParams = null;
        logoParams = null;
    }

    private void showLogo() {
        if (ciLogo == null) return;
        applyStateVisual(true);
    }

    private void removeOverlay(View view) {
        if (view == null) return;
        try {
            windowManager.removeView(view);
        } catch (Exception ignored) {
        }
    }

    private void vibrate() {
        Vibrator vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(24, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(24);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Сі",
                    NotificationManager.IMPORTANCE_MIN
            );
            channel.setDescription("Активна точка Сі");
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return builder
                .setContentTitle("Сі")
                .setContentText("Активна точка працює")
                .setSmallIcon(R.drawable.ci_notification)
                .setOngoing(true)
                .build();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

