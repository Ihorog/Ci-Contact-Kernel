package ua.cimeika.cipoint;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
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
    public static final String ACTION_CI_CLICK = "ua.cimeika.ci.action.CLICK";

    private static final String CHANNEL_ID = "ci_active_point";
    private static final int NOTIFICATION_ID = 7;
    private static final String PREFS = "ci_point";

    private WindowManager windowManager;
    private ImageView ciView;
    private WindowManager.LayoutParams params;
    private SharedPreferences prefs;

    private int normalSize;
    private int hiddenSize;
    private int edgeInset;
    private int bottomInset;
    private int touchSlop;
    private int previousX;
    private int previousY;
    private boolean hidden;

    private float downRawX;
    private float downRawY;
    private int downWindowX;
    private int downWindowY;
    private long downTime;
    private boolean dragging;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(NOTIFICATION_ID, buildNotification());

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        normalSize = dp(72);
        hiddenSize = dp(22);
        edgeInset = dp(18);
        bottomInset = dp(120);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();

        if (Settings.canDrawOverlays(this)) {
            attachCi();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (ciView == null && Settings.canDrawOverlays(this)) {
            attachCi();
        }
        if (intent != null && ACTION_SHOW.equals(intent.getAction())) {
            showCi();
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (ciView != null) {
            try {
                windowManager.removeView(ciView);
            } catch (Exception ignored) {
            }
            ciView = null;
        }
        super.onDestroy();
    }

    private void attachCi() {
        ciView = new ImageView(this);
        ciView.setImageResource(R.drawable.ci_logo);
        ciView.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        ciView.setBackgroundColor(android.graphics.Color.TRANSPARENT);
        ciView.setContentDescription("Сі");
        ciView.setAlpha(0.96f);

        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);

        int defaultX = Math.max(0, metrics.widthPixels - normalSize - edgeInset);
        int defaultY = Math.max(0, metrics.heightPixels - normalSize - bottomInset);
        int x = prefs.getInt("x", defaultX);
        int y = prefs.getInt("y", defaultY);

        params = new WindowManager.LayoutParams(
                normalSize,
                normalSize,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = clamp(x, 0, Math.max(0, metrics.widthPixels - normalSize));
        params.y = clamp(y, 0, Math.max(0, metrics.heightPixels - normalSize));

        ciView.setOnTouchListener(this::onTouch);
        windowManager.addView(ciView, params);
    }

    private boolean onTouch(View view, MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = event.getRawX();
                downRawY = event.getRawY();
                downWindowX = params.x;
                downWindowY = params.y;
                downTime = System.currentTimeMillis();
                dragging = false;
                return true;

            case MotionEvent.ACTION_MOVE:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;

                if (hidden) {
                    if (Math.hypot(dx, dy) > dp(26)) {
                        showCi();
                    }
                    return true;
                }

                if (!dragging && Math.hypot(dx, dy) > touchSlop) {
                    dragging = true;
                }
                if (dragging) {
                    moveTo(downWindowX + Math.round(dx), downWindowY + Math.round(dy));
                }
                return true;

            case MotionEvent.ACTION_UP:
                long duration = System.currentTimeMillis() - downTime;
                float totalDx = event.getRawX() - downRawX;
                float totalDy = event.getRawY() - downRawY;
                double distance = Math.hypot(totalDx, totalDy);

                if (hidden) {
                    if (distance <= dp(26) || duration < 700) {
                        showCi();
                    }
                    return true;
                }

                if (dragging) {
                    prefs.edit().putInt("x", params.x).putInt("y", params.y).apply();
                } else if (duration >= 650) {
                    hideCi();
                } else {
                    performCiClick();
                }
                return true;

            case MotionEvent.ACTION_CANCEL:
                return true;

            default:
                return false;
        }
    }

    private void performCiClick() {
        boolean nextState = !prefs.getBoolean("state", false);
        prefs.edit().putBoolean("state", nextState).apply();

        vibrate();
        ciView.animate()
                .alpha(0.38f)
                .scaleX(0.86f)
                .scaleY(0.86f)
                .setDuration(90)
                .withEndAction(() -> ciView.animate()
                        .alpha(0.96f)
                        .scaleX(1f)
                        .scaleY(1f)
                        .setDuration(170)
                        .start())
                .start();

        Intent event = new Intent(ACTION_CI_CLICK);
        event.putExtra("state", nextState);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        sendBroadcast(event);
    }

    private void hideCi() {
        if (ciView == null || hidden) return;

        previousX = params.x;
        previousY = params.y;
        hidden = true;

        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        params.width = hiddenSize;
        params.height = dp(110);
        params.x = Math.max(0, metrics.widthPixels - hiddenSize);
        params.y = Math.max(0, metrics.heightPixels - params.height - dp(80));
        ciView.setAlpha(0f);
        windowManager.updateViewLayout(ciView, params);
    }

    private void showCi() {
        if (ciView == null) return;

        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);

        if (hidden) {
            params.width = normalSize;
            params.height = normalSize;
            params.x = clamp(previousX, 0, Math.max(0, metrics.widthPixels - normalSize));
            params.y = clamp(previousY, 0, Math.max(0, metrics.heightPixels - normalSize));
            hidden = false;
        }

        ciView.setAlpha(0f);
        windowManager.updateViewLayout(ciView, params);
        ciView.animate().alpha(0.96f).setDuration(180).start();
    }

    private void moveTo(int x, int y) {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);
        params.x = clamp(x, 0, Math.max(0, metrics.widthPixels - params.width));
        params.y = clamp(y, 0, Math.max(0, metrics.heightPixels - params.height));
        windowManager.updateViewLayout(ciView, params);
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
                .setSmallIcon(android.R.drawable.presence_online)
                .setOngoing(true)
                .build();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
