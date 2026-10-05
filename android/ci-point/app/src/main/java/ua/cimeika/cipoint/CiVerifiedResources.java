package ua.cimeika.cipoint;

import android.content.Context;

import org.json.JSONObject;

final class CiVerifiedResources {
    private CiVerifiedResources() { }

    static JSONObject snapshot(Context context) {
        JSONObject out = new JSONObject();
        boolean lanConfigured = context != null && CiEndpointConfig.hasConfiguredLan(context);
        try {
            out.put("contract", "ci-point-offline-resource-state/v1");
            out.put("source", "ci-point-local");
            out.put("freshness", "LOCAL");
            out.put("offline_core", true);
            out.put("network_required", false);
            out.put("network_optional", true);
            out.put("lan_configured", lanConfigured);
            out.put("server_authoritative", false);
            out.put("transport", lanConfigured ? "local+optional_lan" : "local");
            out.put("observed_at_ms", System.currentTimeMillis());
        } catch (Exception ignored) { }
        return out;
    }
}
