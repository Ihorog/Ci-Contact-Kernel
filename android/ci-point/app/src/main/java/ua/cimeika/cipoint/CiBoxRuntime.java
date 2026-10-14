package ua.cimeika.cipoint;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;

/**
 * First-party Ci entry point to the locally installed Box runtime.
 *
 * Box does not expose a confirmed exported inference API. This adapter only
 * opens the already installed app; it does not read Box private data, access
 * model files, or claim to relay inference responses back to Ci Point.
 */
final class CiBoxRuntime {
    static final String PACKAGE_NAME = "com.box.gallery";
    private final Context context;

    CiBoxRuntime(Context context) {
        this.context = context.getApplicationContext();
    }

    boolean isInstalled() {
        return context.getPackageManager().getLaunchIntentForPackage(PACKAGE_NAME) != null;
    }

    boolean open() {
        PackageManager packages = context.getPackageManager();
        Intent intent = packages.getLaunchIntentForPackage(PACKAGE_NAME);
        if (intent == null) return false;

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try {
            // The user explicitly initiated this from the floating Ci point.
            context.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException ignored) {
            return false;
        }
    }
}
