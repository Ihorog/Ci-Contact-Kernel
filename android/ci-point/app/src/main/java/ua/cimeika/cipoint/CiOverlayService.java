package ua.cimeika.cipoint;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
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
import android.widget.ImageView;

public final class CiOverlayService extends Service {
    public static final String ACTION_SHOW = "ua.cimeika.cipoint.SHOW";
    public static final String ACTION_HIDE = "ua.cimeika.cipoint.HIDE";
    public static final String ACTION_CI_CLICK = "ua.cimeika.ci.action.CLICK";
    public static final String ACTION_CI_GESTURE = "ua.cimeika.ci.action.GESTURE";

    private static final String CHANNEL_ID = "ci_active_point";
    private static final int NOTIFICATION_ID = 7;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";
    private static final String CI_GPT_URL = "https://chatgpt.com/g/g-Uc7qoEi2e";
    private static final String PREFS = "ci_point";
    private static final String PREF_X = "x";
    private static final String PREF_Y = "y";
    private static final String PREF_HIDDEN = "hidden";
    private static final long LONG_PRESS_MS = 700L;
    private static final long DRAG_ARM_MS = 180L;
    private static final long SWIPE_MAX_MS = 520L;
    private static final long DOUBLE_TAP_MS = 320L;

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
        pointSize = dp(72);
        edgeInset = dp(18);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();

        if (Settings.canDrawOverlays(this) && !prefs.getBoolean(PREF_HIDDEN, false)) {
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
        if (ACTION_SHOW.equals(action) && prefs != null) {
            prefs.edit().putBoolean(PREF_HIDDEN, false).apply();
        }
        boolean hidden = prefs != null && prefs.getBoolean(PREF_HIDDEN, false);
        if (activePoint == null && Settings.canDrawOverlays(this) && !hidden) {
            attachCi();
        }
        if (ACTION_SHOW.equals(action)) {
            showLogo();
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
        if (pendingSingleTap != null && handler != null) handler.removeCallbacks(pendingSingleTap);
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
        int x = clampX(savedX, metrics.widthPixels);
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

        logoParams = overlayParams(pointSize, pointSize, x, y,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        windowManager.addView(ciLogo, logoParams);
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
                pendingLongPress = this::hideIfStillPressed;
                handler.postDelayed(pendingLongPress, LONG_PRESS_MS);
                return true;

            case MotionEvent.ACTION_MOVE:
                float moveDx = event.getRawX() - downRawX;
                float moveDy = event.getRawY() - downRawY;
                long elapsed = System.currentTimeMillis() - downTime;
                double moveDistance = Math.hypot(moveDx, moveDy);
                if (moveDistance > touchSlop) {
                    cancelLongPress();
                    if (!dragging && elapsed >= DRAG_ARM_MS) dragging = true;
                    if (dragging) moveCi(startX + Math.round(moveDx), startY + Math.round(moveDy));
                }
                return true;

            case MotionEvent.ACTION_UP:
                cancelLongPress();
                if (longPressTriggered) return true;
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                long duration = System.currentTimeMillis() - downTime;
                double distance = Math.hypot(dx, dy);
                if (dragging) {
                    savePosition();
                    settleAfterMove();
                } else if (distance <= touchSlop && duration < 650) {
                    handleTap();
                } else if (distance >= dp(32) && duration <= SWIPE_MAX_MS) {
                    animateSwipe(dx, dy, duration);
                }
                return true;

            case MotionEvent.ACTION_CANCEL:
                cancelLongPress();
                if (dragging) savePosition();
                return true;

            default:
                return true;
        }
    }

    private void cancelLongPress() {
        if (pendingLongPress != null) {
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
            performCiClick();
        };
        handler.postDelayed(pendingSingleTap, DOUBLE_TAP_MS);
    }

    private void hideIfStillPressed() {
        if (!dragging && activePoint != null) {
            longPressTriggered = true;
            hideCi();
        }
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

    private void settleAfterMove() {
        if (ciLogo == null) return;
        ciLogo.animate().scaleX(1.03f).scaleY(1.03f).setDuration(90)
                .withEndAction(() -> ciLogo.animate().scaleX(1f).scaleY(1f).setDuration(120).start())
                .start();
    }

    private void animateSwipe(float dx, float dy, long duration) {
        if (ciLogo == null) return;
        float distance = dp(14);
        float tx = 0f;
        float ty = 0f;
        String direction;
        if (Math.abs(dx) >= Math.abs(dy)) {
            tx = dx >= 0 ? distance : -distance;
            direction = dx >= 0 ? "right" : "left";
        } else {
            ty = dy >= 0 ? distance : -distance;
            direction = dy >= 0 ? "down" : "up";
        }
        final String dir = direction;
        ciLogo.animate().translationX(tx).translationY(ty).scaleX(1.04f).scaleY(1.04f).setDuration(110)
                .withEndAction(() -> ciLogo.animate().translationX(0f).translationY(0f).scaleX(1f).scaleY(1f)
                        .setDuration(170).start()).start();
        emitGesture(dx, dy, duration, dir);
    }

    private void performCiClick() {
        vibrate();
        if (ciLogo != null) {
            ciLogo.animate()
                    .alpha(0.35f)
                    .scaleX(0.88f)
                    .scaleY(0.88f)
                    .setDuration(80)
                    .withEndAction(() -> ciLogo.animate()
                            .alpha(0.96f)
                            .scaleX(1f)
                            .scaleY(1f)
                            .setDuration(150)
                            .start())
                    .start();
        }

        Intent event = new Intent(ACTION_CI_CLICK);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        event.putExtra("action", "invoke-gpt");
        sendBroadcast(event);

        launchChatGpt();
    }

    private void emitGesture(float dx, float dy, long duration, String direction) {
        Intent event = new Intent(ACTION_CI_GESTURE);
        event.putExtra("dx", dx);
        event.putExtra("dy", dy);
        event.putExtra("duration", duration);
        event.putExtra("direction", direction);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        sendBroadcast(event);
    }

    private void performVoiceDoubleClick() {
        vibrate();
        if (ciLogo != null) {
            ciLogo.animate().alpha(0.62f).scaleX(1.10f).scaleY(1.10f).setDuration(90)
                    .withEndAction(() -> ciLogo.animate().alpha(0.96f).scaleX(1f).scaleY(1f)
                            .setDuration(180).start()).start();
        }
        Intent event = new Intent(ACTION_CI_CLICK);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        event.putExtra("action", "invoke-ci-voice");
        event.putExtra("gpt", "Ci");
        sendBroadcast(event);
        launchCiGpt();
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
        if (prefs != null) prefs.edit().putBoolean(PREF_HIDDEN, true).apply();
        cancelLongPress();
        if (pendingSingleTap != null) handler.removeCallbacks(pendingSingleTap);
        pendingSingleTap = null;
        if (ciLogo != null) {
            ciLogo.animate().alpha(0f).scaleX(0.82f).scaleY(0.82f).setDuration(140)
                    .withEndAction(this::detachCiViews).start();
        } else {
            detachCiViews();
        }
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
        ciLogo.animate().alpha(0.96f).setDuration(160).start();
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

