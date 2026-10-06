package ua.cimeika.cipoint;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class CiOperationRegistry extends SQLiteOpenHelper {
    private static final String DB_NAME = "ci_operation_registry.db";
    private static final int DB_VERSION = 1;
    private static final String TABLE = "operation_log";
    private static final int MAX_LOCAL_JSON = 16_384;

    CiOperationRegistry(Context context) {
        super(context.getApplicationContext(), DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
                "CREATE TABLE " + TABLE + " (" +
                        "operation_id TEXT PRIMARY KEY," +
                        "created_at_ms INTEGER NOT NULL," +
                        "updated_at_ms INTEGER NOT NULL," +
                        "kind TEXT NOT NULL," +
                        "context_json TEXT NOT NULL," +
                        "context_hash TEXT NOT NULL," +
                        "authorization TEXT NOT NULL," +
                        "status TEXT NOT NULL," +
                        "execution_plane TEXT NOT NULL," +
                        "evidence_json TEXT NOT NULL," +
                        "cloud_sync TEXT NOT NULL" +
                        ")"
        );
        db.execSQL(
                "CREATE INDEX operation_log_created_idx ON " +
                        TABLE + "(created_at_ms DESC)"
        );
        db.execSQL(
                "CREATE INDEX operation_log_sync_idx ON " +
                        TABLE + "(cloud_sync, updated_at_ms)"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // v1 is append-compatible. Future migrations must preserve the ledger.
    }

    String begin(String path, JSONObject body) {
        long now = System.currentTimeMillis();
        String id = "ci-op-" + UUID.randomUUID();
        JSONObject safeBody = body == null ? new JSONObject() : body;
        String raw = safeBody.toString();
        String bounded = boundedJson(safeBody);

        ContentValues values = new ContentValues();
        values.put("operation_id", id);
        values.put("created_at_ms", now);
        values.put("updated_at_ms", now);
        values.put("kind", kind(path));
        values.put("context_json", bounded);
        values.put("context_hash", sha256(raw));
        values.put("authorization", "human_signal");
        values.put("status", "accepted");
        values.put("execution_plane", "pending");
        values.put("evidence_json", "{}");
        values.put("cloud_sync", "pending");
        getWritableDatabase().insertOrThrow(TABLE, null, values);
        prune();
        return id;
    }

    void finish(
            String operationId,
            boolean ok,
            String executionPlane,
            JSONObject payload) {
        if (operationId == null || operationId.isEmpty()) return;
        ContentValues values = new ContentValues();
        values.put("updated_at_ms", System.currentTimeMillis());
        values.put("status", ok ? "resolved" : "failed");
        values.put(
                "execution_plane",
                executionPlane == null ? "unknown" : executionPlane
        );
        values.put(
                "evidence_json",
                boundedJson(payload == null ? new JSONObject() : payload)
        );
        getWritableDatabase().update(
                TABLE,
                values,
                "operation_id=?",
                new String[]{operationId}
        );
    }

    JSONObject cloudEnvelope(String operationId, String deviceKeyId) {
        JSONObject out = new JSONObject();
        Cursor cursor = getReadableDatabase().query(
                TABLE,
                new String[]{
                        "operation_id", "created_at_ms", "updated_at_ms",
                        "kind", "context_hash", "authorization", "status",
                        "execution_plane", "evidence_json", "cloud_sync"
                },
                "operation_id=?",
                new String[]{operationId},
                null,
                null,
                null,
                "1"
        );
        try {
            if (!cursor.moveToFirst()) return out;
            out.put("operation_id", cursor.getString(0));
            out.put("created_at_ms", cursor.getLong(1));
            out.put("updated_at_ms", cursor.getLong(2));
            out.put("kind", cursor.getString(3));
            out.put("context_hash", cursor.getString(4));
            out.put("authorization", cursor.getString(5));
            out.put("status", cursor.getString(6));
            out.put("execution_plane", cursor.getString(7));
            out.put("evidence_hash", sha256(cursor.getString(8)));
            out.put("cloud_sync", cursor.getString(9));
            out.put("device_key_id", deviceKeyId == null ? "" : deviceKeyId);
            out.put("contract", "ci-intent-authorization-registry/v1");
        } catch (Exception ignored) {
            return new JSONObject();
        } finally {
            cursor.close();
        }
        return out;
    }

    List<String> pendingCloudSync(int limit, String excludeOperationId) {
        List<String> out = new ArrayList<>();
        int safeLimit = Math.max(1, Math.min(limit, 16));
        Cursor cursor = getReadableDatabase().query(
                TABLE,
                new String[]{"operation_id"},
                "cloud_sync IN ('pending','deferred')" +
                        (excludeOperationId == null || excludeOperationId.isEmpty()
                                ? ""
                                : " AND operation_id<>?"),
                excludeOperationId == null || excludeOperationId.isEmpty()
                        ? null
                        : new String[]{excludeOperationId},
                null,
                null,
                "updated_at_ms ASC",
                Integer.toString(safeLimit)
        );
        try {
            while (cursor.moveToNext()) out.add(cursor.getString(0));
        } finally {
            cursor.close();
        }
        return out;
    }

    void markCloudSync(String operationId, boolean ok) {
        if (operationId == null || operationId.isEmpty()) return;
        ContentValues values = new ContentValues();
        values.put("updated_at_ms", System.currentTimeMillis());
        values.put("cloud_sync", ok ? "synced" : "deferred");
        getWritableDatabase().update(
                TABLE,
                values,
                "operation_id=?",
                new String[]{operationId}
        );
    }

    JSONArray recentHistory(int limit) {
        JSONArray out = new JSONArray();
        int safeLimit = Math.max(1, Math.min(limit, 64));
        Cursor cursor = getReadableDatabase().query(
                TABLE,
                new String[]{
                        "operation_id", "created_at_ms", "kind",
                        "context_json", "status", "execution_plane",
                        "evidence_json"
                },
                null,
                null,
                null,
                null,
                "created_at_ms DESC",
                Integer.toString(safeLimit)
        );
        try {
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                try {
                    row.put("operation_id", cursor.getString(0));
                    row.put("created_at_ms", cursor.getLong(1));
                    row.put("kind", cursor.getString(2));
                    row.put("context", parseObject(cursor.getString(3)));
                    row.put("status", cursor.getString(4));
                    row.put("execution_plane", cursor.getString(5));
                    row.put("evidence", parseObject(cursor.getString(6)));
                    out.put(row);
                } catch (Exception ignored) { }
            }
        } finally {
            cursor.close();
        }
        return out;
    }

    JSONObject status() {
        JSONObject out = new JSONObject();
        SQLiteDatabase db = getReadableDatabase();
        long total = scalar(db, "SELECT COUNT(*) FROM " + TABLE);
        long pending = scalar(
                db,
                "SELECT COUNT(*) FROM " + TABLE +
                        " WHERE cloud_sync IN ('pending','deferred')"
        );
        long resolved = scalar(
                db,
                "SELECT COUNT(*) FROM " + TABLE + " WHERE status='resolved'"
        );
        try {
            out.put("contract", "ci-intent-authorization-registry/v1");
            out.put("local_durable", true);
            out.put("total", total);
            out.put("resolved", resolved);
            out.put("cloud_pending", pending);
        } catch (Exception ignored) { }
        return out;
    }

    private JSONObject parseObject(String raw) {
        if (raw == null || raw.trim().isEmpty()) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private long scalar(SQLiteDatabase db, String sql) {
        try (Cursor cursor = db.rawQuery(sql, null)) {
            return cursor.moveToFirst() ? cursor.getLong(0) : 0L;
        }
    }

    private void prune() {
        getWritableDatabase().execSQL(
                "DELETE FROM " + TABLE +
                        " WHERE operation_id IN (" +
                        "SELECT operation_id FROM " + TABLE +
                        " ORDER BY created_at_ms DESC LIMIT -1 OFFSET 512)"
        );
    }

    private String kind(String path) {
        if (path == null) return "unknown";
        if (path.endsWith("/context")) return "context";
        if (path.endsWith("/action")) return "action";
        if (path.endsWith("/intent")) return "intent";
        return "operation";
    }

    private String boundedJson(JSONObject value) {
        JSONObject safe = value == null ? new JSONObject() : value;
        String raw = safe.toString();
        if (raw.length() <= MAX_LOCAL_JSON) return raw;

        JSONObject compact = new JSONObject();
        try {
            compact.put("truncated", true);
            compact.put("content_hash", sha256(raw));
            copyString(safe, compact, "source", 256);
            copyString(safe, compact, "platform", 64);
            copyString(safe, compact, "device", 256);
            copyString(safe, compact, "surface", 128);
            copyString(safe, compact, "locale", 32);
            copyString(safe, compact, "gesture", 128);
            copyString(safe, compact, "direction", 32);
            copyString(safe, compact, "operation_id", 128);

            JSONObject context = safe.optJSONObject("context");
            if (context != null) compact.put("context", compactContext(context));

            JSONObject card = safe.optJSONObject("card");
            if (card != null) compact.put("card", compactCard(card));

            JSONObject evidence = safe.optJSONObject("evidence");
            if (evidence != null) compact.put("evidence", compactEvidence(evidence));

            compact.put(
                    "preview",
                    raw.substring(0, Math.min(2048, raw.length()))
            );
        } catch (Exception ignored) { }
        return compact.toString();
    }

    private JSONObject compactContext(JSONObject source) {
        JSONObject out = new JSONObject();
        try {
            copyString(source, out, "intent", 2048);
            copyString(source, out, "overlay_state", 64);
            copyString(source, out, "dock_side", 32);
            if (source.has("timestamp")) {
                out.put("timestamp", source.optLong("timestamp", 0L));
            }
            JSONObject last = source.optJSONObject("last_result");
            if (last != null) {
                JSONObject compactLast = new JSONObject();
                copyString(last, compactLast, "answer", 2048);
                copyString(last, compactLast, "query", 2048);
                copyString(last, compactLast, "action", 128);
                out.put("last_result", compactLast);
            }
        } catch (Exception ignored) { }
        return out;
    }

    private JSONObject compactCard(JSONObject source) {
        JSONObject out = new JSONObject();
        try {
            copyString(source, out, "id", 256);
            copyString(source, out, "label", 1024);
            JSONObject context = source.optJSONObject("context");
            if (context != null) {
                JSONObject compactContext = new JSONObject();
                copyString(context, compactContext, "intent", 2048);
                copyString(context, compactContext, "state", 64);
                if (context.has("relevance")) {
                    compactContext.put(
                            "relevance",
                            context.optDouble("relevance", 0d)
                    );
                }
                out.put("context", compactContext);
            }
        } catch (Exception ignored) { }
        return out;
    }

    private JSONObject compactEvidence(JSONObject source) {
        JSONObject out = new JSONObject();
        try {
            copyString(source, out, "state", 128);
            copyString(source, out, "source", 256);
            copyString(source, out, "execution_plane", 128);
            if (source.has("verified")) {
                out.put("verified", source.optBoolean("verified", false));
            }
        } catch (Exception ignored) { }
        return out;
    }

    private void copyString(
            JSONObject source,
            JSONObject target,
            String key,
            int maxLength) {
        if (source == null || target == null || !source.has(key)) return;
        String value = source.optString(key, "");
        if (value.length() > maxLength) {
            value = value.substring(0, maxLength);
        }
        try {
            target.put(key, value);
        } catch (Exception ignored) { }
    }

    private String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((value == null ? "" : value)
                            .getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte b : digest) {
                out.append(String.format(
                        java.util.Locale.ROOT,
                        "%02x",
                        b & 0xff
                ));
            }
            return out.toString();
        } catch (Exception ignored) {
            return "";
        }
    }
}
