package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

final class CiEndpointConfig {
    private static final String PREFS = "ci_point";
    private static final String PREF_AI_ENDPOINT = "local_ai_endpoint";
    private static final String LEGACY_ENDPOINT = "http://192.168.1.38:8791/ci/intent";
    private static final String PRIMARY_BASE = "http://192.168.1.132:8791";
    private static final String SECONDARY_BASE = "http://192.168.1.54:8791";

    private CiEndpointConfig() { }

    static List<String> candidates(Context context, String path) {
        LinkedHashSet<String> values = new LinkedHashSet<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String configured = prefs.getString(PREF_AI_ENDPOINT, "");
        if (configured != null) {
            configured = configured.trim();
            if (!configured.isEmpty() && !LEGACY_ENDPOINT.equals(configured)) {
                values.add(endpointFor(configured, path));
            }
        }
        values.add(PRIMARY_BASE + path);
        values.add(SECONDARY_BASE + path);
        return new ArrayList<>(values);
    }

    static void remember(Context context, String workingEndpoint) {
        if (workingEndpoint == null || workingEndpoint.isEmpty()) return;
        String clean = workingEndpoint.trim();
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0 ? clean.substring(0, marker) : clean.replaceAll("/+$", "");
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_AI_ENDPOINT, base + "/ci/intent")
                .apply();
    }

    private static String endpointFor(String endpoint, String path) {
        String clean = endpoint.trim();
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0 ? clean.substring(0, marker) : clean.replaceAll("/+$", "");
        return base + path;
    }
}
