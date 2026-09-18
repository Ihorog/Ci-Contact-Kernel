package ua.cimeika.cipoint;

import org.json.JSONObject;

final class CiContextCard {
    final String id;
    final String label;
    final String intent;
    final String state;
    final double relevance;
    final String taskType;
    final String capability;
    final String environment;
    final String action;
    final String mode;
    final boolean requiresConfirmation;
    final String status;
    final JSONObject raw;

    private CiContextCard(
            String id,
            String label,
            String intent,
            String state,
            double relevance,
            String taskType,
            String capability,            String environment,
            String action,
            String mode,
            boolean requiresConfirmation,
            String status,
            JSONObject raw) {
        this.id = id;
        this.label = label;
        this.intent = intent;
        this.state = state;
        this.relevance = relevance;
        this.taskType = taskType;
        this.capability = capability;
        this.environment = environment;
        this.action = action;
        this.mode = mode;
        this.requiresConfirmation = requiresConfirmation;
        this.status = status;
        this.raw = raw;
    }

    static CiContextCard from(JSONObject raw) {
        JSONObject context = raw.optJSONObject("context");
        JSONObject routing = raw.optJSONObject("routing");
        JSONObject execution = raw.optJSONObject("execution");
        if (context == null) context = new JSONObject();
        if (routing == null) routing = new JSONObject();        if (execution == null) execution = new JSONObject();

        String intent = context.optString("intent", "").trim();
        String label = raw.optString("label", intent).trim();
        if (label.isEmpty()) label = intent.isEmpty() ? "Сі" : intent;

        return new CiContextCard(
                raw.optString("id", "ci-card"),
                label,
                intent,
                context.optString("state", "actual"),
                context.optDouble("relevance", 0d),
                routing.optString("taskType", "integration"),
                routing.optString("capability", "resolve_intent"),
                routing.optString("environment", "system"),
                routing.optString("action", "resolve_intent"),
                execution.optString("mode", "local"),
                execution.optBoolean("requiresConfirmation", false),
                execution.optString("status", "ready"),
                raw
        );
    }

    JSONObject toJson() {
        return raw;
    }
}
