package ua.cimeika.cipoint;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.net.Uri;
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
    public static final String ACTION_CI_GESTURE = "ua.cimeika.ci.action.GESTURE";

    private static final String CHANNEL_ID = "ci_active_point";
    private static final int NOTIFICATION_ID = 7;
    private static final String CHATGPT_PACKAGE = "com.openai.chatgpt";

    private WindowManager windowManager;
    private View activePoint;
    private ImageView ciLogo;
    private WindowManager.LayoutParams pointParams;
    private WindowManager.LayoutParams logoParams;

    private int pointSize;
    private int edgeInset;
    private int bottomInset;
    private int touchSlop;

    private float downRawX;
    private float downRawY;
    private long downTime;

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
        pointSize = dp(72);
        edgeInset = dp(18);
        bottomInset = dp(120);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();

        if (Settings.canDrawOverlays(this)) {
            attachCi();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (windowManager == null) {
            return START_NOT_STICKY;
        }
        if (activePoint == null && Settings.canDrawOverlays(this)) {
            attachCi();
        }
        if (intent != null && ACTION_SHOW.equals(intent.getAction())) {
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
        removeOverlay(activePoint);
        removeOverlay(ciLogo);
        activePoint = null;
        ciLogo = null;
        super.onDestroy();
    }

    private void attachCi() {
        DisplayMetrics metrics = new DisplayMetrics();
        windowManager.getDefaultDisplay().getRealMetrics(metrics);

        int x = Math.max(0, metrics.widthPixels - pointSize - edgeInset);
        int y = Math.max(0, metrics.heightPixels - pointSize - bottomInset);

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
                return true;

            case MotionEvent.ACTION_UP:
                float dx = event.getRawX() - downRawX;
                float dy = event.getRawY() - downRawY;
                long duration = System.currentTimeMillis() - downTime;
                double distance = Math.hypot(dx, dy);

                if (distance <= touchSlop && duration < 650) {
                    performCiClick();
                } else {
                    emitGesture(dx, dy, duration);
                }
                return true;

            case MotionEvent.ACTION_CANCEL:
                return true;

            default:
                return true;
        }
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

    private void emitGesture(float dx, float dy, long duration) {
        Intent event = new Intent(ACTION_CI_GESTURE);
        event.putExtra("dx", dx);
        event.putExtra("dy", dy);
        event.putExtra("duration", duration);
        event.putExtra("timestamp", System.currentTimeMillis());
        event.putExtra("source", "ci-active-point");
        sendBroadcast(event);
    }

    private void launchChatGpt() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(CHATGPT_PACKAGE);
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
            return;
        }

        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/"));
        web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(web);
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
                .setSmallIcon(android.R.drawable.presence_online)
                .setOngoing(true)
                .build();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
