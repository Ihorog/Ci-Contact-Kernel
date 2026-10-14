# Ci Point ↔ Box local bridge (candidate)

This is a **non-production, opt-in Android change**. Keep the current Ci Point APK until a new build has passed emulator tests and a real-device trial.

## Runtime layout

- **Ci Point** is the sole floating Android UI. Single tap shows the watch halo.
- **Double tap** toggles Ci's microphone on/off. There is **no always-on microphone**; recognition starts only after user action. Silence or failure stops listening.
- **Swipe up** opens an already installed `com.box.gallery` Box application. It does not duplicate or delete Gemma weights or private Box chats.
- **Swipe left** opens three hexagonal cells: *Контекст*, *Операції*, an intentionally blank entry cell (*Я командир* on tap).
- **Операції / Я командир** opens a private Ci Android screen with native input and user-initiated actions.
- Box's **Gemma 4 E2B** remains exclusively inside Box. There is **no exported model inference API** verified in Box. Opening the app is not the same thing as streaming prompts/responses to/from Gemma.
- Box's **Agent Skills** can locally import `box-skill/ci-local/SKILL.md` as a profile for Gemma. This is a separate, manual user import (Box → Agent Skills → Skills → + → Import local skill); no cloud accounts or tokens.

## Device operations, no dangerous global permissions

- File search/open: Android Storage Access Framework `ACTION_OPEN_DOCUMENT`; Android's picker provides search over permitted providers. The user selects a file.
- Read or edit user-selected text files only; explicit overwrite confirmation. Create new text files using `ACTION_CREATE_DOCUMENT`.
- Choose local videos and a compatible player with Android chooser. Film title requests only open a **confirmed web search** for legal viewing providers; no invented streams or automatic copyright bypass.
- Journal/notes append to `ci-local-notes.txt` in app-private storage. No cross-chat Box memory synchronization.
- Reminders are drafted through the installed calendar app, and alarms through installed Clock UI. The system makes the final confirmation.
- Installed apps are listed using launcher-intent visibility and opened only after user selection.
- On-device `SpeechRecognizer` and local system `TextToSpeech` are used for Ci voice. Ukrainian on-device speech pack availability depends on Android. Unknown voice intents continue along the **existing Ci network endpoint**, NOT through Box; do not describe this as offline Gemma.
- No broad storage, accessibility, package-install, root, or device-admin permissions are requested.

## Acceptance checklist (actual hardware required)

1. Confirm installed Box package `com.box.gallery`; verify Gemma 4 E2B works **inside Box** without Internet.
2. Install compatible signed Ci Point test APK; do not uninstall the old Ci Point or clear its storage.
3. Ensure Android permissions: *Display over other apps*, *Microphone*, *Notifications* (as applicable); no full-file-system permission.
4. Disable Wi-Fi/data and verify double tap starts on-device Ukrainian speech, double tap stops; check Android microphone indicator turns off. Verify idle silence stops the session.
5. Swipe left: three Ci honeycomb cells, blank cell opens command input. Search and open a user-selected file; edit and cancel without modifying; explicitly confirm edit; save a new file.
6. Save a diary note; open diary again; validate persistence after process restart.
7. Open a local video and choose player; test film title search while online; verify reminders and alarms require Android UI confirmation; select and launch an installed app.
8. Swipe up: launches **existing** Box. Return to Ci Point and verify its overlay and gesture routing.
9. Import `ci-local/SKILL.md` in Box Agent Skills. Verify Ukrainian Ci style **inside Box**. Do not claim shared memory until explicitly tested.
10. Confirm no unrequested modifications outside Ci Point and no production or Box data changes.

### Known limitations

- A signed APK from a different signing key may not upgrade an installed Ci Point; Android signing continuity must be checked. Do **not** uninstall simply to force an installation.
- Android on-device Ukrainian speech may be unavailable on the model/firmware until voice-language components are installed.
- Ci Point's remote fallback remains for **non-device** voice queries; to use Gemma, open Box and interact with its local chat/voice UI.
- No code here bypasses Android app sandboxes or controls arbitrary installed app UIs.
