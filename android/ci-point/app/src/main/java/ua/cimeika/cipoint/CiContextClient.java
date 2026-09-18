package ua.cimeika.cipoint;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

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
    private static final String DEFAULT_AI_ENDPOINT = "http://192.168.1.38:8791/ci/intent";

    private final Context context;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean closed;

    CiContextClient(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void requestContext(String gesture, String direction, JSONObject state, Callback callback) {
        JSONObject body = basePayload(state);
        try {
            body.put("gesture", gesture == null ? "tap" : gesture);
            body.put("direction", direction == null ? "" : direction);
        } catch (Exception ignored) { }
        submit("/ci/context", body, callback);
    }

    @Override
    public void execute(CiContextCard card, JSONObject state, Callback callback) {
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
                mainHandler.post(() -> {
                    if (!closed) callback.onSuccess(payload);
                });
            } catch (Exception exc) {
                if (closed) return;
                String error = "context_runtime_error:" + exc.getClass().getSimpleName();
                mainHandler.post(() -> {
                    if (!closed) callback.onError(error);
                });
            }
        });
    }

    private String endpointFor(String path) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String endpoint = prefs.getString(PREF_AI_ENDPOINT, DEFAULT_AI_ENDPOINT);
        if (endpoint == null || endpoint.trim().isEmpty()) endpoint = DEFAULT_AI_ENDPOINT;
        String clean = endpoint.trim();
        int marker = clean.indexOf("/ci/");
        String base = marker >= 0 ? clean.substring(0, marker) : clean.replaceAll("/+$", "");
        return base + path;
    }

    private JSONObject postJson(String endpoint, JSONObject payload) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(3500);
        connection.setReadTimeout(50000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
                ? connection.getInputStream() : connection.getErrorStream();
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
