package ua.cimeika.cipoint;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

final class CiLocalContextEngine {
    private static final int HISTORY_SCAN = 32;
    private static final int MAX_CARDS = 3;

    private final CiOperationRegistry registry;

    CiLocalContextEngine(CiOperationRegistry registry) {
        this.registry = registry;
    }

    JSONObject materialize(String gesture, JSONObject liveState) {
        JSONArray history = registry.recentHistory(HISTORY_SCAN);
        String current = currentText(liveState);
        List<Candidate> ranked = rank(history, current);

        JSONArray cards = new JSONArray();
        String mode = gesture == null ? "materialize_context" : gesture;

        if ("context_older".equals(mode) || "previous_state".equals(mode)) {
            addPast(cards, ranked, 0);
            addPast(cards, ranked, 1);
            addCurrent(cards, current);
        } else if ("context_newer".equals(mode) || "next_stage".equals(mode)) {
            addContinuation(cards, current);
            addCurrent(cards, current);
            addPast(cards, ranked, 0);
        } else {
            addCurrent(cards, current);
            addPast(cards, ranked, 0);
            addContinuation(cards, current);
        }

        JSONObject payload = new JSONObject();
        try {
            payload.put("ok", true);
            payload.put("fallback", true);
            payload.put("offline", true);
            payload.put("source", "ci-local-history-context");
            payload.put("processor", "ci-local-context-engine");
            payload.put("cards", cards);
            payload.put("history_depth", history.length());
            payload.put("protocol", "ci-local-context-v2");
        } catch (Exception ignored) { }
        return payload;
    }

    private List<Candidate> rank(JSONArray history, String current) {
        List<Candidate> out = new ArrayList<>();
        Set<String> queryTokens = tokens(current);
        int total = Math.max(1, history.length());

        for (int i = 0; i < history.length(); i++) {
            JSONObject row = history.optJSONObject(i);
            if (row == null) continue;
            String text = extractText(row);
            if (text.isEmpty()) continue;

            Set<String> rowTokens = tokens(text);
            int overlap = 0;
            for (String token : queryTokens) {
                if (rowTokens.contains(token)) overlap++;
            }
            double lexical = queryTokens.isEmpty()
                    ? 0d
                    : Math.min(1d, overlap / (double) queryTokens.size());
            double recency = 1d - (i / (double) total);
            double resolvedBoost = "resolved".equals(row.optString("status")) ? 0.08d : 0d;
            double score = Math.min(1d, 0.48d * lexical + 0.44d * recency + resolvedBoost);

            out.add(new Candidate(
                    row.optString("operation_id", "ci-history-" + i),
                    text,
                    score,
                    row.optLong("created_at_ms", 0L),
                    row.optString("execution_plane", "device_offline")
            ));
        }

        out.sort(Comparator
                .comparingDouble((Candidate c) -> c.score)
                .thenComparingLong(c -> c.createdAt)
                .reversed());
        return out;
    }

    private String extractText(JSONObject row) {
        JSONObject context = row.optJSONObject("context");
        if (context == null) return "";

        JSONObject nested = context.optJSONObject("context");
        String value = fromState(nested);
        if (!value.isEmpty()) return value;

        value = fromState(context);
        if (!value.isEmpty()) return value;

        JSONObject card = context.optJSONObject("card");
        if (card != null) {
            JSONObject cardContext = card.optJSONObject("context");
            if (cardContext != null) {
                value = cardContext.optString("intent", "").trim();
                if (!value.isEmpty()) return value;
            }
            value = card.optString("label", "").trim();
            if (!value.isEmpty()) return value;
        }

        return "";
    }

    private String fromState(JSONObject state) {
        if (state == null) return "";
        JSONObject last = state.optJSONObject("last_result");
        if (last != null) {
            String answer = last.optString("answer", "").trim();
            if (!answer.isEmpty()) return answer;
            String query = last.optString("query", "").trim();
            if (!query.isEmpty()) return query;
        }
        String intent = state.optString("intent", "").trim();
        if (!intent.isEmpty()) return intent;
        return "";
    }

    private String currentText(JSONObject liveState) {
        String value = fromState(liveState);
        return value.isEmpty() ? "Поточний локальний контекст" : value;
    }

    private Set<String> tokens(String text) {
        Set<String> out = new HashSet<>();
        if (text == null) return out;
        for (String token : text.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{Nd}]+")) {
            if (token.length() >= 3) out.add(token);
        }
        return out;
    }

    private void addCurrent(JSONArray cards, String current) {
        if (cards.length() >= MAX_CARDS) return;
        cards.put(card(
                "local-current",
                "Поточний контекст",
                current,
                "actual",
                0.98d,
                "resolve_intent",
                "device"
        ));
    }

    private void addPast(JSONArray cards, List<Candidate> ranked, int index) {
        if (cards.length() >= MAX_CARDS || ranked.size() <= index) return;
        Candidate c = ranked.get(index);
        cards.put(card(
                c.id,
                c.text,
                c.text,
                "past",
                Math.max(0.52d, c.score),
                "restore_context",
                c.executionPlane
        ));
    }

    private void addContinuation(JSONArray cards, String current) {
        if (cards.length() >= MAX_CARDS) return;
        cards.put(card(
                "local-next",
                "Продовжити",
                current,
                "predicted",
                0.72d,
                "context_newer",
                "device"
        ));
    }

    private JSONObject card(
            String id,
            String label,
            String intent,
            String state,
            double relevance,
            String action,
            String environment) {
        JSONObject card = new JSONObject();
        try {
            card.put("id", id);
            card.put("label", trimLabel(label));
            card.put("context", new JSONObject()
                    .put("intent", intent)
                    .put("state", state)
                    .put("relevance", relevance));
            card.put("routing", new JSONObject()
                    .put("taskType", "local_context")
                    .put("capability", action)
                    .put("environment", environment)
                    .put("action", action));
            card.put("execution", new JSONObject()
                    .put("mode", "offline")
                    .put("requiresConfirmation", false)
                    .put("status", "ready"));
            card.put("evolution", new JSONObject()
                    .put("onSuccess", new JSONArray())
                    .put("onFailure", new JSONArray()));
        } catch (Exception ignored) { }
        return card;
    }

    private String trimLabel(String value) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) return "Локальний контекст";
        return text.length() <= 72 ? text : text.substring(0, 69) + "...";
    }

    private static final class Candidate {
        final String id;
        final String text;
        final double score;
        final long createdAt;
        final String executionPlane;

        Candidate(
                String id,
                String text,
                double score,
                long createdAt,
                String executionPlane) {
            this.id = id;
            this.text = text;
            this.score = score;
            this.createdAt = createdAt;
            this.executionPlane = executionPlane;
        }
    }
}
