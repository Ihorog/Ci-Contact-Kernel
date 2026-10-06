package ua.cimeika.cipoint;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class CiVerifiedResources {
    private static final String STATUS_ENDPOINT =
            BuildConfig.CI_OPERATOR_HEALTH_URL;
    private static final long CACHE_MS = 60_000L;
    private static final long RETRY_BACKOFF_MS = 120_000L;

    private static volatile JSONObject cached;
    private static volatile long cachedAt;
    private static volatile long retryAfter;

    private CiVerifiedResources() { }

    static JSONObject snapshot() {
        long now = System.currentTimeMillis();
        JSONObject value = cached;
        if (value != null && now - cachedAt <= CACHE_MS) {
            return copy(value);
        }
        if (value != null && now < retryAfter) {
            JSONObject backedOff = copy(value);
            try {
                backedOff.put("transport", "cached_backoff");
                backedOff.put("retry_after_ms", retryAfter);
            } catch (Exception ignored) { }
            return backedOff;
        }
        try {
            JSONObject fresh = fetch();
            cached = fresh;
            cachedAt = now;
            retryAfter = 0L;
            return copy(fresh);
        } catch (Exception exc) {
            retryAfter = now + RETRY_BACKOFF_MS;
            if (value != null) {
                JSONObject stale = copy(value);
                try {
                    stale.put("transport", "cached");
                    stale.put("transport_error", exc.getClass().getSimpleName());
                    stale.put("retry_after_ms", retryAfter);
                } catch (Exception ignored) { }
                return stale;
            }
            JSONObject unknown = new JSONObject();
            try {
                unknown.put("contract", "ci-personal-resource-trust/v1");
                unknown.put("source", "ci.operator.orange");
                unknown.put("freshness", "UNKNOWN");
                unknown.put("passport_fresh", false);
                unknown.put("trusted_resources", 0);
                unknown.put("owned_verified", 0);
                unknown.put("delegated_verified", 0);
                unknown.put("available_unverified", 0);
                unknown.put("stale", 0);
                unknown.put("blocked", 0);
                unknown.put("server_authoritative", true);
                unknown.put("transport", "unavailable");
                unknown.put("transport_error", exc.getClass().getSimpleName());
            } catch (Exception ignored) { }
            cached = unknown;
            cachedAt = 0L;
            return copy(unknown);
        }
    }

    private static JSONObject fetch() throws Exception {
        URL endpoint = new URL(STATUS_ENDPOINT);
        if (!"https".equalsIgnoreCase(endpoint.getProtocol())) {
            throw new IllegalStateException("health_endpoint_requires_https");
        }

        HttpURLConnection connection =
                (HttpURLConnection) endpoint.openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(2500);
        connection.setReadTimeout(4000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "CiPoint/0.7.0");

        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
        if (stream == null) throw new IllegalStateException("http_" + status);

        StringBuilder raw = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                raw.append(line);
            }
        }
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("http_" + status);
        }

        JSONObject root = new JSONObject(raw.toString());
        JSONObject acceptance = root.optJSONObject("acceptance");
        JSONObject freshnessObject =
                acceptance != null ? acceptance.optJSONObject("freshness") : null;
        JSONObject personal = root.optJSONObject("personalResources");

        String freshness = freshnessObject != null
                ? freshnessObject.optString("status", "UNKNOWN")
                : "UNKNOWN";
        int owned = personal != null ? personal.optInt("ownedVerified", 0) : 0;
        int delegated = personal != null ? personal.optInt("delegatedVerified", 0) : 0;

        JSONObject out = new JSONObject();
        out.put("contract", "ci-personal-resource-trust/v1");
        out.put("source", root.optString("node", "ci.operator.orange"));
        out.put("operator_ok", root.optBoolean("ok", false));
        out.put("freshness", freshness);
        out.put("passport_fresh", "FRESH".equals(freshness));
        out.put("trusted_resources", personal != null
                ? personal.optInt("trustedResources", owned + delegated)
                : owned + delegated);
        out.put("owned_verified", owned);
        out.put("delegated_verified", delegated);
        out.put("available_unverified", personal != null
                ? personal.optInt("availableUnverified", 0) : 0);
        out.put("stale", personal != null ? personal.optInt("stale", 0) : 0);
        out.put("blocked", personal != null ? personal.optInt("blocked", 0) : 0);
        out.put("server_authoritative", true);
        out.put("transport", "live");
        out.put("observed_at_ms", System.currentTimeMillis());
        return out;
    }

    private static JSONObject copy(JSONObject value) {
        try {
            return new JSONObject(value.toString());
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }
}
