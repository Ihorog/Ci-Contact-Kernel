package ua.cimeika.cipoint;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.content.Context;
import android.view.Gravity;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * On-device user-authorized operations surface.
 * Android SAF owns document access; the system confirms file edits, alarms and
 * calendar inserts. Ci never requests all-files/accessibility permissions.
 */
public final class CiOperatorActivity extends Activity {
    static final String EXTRA_MODE = "ci_mode";
    static final String EXTRA_COMMAND_TEXT = "ci_command_text";
    static final String MODE_COMMAND = "command";
    static final String MODE_FILES = "files";
    static final String MODE_ACTIONS = "actions";
    static final String MODE_CONTEXT = "context";

    private static final int REQUEST_OPEN = 21;
    private static final int REQUEST_EDIT = 22;
    private static final int REQUEST_CREATE = 23;
    private static final int REQUEST_VIDEO = 24;
    private static final String NOTE_FILE = "ci-local-notes.txt";

    private EditText command;
    private TextView status;
    private Uri editingUri;
    private String pendingExport = "";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setTitle("Сі · Я командир");
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.rgb(15, 21, 26));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(36), dp(20), dp(24));
        scroll.addView(root);

        TextView heading = new TextView(this);
        heading.setText("Сі · Я командир");
        heading.setTextSize(23);
        heading.setTextColor(Color.WHITE);
        root.addView(heading);

        command = new EditText(this);
        command.setTextColor(Color.WHITE);
        command.setHintTextColor(Color.LTGRAY);
        command.setHint("Власний контекст або команда…");
        command.setTextSize(17);
        command.setMinLines(3);
        command.setMaxLines(8);
        command.setGravity(Gravity.TOP);
        command.setSingleLine(false);
        root.addView(command, new LinearLayout.LayoutParams(-1, -2));

        addButton(root, "Виконати команду", () -> executeCommand(command.getText().toString()));
        addButton(root, "Знайти / відкрити файл", () -> chooseDocument(REQUEST_OPEN, "*/*"));
        addButton(root, "Редагувати текстовий файл", () -> chooseDocument(REQUEST_EDIT, "text/*"));
        addButton(root, "Зберегти зміни відкритого файлу", this::confirmOverwrite);
        addButton(root, "Зберегти текст у новий файл", this::createTextDocument);
        addButton(root, "Мої нотатки / щоденник", this::showNotes);
        addButton(root, "Знайти відеофайл і вибрати плеєр", () -> chooseDocument(REQUEST_VIDEO, "video/*"));
        addButton(root, "Нагадування в календарі", () -> reminder(command.getText().toString()));
        addButton(root, "Будильник", () -> alarm(command.getText().toString()));
        addButton(root, "Встановлені додатки", this::chooseApp);

        status = new TextView(this);
        status.setTextColor(Color.LTGRAY);
        status.setTextSize(14);
        status.setPadding(0, dp(18), 0, 0);
        status.setText("Локальні дії виконуються тільки після вибору чи підтвердження Android.");
        root.addView(status);

        setContentView(scroll);
        String incomingCommand = getIntent().getStringExtra(EXTRA_COMMAND_TEXT);
        if (incomingCommand != null && !incomingCommand.trim().isEmpty()) {
            command.setText(incomingCommand);
            command.post(() -> executeCommand(incomingCommand));
            return;
        }
        String mode = getIntent().getStringExtra(EXTRA_MODE);
        if (MODE_FILES.equals(mode)) chooseDocument(REQUEST_OPEN, "*/*");
        else if (MODE_CONTEXT.equals(mode)) showNotes();
        else if (MODE_COMMAND.equals(mode)) {
            command.requestFocus();
            command.postDelayed(() -> {
                InputMethodManager keyboard = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.showSoftInput(command, InputMethodManager.SHOW_IMPLICIT);
            }, 180L);
        }
    }

    private void addButton(LinearLayout root, String title, Runnable callback) {
        Button b = new Button(this);
        b.setText(title);
        b.setAllCaps(false);
        root.addView(b, new LinearLayout.LayoutParams(-1, -2));
        b.setOnClickListener(v -> callback.run());
    }

    static boolean supportsCommand(String raw) {
        if (raw == null) return false;
        String s = raw.trim().toLowerCase(new Locale("uk"));
        return s.contains("будильник") || s.contains("нагадай") || s.contains("нагадування")
                || s.contains("нотатки") || s.contains("щоденник")
                || s.startsWith("запиши ") || s.startsWith("занотуй ") || s.startsWith("нотатка:")
                || s.contains("файл") || s.contains("відео") || s.contains("фільм")
                || s.contains("кіно") || s.contains("застосунок") || s.contains("додаток")
                || s.startsWith("відкрий ") || s.startsWith("запусти ");
    }

    private void executeCommand(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) { message("Введи команду або контекст."); return; }
        String lower = text.toLowerCase(new Locale("uk"));
        if (lower.contains("будильник")) { alarm(text); return; }
        if (lower.contains("нагадай") || lower.contains("нагадування")) { reminder(text); return; }
        if (lower.contains("нотатки") || lower.contains("щоденник")) { showNotes(); return; }
        if (lower.startsWith("запиши ") || lower.startsWith("занотуй ") || lower.startsWith("нотатка:")) {
            saveNote(text); return;
        }
        if (lower.contains("редаг") && lower.contains("файл")) {
            chooseDocument(REQUEST_EDIT, "text/*"); return;
        }
        if (lower.contains("збереж") && lower.contains("файл")) { createTextDocument(); return; }
        if (lower.contains("фільм") || lower.contains("кіно")) { searchFilm(text); return; }
        if (lower.contains("відео")) { chooseDocument(REQUEST_VIDEO, "video/*"); return; }
        if (lower.contains("файл")) { chooseDocument(REQUEST_OPEN, "*/*"); return; }
        if (lower.contains("додат") || lower.contains("застосун")) { chooseApp(); return; }
        if (lower.startsWith("відкрий ") || lower.startsWith("запусти ")) { openNamedApp(text); return; }
        new AlertDialog.Builder(this)
                .setTitle("Локальна команда не визначена")
                .setMessage("Можна зберегти як особисту нотатку або відкрити Gemma у Box. Автоматичного передавання тексту до Box поки немає.")
                .setPositiveButton("Зберегти нотатку", (d, w) -> saveNote(text))
                .setNeutralButton("Відкрити Box", (d, w) -> {
                    if (!new CiBoxRuntime(this).open()) message("Box не знайдено.");
                })
                .setNegativeButton("Скасувати", null).show();
    }

    private void chooseDocument(int code, String mime) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        launchForResult(intent, code);
    }

    private void createTextDocument() {
        pendingExport = command.getText().toString();
        if (pendingExport.trim().isEmpty()) { message("Спочатку введи текст."); return; }
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        create.addCategory(Intent.CATEGORY_OPENABLE);
        create.setType("text/plain");
        create.putExtra(Intent.EXTRA_TITLE, "ci-note.txt");
        launchForResult(create, REQUEST_CREATE);
    }

    private void launchForResult(Intent intent, int code) {
        try { startActivityForResult(intent, code); }
        catch (ActivityNotFoundException | SecurityException e) { message("На пристрої немає сумісного застосунку."); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (requestCode == REQUEST_CREATE) {
            writeText(uri, pendingExport);
            pendingExport = "";
            return;
        }
        // Persist only the permitted read grant. Editing happens during this
        // user-initiated picker session and still requires overwrite confirmation.
        try {
            if ("content".equals(uri.getScheme())
                    && (data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                getContentResolver().takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        } catch (SecurityException ignored) { /* Provider may not persist grants. */ }
        if (requestCode == REQUEST_EDIT) {
            editingUri = uri;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("empty_stream");
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (bytes.size() + n > 256_000) throw new IllegalStateException("file_too_large");
                    bytes.write(buf, 0, n);
                }
                command.setText(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
                new AlertDialog.Builder(this)
                        .setTitle("Редагування файлу")
                        .setMessage("Після змін у текстовому полі натисни «Зберегти зміни». Файл буде перезаписано лише після твого підтвердження.")
                        .setPositiveButton("Зберегти зміни", (d, w) -> confirmOverwrite())
                        .setNegativeButton("Пізніше", null).show();
                message("Файл відкрито для редагування.");
            } catch (Exception e) { editingUri = null; message("Не вдалося прочитати файл: " + e.getClass().getSimpleName()); }
        } else {
            String mime = getContentResolver().getType(uri);
            if (mime == null) mime = requestCode == REQUEST_VIDEO ? "video/*" : "*/*";
            Intent view = new Intent(Intent.ACTION_VIEW);
            view.setDataAndType(uri, mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivity(Intent.createChooser(view, requestCode == REQUEST_VIDEO ? "Вибрати плеєр" : "Відкрити файл через")); }
            catch (ActivityNotFoundException | SecurityException e) { message("Не знайдено застосунку для цього файлу."); }
        }
    }

    private void confirmOverwrite() {
        if (editingUri == null) { message("Спочатку вибери файл через «Редагувати текстовий файл»."); return; }
        new AlertDialog.Builder(this)
                .setTitle("Перезаписати файл?")
                .setMessage("Попередній вміст вибраного файлу буде замінено.")
                .setPositiveButton("Перезаписати", (d, w) -> writeText(editingUri, command.getText().toString()))
                .setNegativeButton("Скасувати", null).show();
    }

    private void writeText(Uri uri, String text) {
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("empty_stream");
            out.write(text.getBytes(StandardCharsets.UTF_8));
            message("Файл збережено.");
        } catch (Exception e) { message("Не вдалося записати файл: " + e.getClass().getSimpleName()); }
    }

    private void saveNote(String raw) {
        String text = raw.replaceFirst("(?iu)^(запиши|занотуй)\\s+", "")
                .replaceFirst("(?iu)^нотатка:\\s*", "").trim();
        if (text.isEmpty()) { message("Порожню нотатку не збережено."); return; }
        String line = System.currentTimeMillis() + " | " + text + "\n";
        try (OutputStream out = openFileOutput(NOTE_FILE, MODE_APPEND)) {
            out.write(line.getBytes(StandardCharsets.UTF_8));
            message("Нотатку збережено лише на цьому пристрої.");
        } catch (Exception e) { message("Помилка збереження нотатки."); }
    }

    private void showNotes() {
        try (InputStream in = openFileInput(NOTE_FILE)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0) {
                if (bytes.size() + n > 256_000) break;
                bytes.write(b, 0, n);
            }
            String notes = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            new AlertDialog.Builder(this).setTitle("Мій локальний щоденник")
                    .setMessage(notes.isEmpty() ? "Записів немає." : notes)
                    .setPositiveButton("Закрити", null).show();
        } catch (java.io.FileNotFoundException e) { message("Щоденник порожній."); }
        catch (Exception e) { message("Не вдалося відкрити щоденник."); }
    }

    private void searchFilm(String raw) {
        String name = raw.replaceFirst("(?iu)^(увімкни|знайди|відкрий|покажи)\\s+", "")
                .replaceFirst("(?iu)^(фільм|кіно)\\s*", "").trim();
        if (name.isEmpty()) { message("Введи назву фільму."); return; }
        Uri target = Uri.parse("https://www.google.com/search").buildUpon()
                .appendQueryParameter("q", name + " дивитися легально").build();
        new AlertDialog.Builder(this)
                .setTitle("Пошук фільму")
                .setMessage("Відкрити результати пошуку та обрати легальний сервіс перегляду? Інтернет може бути потрібним.")
                .setPositiveButton("Шукати", (d, w) -> launchView(target))
                .setNegativeButton("Скасувати", null).show();
    }

    private void launchView(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        try { startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException e) { message("Не знайдено браузера."); }
    }

    private void reminder(String raw) {
        Intent intent = new Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI);
        intent.putExtra(CalendarContract.Events.TITLE, raw == null ? "" : raw.trim());
        launch(intent);
    }

    private void alarm(String raw) {
        Matcher m = Pattern.compile("(?<!\\d)([01]?\\d|2[0-3]):([0-5]\\d)(?!\\d)").matcher(raw == null ? "" : raw);
        if (!m.find()) { message("Для будильника вкажи час у форматі ГГ:ХХ (наприклад, 07:30)."); return; }
        Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
        intent.putExtra(AlarmClock.EXTRA_HOUR, Integer.parseInt(m.group(1)));
        intent.putExtra(AlarmClock.EXTRA_MINUTES, Integer.parseInt(m.group(2)));
        intent.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        launch(intent);
    }

    private void launch(Intent intent) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException e) { message("Немає сумісного застосунку."); }
    }

    private void openNamedApp(String instruction) {
        String name = instruction.replaceFirst("(?iu)^(відкрий|запусти)\\s+", "").trim()
                .toLowerCase(new Locale("uk"));
        if (name.isEmpty()) { chooseApp(); return; }
        List<ResolveInfo> matching = new ArrayList<>();
        for (ResolveInfo app : listApps()) {
            String label = app.loadLabel(getPackageManager()).toString().toLowerCase(new Locale("uk"));
            if (label.equals(name) || label.contains(name)) matching.add(app);
        }
        if (matching.size() == 1) {
            openResolvedApp(matching.get(0));
        } else if (!matching.isEmpty()) {
            chooseFromApps(matching);
        } else {
            message("Застосунок за назвою не знайдено. Обери зі списку.");
            chooseApp();
        }
    }

    private List<ResolveInfo> listApps() {
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = new ArrayList<>(getPackageManager().queryIntentActivities(launcher, 0));
        Collections.sort(apps, Comparator.comparing(a ->
                a.loadLabel(getPackageManager()).toString().toLowerCase(Locale.ROOT)));
        return apps;
    }

    private void openResolvedApp(ResolveInfo app) {
        Intent intent = new Intent(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setClassName(app.activityInfo.packageName, app.activityInfo.name);
        launch(intent);
    }

    private void chooseApp() {
        chooseFromApps(listApps());
    }

    private void chooseFromApps(List<ResolveInfo> apps) {
        if (apps.isEmpty()) { message("Android не надав список застосунків."); return; }
        String[] labels = new String[apps.size()];
        for (int i = 0; i < apps.size(); i++) labels[i] = apps.get(i).loadLabel(getPackageManager()).toString();
        new AlertDialog.Builder(this)
                .setTitle("Відкрити застосунок")
                .setItems(labels, (dialog, which) -> {
                    openResolvedApp(apps.get(which));
                })
                .setNegativeButton("Скасувати", null).show();
    }

    private void message(String text) {
        if (status != null) status.setText(text);
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
