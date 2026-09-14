package ua.cimeika.cipoint;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;

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

    private static final String PREFS = "ci_point";
    private static final String PREF_AI_ENDPOINT = "local_ai_endpoint";
    private static final String DEFAULT_AI_ENDPOINT = "http://192.168.1.38:8791/ci/intent";

    private final Context context;
    private final Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean listening;

    CiVoiceController(Context context, Callback callback) {
        this.context = context;
        this.callback = callback;
        tts = new TextToSpeech(context, status -> {
            if (status == TextToSpeech.SUCCESS) {
                tts.setLanguage(Locale.forLanguageTag("uk-UA"));
                tts.setSpeechRate(1.0f);
            }
        });
    }

    boolean isListening() {
        return listening;
    }

    void toggle() {
        if (listening) stopListening();
        else startListening();
    }

    private void startListening() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            callback.onError("speech_recognizer_unavailable");
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { setListening(true); }
                @Override public void onBeginningOfSpeech() { setListening(true); }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { setListening(false); }
                @Override public void onError(int error) {
                    setListening(false);
                    callback.onError("speech_error_" + error);
                }
                @Override public void onResults(Bundle results) {
                    setListening(false);
                    ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (values == null || values.isEmpty()) {
                        callback.onError("speech_empty");
                        return;
                    }
                    String text = values.get(0).trim();
                    callback.onTranscript(text);
                    submit(text);
                }
                @Override public void onPartialResults(Bundle partialResults) { }
                @Override public void onEvent(int eventType, Bundle params) { }
            });
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "uk-UA");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "uk-UA");
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        recognizer.startListening(intent);
    }

    private void stopListening() {
        if (recognizer != null) {
            try { recognizer.stopListening(); } catch (Exception ignored) { }
        }
        setListening(false);
    }

    private void setListening(boolean next) {
        if (listening == next) return;
        listening = next;
        callback.onListeningChanged(next);
    }

    private void submit(String text) {
        executor.execute(() -> {
            try {
                SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String endpoint = prefs.getString(PREF_AI_ENDPOINT, DEFAULT_AI_ENDPOINT);
                JSONObject body = new JSONObject();
                body.put("text", text);
                body.put("source", "ci-android-overlay");
                body.put("locale", "uk-UA");
                JSONObject result = postJson(endpoint, body);
                callback.onResult(result);
                String answer = result.optString("answer", "").trim();
                if (!answer.isEmpty()) speak(answer);
            } catch (Exception exc) {
                callback.onError("local_ai_error:" + exc.getClass().getSimpleName());
            }
        });
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
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder raw = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            for (String line = reader.readLine(); line != null; line = reader.readLine()) raw.append(line);
        }
        if (status < 200 || status >= 300) throw new IllegalStateException("http_" + status);
        return new JSONObject(raw.toString());
    }

    private void speak(String text) {
        if (tts == null) return;
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ci-result");
    }

    void close() {
        stopListening();
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
