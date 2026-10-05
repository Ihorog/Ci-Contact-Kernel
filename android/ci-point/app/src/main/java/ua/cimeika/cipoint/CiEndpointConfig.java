package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

final class CiEndpointConfig {
    private static final String PREFS = "ci_point";
    private static final String PREF_AI_ENDPOINT = "local_ai_endpoint";

    private CiEndpointConfig() { }

    static List<String> candidates(Context context, String path) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String configured = prefs.getString(PREF_AI_ENDPOINT, "");
        if (configured != null) {
            configured = configured.trim();
            if (isExplicitLanEndpoint(configured)) {
                values.add(endpointFor(configured, path));
            }
        }
        return new ArrayList<>(values);
    }

    static boolean hasConfiguredLan(Context context) {
        String configured = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(PREF_AI_ENDPOINT, "");
        return configured != null && isExplicitLanEndpoint(configured.trim());
    }

    static void remember(Context context, String workingEndpoint) {
        if (workingEndpoint == null || workingEndpoint.isEmpty()) return;
        String clean = workingEndpoint.trim();
        if (!isExplicitLanEndpoint(clean)) return;
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0 ? clean.substring(0, marker) : clean.replaceAll("/+$", "");
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_AI_ENDPOINT, base + "/ci/intent")
                .apply();
    }

    private static boolean isExplicitLanEndpoint(String value) {
        if (value == null || value.isEmpty()) return false;
        String lower = value.toLowerCase(java.util.Locale.ROOT);
        if (!lower.startsWith("http://")) return false;
        String host = lower.substring("http://".length());
        int slash = host.indexOf('/');
        if (slash >= 0) host = host.substring(0, slash);
        int colon = host.indexOf(':');
        if (colon >= 0) host = host.substring(0, colon);
        return host.equals("localhost")
                || host.equals("127.0.0.1")
                || host.startsWith("10.")
                || host.startsWith("192.168.")
                || isPrivate172(host);
    }

    private static boolean isPrivate172(String host) {
        if (!host.startsWith("172.")) return false;
        String[] parts = host.split("\\.");
        if (parts.length < 2) return false;
        try {
            int second = Integer.parseInt(parts[1]);
            return second >= 16 && second <= 31;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static String endpointFor(String endpoint, String path) {
        String clean = endpoint.trim();
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0 ? clean.substring(0, marker) : clean.replaceAll("/+$", "");
        return base + path;
    }
}
