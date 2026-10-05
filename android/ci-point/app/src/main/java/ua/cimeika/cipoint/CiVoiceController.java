package ua.cimeika.cipoint;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class CiVoiceController {
    interface Callback {
        void onListeningChanged(boolean listening);
        void onTranscript(String text);
        void onResult(JSONObject result);
        void onError(String error);
    }

    private final Context context;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean listening;
    private volatile boolean conversationActive;
    private boolean preferOfflineActive;
    private boolean closed;
    private boolean ttsReady;
    private boolean resumeAfterSpeech;
    private int listenRequestId;
    private Runnable pendingRetry;

    CiVoiceController(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
        tts = new TextToSpeech(this.context, status -> {
            if (status != TextToSpeech.SUCCESS || tts == null || closed) return;
            tts.setLanguage(Locale.forLanguageTag("uk-UA"));
            tts.setSpeechRate(1.0f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }

                @Override public void onDone(String utteranceId) {
                    mainHandler.post(() -> {
                        if (closed || !conversationActive) return;
                        if (resumeAfterSpeech) {
                            resumeAfterSpeech = false;
                            mainHandler.postDelayed(() -> startListening(true), 140L);
                        }
                    });
                }

                @Override public void onError(String utteranceId) {
                    mainHandler.post(() -> {
                        if (closed || !conversationActive) return;
                        if (resumeAfterSpeech) {
                            resumeAfterSpeech = false;
                            scheduleRetry(true, 220L);
                        }
                    });
                }
            });
            ttsReady = true;
        });
    }

    boolean isListening() {
        return listening;
    }

    boolean isConversationActive() {
        return conversationActive;
    }

    void toggle() {
        if (conversationActive) stopConversation();
        else startConversation();
    }

    void stop() {
        stopConversation();
    }

    private void startConversation() {
        if (closed) return;
        conversationActive = true;
        startListening(true);
    }

    private void stopConversation() {
        conversationActive = false;
        resumeAfterSpeech = false;
        cancelPendingRetry();
        listenRequestId++;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) { }
        }
        if (tts != null) {
            try { tts.stop(); } catch (Exception ignored) { }
        }
        setListening(false);
    }

    private void startListening(boolean preferOffline) {
        if (closed || !conversationActive) return;
        cancelPendingRetry();
        listenRequestId++;
        preferOfflineActive = preferOffline;
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            conversationActive = false;
            callback.onError("speech_recognizer_unavailable");
            return;
        }
        ensureRecognizer();

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        );
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "uk-UA");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "uk-UA");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        try {
            recognizer.startListening(intent);
        } catch (SecurityException exc) {
            conversationActive = false;
            callback.onError("microphone_permission_required");
        } catch (Exception exc) {
            conversationActive = false;
            callback.onError("speech_start_error:" + exc.getClass().getSimpleName());
        }
    }

    private void ensureRecognizer() {
        if (recognizer != null) return;
        recognizer = SpeechRecognizer.createSpeechRecognizer(context);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                if (!closed && conversationActive) setListening(true);
            }

            @Override public void onBeginningOfSpeech() {
                if (!closed && conversationActive) setListening(true);
            }

            @Override public void onRmsChanged(float rmsdB) { }

            @Override public void onBufferReceived(byte[] buffer) { }

            @Override public void onEndOfSpeech() {
                setListening(false);
            }

            @Override public void onError(int error) {
                if (closed) return;
                setListening(false);
                if (!conversationActive) return;

                if ((error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED
                        || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
                        && preferOfflineActive) {
                    try { recognizer.cancel(); } catch (Exception ignored) { }
                    conversationActive = false;
                    callback.onError("offline_speech_pack_required");
                    return;
                }

                if (error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                        || error == SpeechRecognizer.ERROR_NO_MATCH
                        || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                    scheduleRetry(true, 320L);
                    return;
                }

                conversationActive = false;
                callback.onError("speech_error_" + error);
            }

            @Override public void onResults(Bundle results) {
                if (closed || !conversationActive) return;
                setListening(false);
                ArrayList<String> values =
                        results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (values == null || values.isEmpty()) {
                    scheduleRetry(false, 260L);
                    return;
                }
                String text = values.get(0).trim();
                if (text.isEmpty()) {
                    scheduleRetry(false, 260L);
                    return;
                }
                callback.onTranscript(text);
                submit(text);
            }

            @Override public void onPartialResults(Bundle partialResults) { }

            @Override public void onEvent(int eventType, Bundle params) { }
        });
    }

    private void setListening(boolean next) {
        if (listening == next) return;
        listening = next;
        callback.onListeningChanged(next);
    }

    private void scheduleRetry(boolean preferOffline, long delayMs) {
        cancelPendingRetry();
        final int requestId = ++listenRequestId;
        pendingRetry = () -> {
            pendingRetry = null;
            if (closed || !conversationActive || requestId != listenRequestId) return;
            startListening(preferOffline);
        };
        mainHandler.postDelayed(pendingRetry, delayMs);
    }

    private void cancelPendingRetry() {
        if (pendingRetry == null) return;
        mainHandler.removeCallbacks(pendingRetry);
        pendingRetry = null;
    }

    private void submit(String text) {
        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("text", text);
                body.put("source", "ci-android-overlay");
                body.put("platform", "android");
                body.put("device", android.os.Build.MODEL);
                String keyId = CiDeviceIdentity.keyId();
                if (!keyId.isEmpty()) body.put("device_key_id", keyId);
                body.put("surface", "ci-point");
                body.put("locale", "uk-UA");
                body.put("conversation", true);
                body.put("verified_resources", CiVerifiedResources.snapshot());

                JSONObject result = resolveOfflineIntent(text);
                Exception lastError = null;
                if (result == null) {
                    for (String endpoint : CiEndpointConfig.candidates(context, "/ci/intent")) {
                        try {
                            result = postJson(endpoint, body);
                            CiEndpointConfig.remember(context, endpoint);
                            break;
                        } catch (Exception exc) {
                            lastError = exc;
                        }
                    }
                }
                if (result == null) {
                    result = offlineFallback(text, lastError);
                }
                if (closed || !conversationActive) return;
                callback.onResult(result);

                String spoken = spokenAnswer(result);
                mainHandler.post(() -> {
                    if (closed || !conversationActive) return;
                    speakAndResume(spoken);
                });
            } catch (Exception exc) {
                if (closed || !conversationActive) return;
                callback.onError("local_ai_error:" + exc.getClass().getSimpleName());
                mainHandler.post(() -> {
                    if (!closed && conversationActive) {
                        speakAndResume("Не маю зв'язку з Сі. Спробуй ще раз.");
                    }
                });
            }
        });
    }

    private JSONObject resolveOfflineIntent(String text) {
        String value = text == null ? "" : text.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) return offlineFallback("", null);

        if (value.contains("контекст") || value.contains("покажи")) {
            return localResult("materialize_context", "Показую локальний контекст.", text);
        }
        if (value.contains("далі") || value.contains("наступ")) {
            return localResult("next_stage", "Далі.", text);
        }
        if (value.contains("назад") || value.contains("поперед")) {
            return localResult("previous_state", "Назад.", text);
        }
        if (value.contains("згорни") || value.contains("сховай")) {
            return localResult("collapse_all", "Згортаю контекст.", text);
        }
        if (value.contains("обнули") || value.contains("нуль")
                || value.contains("очисти") || value.contains("скинь")) {
            return localResult("zero_state", "Стан очищено.", text);
        }
        if (value.contains("інструмент")) {
            return localResult("tools", "Локальні інструменти.", text);
        }
        return null;
    }

    private JSONObject offlineFallback(String text, Exception networkError) {
        String answer = CiEndpointConfig.hasConfiguredLan(context)
                ? "Локальний мережевий вузол недоступний. Працюю офлайн."
                : "Офлайн ядро активне. Ця команда не входить до локального набору дій.";
        JSONObject result = localResult("answer", answer, text);
        try {
            result.put("fallback", true);
            if (networkError != null) {
                result.put("lan_error", networkError.getClass().getSimpleName());
            }
        } catch (Exception ignored) { }
        return result;
    }

    private JSONObject localResult(String action, String answer, String text) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", true);
            result.put("action", action);
            result.put("answer", answer);
            result.put("query", text == null ? "" : text);
            result.put("processor", "ci-point-offline-core");
            result.put("offline", true);
            result.put("network_required", false);
            result.put(
                    "evidence",
                    new JSONObject()
                            .put("state", "local")
                            .put("verified", true)
                            .put("source", "ci-point-offline-core")
            );
        } catch (Exception ignored) { }
        return result;
    }

    private String spokenAnswer(JSONObject result) {
        String answer = result.optString("answer", "").trim();
        if (!answer.isEmpty()) return answer;
        if (result.optBoolean("requires_confirmation", false)) {
            return "Потрібне твоє підтвердження.";
        }
        String action = result.optString("action", "answer");
        if ("open_gpt".equals(action)) return "Зовнішній GPT вимкнено в офлайн режимі.";
        if ("previous".equals(action) || "previous_state".equals(action)) return "Назад.";
        if ("next".equals(action) || "next_stage".equals(action)) return "Далі.";
        if ("context_newer".equals(action)) return "Показую новіший контекст.";
        if ("context_older".equals(action)) return "Показую попередній контекст.";
        if ("collapse_current".equals(action)) return "Згортаю.";
        if ("collapse_all".equals(action)) return "Згортаю контекст.";
        if ("restore_context".equals(action) || "materialize_context".equals(action)) {
            return "Повертаю контекст.";
        }
        return "Готово.";
    }

    private void speakAndResume(String text) {
        if (!conversationActive || closed) return;
        String value = text == null ? "" : text.trim();
        if (value.isEmpty() || tts == null || !ttsReady) {
            scheduleRetry(true, 160L);
            return;
        }
        resumeAfterSpeech = true;
        try {
            tts.speak(
                    value,
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    "ci-result-" + System.currentTimeMillis()
            );
        } catch (Exception exc) {
            resumeAfterSpeech = false;
            scheduleRetry(true, 220L);
        }
    }

    private JSONObject postJson(String endpoint, JSONObject payload) throws Exception {
        HttpURLConnection connection =
                (HttpURLConnection) new URL(endpoint).openConnection();
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

    void close() {
        closed = true;
        stopConversation();
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        executor.shutdownNow();
    }
}
