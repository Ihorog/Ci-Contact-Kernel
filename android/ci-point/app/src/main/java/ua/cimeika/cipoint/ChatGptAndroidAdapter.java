package ua.cimeika.cipoint;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

final class ChatGptAndroidAdapter implements CiExternalAssistantAdapter {
    private static final String PACKAGE_NAME = "com.openai.chatgpt";
    private static final String WEB_URL = "https://chatgpt.com/";
    private final Context context;

    ChatGptAndroidAdapter(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override public String id() {
        return "chatgpt";
    }

    @Override public boolean isAvailable() {
        return context.getPackageManager().getLaunchIntentForPackage(PACKAGE_NAME) != null;
    }

    @Override public String open() {
        try {
            Intent app = context.getPackageManager().getLaunchIntentForPackage(PACKAGE_NAME);
            if (app != null) {
                app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(app);
                return "accepted_app";
            }
        } catch (Exception ignored) { }
        try {
            Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse(WEB_URL));
            web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(web);
            return "accepted_web";
        } catch (Exception ignored) {
            return "failed";
        }
    }
}
