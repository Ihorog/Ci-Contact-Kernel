package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class CiContextClient implements CiContextProvider {
    private static final String PREFS = "ci_point";
    private static final String PREF_AI_ENDPOINT = "local_ai_endpoint";
    private static final String PREF_CONTEXT_CACHE = "context_cache_json";
    private static final String PREF_CONTEXT_CACHE_AT = "context_cache_at";
    private static final String DEFAULT_AI_ENDPOINT =
            "http://192.168.1.38:8791/ci/intent";

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean closed;

    CiContextClient(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void requestContext(
            String gesture,
            String direction,
            JSONObject state,
            Callback callback) {
        JSONObject body = basePayload(state);
        try {
            body.put("gesture", gesture == null ? "materialize_context" : gesture);
            body.put("direction", direction == null ? "" : direction);
        } catch (Exception ignored) { }
        submit("/ci/context", body, callback);
    }

    @Override
    public void execute(
            CiContextCard card,
            JSONObject state,
            Callback callback) {
        JSONObject body = basePayload(state);
        try {
            body.put("card", card.toJson());
        } catch (Exception ignored) { }
        submit("/ci/action", body, callback);
    }

    private JSONObject basePayload(JSONObject state) {
        JSONObject body = new JSONObject();
        try {
            body.put("source", "ci-android-overlay");
            body.put("platform", "android");
            body.put("device", android.os.Build.MODEL);
            body.put("surface", "ci-point");
            body.put("locale", "uk-UA");
            String keyId = CiDeviceIdentity.keyId();
            if (!keyId.isEmpty()) body.put("device_key_id", keyId);
            body.put("context", state == null ? new JSONObject() : state);
        } catch (Exception ignored) { }
        return body;
    }

    private void submit(String path, JSONObject body, Callback callback) {
        if (closed) return;
        executor.execute(() -> {
            try {
                JSONObject payload = postJson(endpointFor(path), body);
                if (closed) return;
                if ("/ci/context".equals(path)) cacheContext(payload);
                deliverSuccess(callback, payload);
            } catch (Exception exc) {
                if (closed) return;
                JSONObject fallback = "/ci/action".equals(path)
                        ? localActionFallback(body)
                        : localContextFallback(body);
                if (fallback != null) {
                    deliverSuccess(callback, fallback);
                } else {
                    deliverError(
                            callback,
                            "context_runtime_error:" + exc.getClass().getSimpleName()
                    );
                }
            }
        });
    }

    private void deliverSuccess(Callback callback, JSONObject payload) {
        mainHandler.post(() -> {
            if (!closed) callback.onSuccess(payload);
        });
    }

    private void deliverError(Callback callback, String error) {
        mainHandler.post(() -> {
            if (!closed) callback.onError(error);
        });
    }

    private String endpointFor(String path) {
        SharedPreferences prefs =
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String endpoint = prefs.getString(PREF_AI_ENDPOINT, DEFAULT_AI_ENDPOINT);
        if (endpoint == null || endpoint.trim().isEmpty()) {
            endpoint = DEFAULT_AI_ENDPOINT;
        }
        String clean = endpoint.trim();
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0
                ? clean.substring(0, marker)
                : clean.replaceAll("/+$", "");
        return base + path;
    }

    private void cacheContext(JSONObject payload) {
        JSONArray cards = payload != null ? payload.optJSONArray("cards") : null;
        if (cards == null || cards.length() == 0) return;
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PREF_CONTEXT_CACHE, payload.toString())
                .putLong(PREF_CONTEXT_CACHE_AT, System.currentTimeMillis())
                .apply();
    }

    private JSONObject cachedContext() {
        SharedPreferences prefs =
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(PREF_CONTEXT_CACHE, "");
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            JSONObject payload = new JSONObject(raw);
            JSONArray cards = payload.optJSONArray("cards");
            if (cards == null || cards.length() == 0) return null;
            for (int i = 0; i < cards.length(); i++) {
                JSONObject card = cards.optJSONObject(i);
                if (card == null) continue;
                JSONObject cardContext = card.optJSONObject("context");
                if (cardContext != null && "actual".equals(cardContext.optString("state"))) {
                    cardContext.put("state", "past");
                    String label = card.optString("label", "").trim();
                    if (!label.isEmpty() && !label.startsWith("Останнє:")) {
                        card.put("label", "Останнє: " + label);
                    }
                }
            }
            payload.put("fallback", true);
            payload.put("source", "ci-context-cache");
            long cachedAt = prefs.getLong(PREF_CONTEXT_CACHE_AT, 0L);
            if (cachedAt > 0L) {
                payload.put(
                        "cache_age_ms",
                        Math.max(0L, System.currentTimeMillis() - cachedAt)
                );
            }
            return payload;
        } catch (Exception ignored) {
            return null;
        }
    }

    private JSONObject localContextFallback(JSONObject body) {
        String gesture = body.optString("gesture", "materialize_context");
        if ("materialize_context".equals(gesture)
                || "swipe_left".equals(gesture)
                || "after_action".equals(gesture)) {
            JSONObject cached = cachedContext();
            if (cached != null) return cached;
        }

        JSONObject state = body.optJSONObject("context");
        if (state == null) state = new JSONObject();
        String current = currentLabel(state);

        JSONArray cards = new JSONArray();
        if ("context_newer".equals(gesture) || "next_stage".equals(gesture)) {
            cards.put(makeCard(
                    "Ймовірно: наступний крок",
                    "Наступний крок у поточному контексті",
                    "predicted",
                    "context_newer".equals(gesture) ? "context_newer" : "next_stage"
            ));
            cards.put(makeCard(
                    "Поточний контекст",
                    current,
                    "actual",
                    "resolve_intent"
            ));
            cards.put(makeCard(
                    "Попередній стан",
                    "Повернути попередній стан",
                    "past",
                    "previous_state"
            ));
        } else if ("context_older".equals(gesture)
                || "previous_state".equals(gesture)) {
            cards.put(makeCard(
                    "Попередній стан",
                    "Повернути попередній стан",
                    "past",
                    "previous_state"
            ));
            cards.put(makeCard(
                    "Поточний контекст",
                    current,
                    "actual",
                    "resolve_intent"
            ));
            cards.put(makeCard(
                    "Ймовірно: наступний крок",
                    "Наступний крок у поточному контексті",
                    "predicted",
                    "context_newer"
            ));
        } else {
            cards.put(makeCard(
                    "Поточний контекст",
                    current,
                    "actual",
                    "resolve_intent"
            ));
            cards.put(makeCard(
                    "Ймовірно: продовжити",
                    "Продовжити поточний контекст",
                    "predicted",
                    "context_newer"
            ));
            cards.put(makeCard(
                    "Попередній стан",
                    "Повернути попередній контекст",
                    "past",
                    "previous_state"
            ));
        }

        JSONObject payload = new JSONObject();
        try {
            payload.put("ok", true);
            payload.put("fallback", true);
            payload.put("source", "ci-android-local-context");
            payload.put("cards", cards);
            payload.put("protocol", "ci-context-local-v1");
        } catch (Exception ignored) { }
        return payload;
    }

    private JSONObject localActionFallback(JSONObject body) {
        JSONObject card = body.optJSONObject("card");
        if (card == null) return null;
        JSONObject routing = card.optJSONObject("routing");
        JSONObject execution = card.optJSONObject("execution");
        JSONObject cardContext = card.optJSONObject("context");
        if (routing == null) routing = new JSONObject();
        if (execution == null) execution = new JSONObject();
        if (cardContext == null) cardContext = new JSONObject();

        String action = routing.optString("action", "resolve_intent");
        boolean confirmation = execution.optBoolean(
                "requiresConfirmation",
                false
        );
        String intent = cardContext.optString(
                "intent",
                card.optString("label", "Контекст")
        );

        JSONObject result = new JSONObject();
        try {
            if ("resolve_intent".equals(action)) {
                result.put("action", "answer");
                result.put(
                        "answer",
                        "Контекстний виконавець зараз недоступний."
                );
            } else {
                result.put("action", action);
                result.put("answer", "");
            }
            result.put("query", intent);
            result.put("requires_confirmation", confirmation);
            result.put("processor", "ci-android-local-context");
            result.put("selected_card_id", card.optString("id", ""));
            result.put(
                    "evidence",
                    new JSONObject()
                            .put("state", "local_fallback")
                            .put("verified", false)
                            .put("source", "ci-android-local-context")
            );
        } catch (Exception ignored) { }

        JSONObject nextBody = new JSONObject();
        try {
            nextBody.put("gesture", "after_action");
            nextBody.put("context", body.optJSONObject("context"));
        } catch (Exception ignored) { }
        JSONObject nextPayload = localContextFallback(nextBody);

        JSONObject payload = new JSONObject();
        try {
            payload.put("ok", true);
            payload.put("fallback", true);
            payload.put("result", result);
            payload.put(
                    "next_cards",
                    nextPayload.optJSONArray("cards")
            );
            payload.put("protocol", "ci-context-local-v1");
        } catch (Exception ignored) { }
        return payload;
    }

    private String currentLabel(JSONObject state) {
        JSONObject last = state.optJSONObject("last_result");
        if (last != null) {
            String answer = last.optString("answer", "").trim();
            if (!answer.isEmpty()) return answer;
            String query = last.optString("query", "").trim();
            if (!query.isEmpty()) return query;
        }
        return "Продовжити поточний контекст";
    }

    private JSONObject makeCard(
            String label,
            String intent,
            String state,
            String action) {
        JSONObject card = new JSONObject();
        try {
            card.put(
                    "id",
                    "local-" + action + "-" + System.currentTimeMillis()
            );
            card.put("label", label);
            card.put(
                    "context",
                    new JSONObject()
                            .put("intent", intent)
                            .put("state", state)
                            .put("relevance", "actual".equals(state) ? 0.9 : 0.6)
            );
            card.put(
                    "routing",
                    new JSONObject()
                            .put("taskType", "integration")
                            .put("capability", action)
                            .put("environment", "device")
                            .put("action", action)
            );
            card.put(
                    "execution",
                    new JSONObject()
                            .put("mode", "local")
                            .put("requiresConfirmation", false)
                            .put("status", "ready")
            );
            card.put(
                    "evolution",
                    new JSONObject()
                            .put("onSuccess", new JSONArray())
                            .put("onFailure", new JSONArray())
            );
        } catch (Exception ignored) { }
        return card;
    }

    private JSONObject postJson(String endpoint, JSONObject payload) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(3500);
        connection.setReadTimeout(50000);
        connection.setDoOutput(true);
        connection.setRequestProperty(
                "Content-Type",
                "application/json; charset=utf-8"
        );
        byte[] bytes =
                payload.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }

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
        return new JSONObject(raw.toString());
    }

    @Override
    public void close() {
        closed = true;
        executor.shutdownNow();
    }
}
