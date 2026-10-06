package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

final class CiEndpointConfig {
    private static final String PREFS = "ci_point";
    private static final String PREF_AI_ENDPOINT = "local_ai_endpoint";
    private static final String PREF_LAST_LIVE_AT = "local_ai_endpoint_live_at";
    private static final String LEGACY_ENDPOINT = "http://192.168.1.38:8791/ci/intent";
    private static final String CURRENT_CLEAR_TEXT_LAN_HOST = "192.168.1.54";

    private CiEndpointConfig() { }

    static List<String> candidates(Context context, String path) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        String configured = prefs.getString(PREF_AI_ENDPOINT, "");
        addCandidate(values, configured, path);
        addCandidate(values, BuildConfig.CI_OPERATOR_BASE_URL, path);

        return new ArrayList<>(values);
    }

    static void remember(Context context, String workingEndpoint) {
        String base = normalizedBase(workingEndpoint);
        if (base.isEmpty()) return;

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_AI_ENDPOINT, base)
                .putLong(PREF_LAST_LIVE_AT, System.currentTimeMillis())
                .apply();
    }

    static long lastLiveAt(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getLong(PREF_LAST_LIVE_AT, 0L);
    }

    static String lastLiveBase(Context context) {
        String value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(PREF_AI_ENDPOINT, "");
        return normalizedBase(value == null ? "" : value);
    }

    private static void addCandidate(
            LinkedHashSet<String> values,
            String raw,
            String path) {
        if (raw == null) return;
        String clean = raw.trim();
        if (clean.isEmpty() || LEGACY_ENDPOINT.equals(clean)) return;

        String base = normalizedBase(clean);
        if (!base.isEmpty()) {
            values.add(base + path);
        }
    }

    private static String normalizedBase(String raw) {
        try {
            URI uri = URI.create(raw.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null || uri.getUserInfo() != null) return "";

            String normalizedScheme = scheme.toLowerCase(Locale.ROOT);
            if (!"https".equals(normalizedScheme)
                    && !("http".equals(normalizedScheme) && isAllowedLanHost(host))) {
                return "";
            }

            String basePath = uri.getRawPath();
            if (basePath == null || "/".equals(basePath)) {
                basePath = "";
            } else {
                int marker = basePath.indexOf("/ci/");
                if (marker >= 0) basePath = basePath.substring(0, marker);
                basePath = basePath.replaceAll("/+$", "");
                if (!basePath.isEmpty() && !basePath.startsWith("/")) return "";
            }

            return origin(uri, normalizedScheme) + basePath;
        } catch (Exception ignored) { }
        return "";
    }

    private static String origin(URI uri, String scheme) {
        String host = uri.getHost();
        if (host == null || host.isEmpty()) return "";
        int port = uri.getPort();
        return scheme + "://" + host + (port >= 0 ? ":" + port : "");
    }

    private static boolean isAllowedLanHost(String host) {
        return CURRENT_CLEAR_TEXT_LAN_HOST.equalsIgnoreCase(host);
    }
}
