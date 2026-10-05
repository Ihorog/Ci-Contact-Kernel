package ua.cimeika.cipoint;

import org.json.JSONObject;

final class CiVerifiedResources {
    private CiVerifiedResources() { }

    static JSONObject snapshot() {
        JSONObject out = new JSONObject();
        try {
            out.put("contract", "ci-point-offline-resource-state/v1");
            out.put("source", "ci-point-local");
            out.put("freshness", "LOCAL");
            out.put("offline_core", true);
            out.put("network_required", false);
            out.put("lan_configured", false);
            out.put("server_authoritative", false);
            out.put("transport", "local");
            out.put("observed_at_ms", System.currentTimeMillis());
        } catch (Exception ignored) { }
        return out;
    }
}
