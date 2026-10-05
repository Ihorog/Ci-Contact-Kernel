# Ci Point Offline-First v1 — acceptance contract

Status: implementation contract for Ci Point v0.6.1.

## 1. Core invariant

Core behavior MUST work with airplane mode enabled.

Ci Point must start, render Presence, accept gestures, maintain local context state,
and resolve the supported local command set without Internet access, cloud services,
or a reachable LAN node.

## 2. Network policy

- Internet/cloud services are not a runtime dependency.
- No public HTTPS endpoint is built into the Android core.
- No ChatGPT/OpenAI package or URL is required or launched by the offline build.
- LAN/Wi-Fi transport is optional.
- Ci Point may ship with the trusted HOME.CI operator route `192.168.1.54:8791` as a default
  LAN candidate, while still accepting an explicitly configured private-network endpoint.
- When configured, the network path is additive: local core remains available before,
  during, and after a network failure.
- Accepted explicit LAN hosts: localhost/127.0.0.1, 10/8, 172.16/12, 192.168/16.
- Failure of an explicitly configured LAN endpoint falls back to the local core.

The Android INTERNET permission remains only because Android uses the same permission
for optional LAN sockets. Its presence does not define an Internet dependency.

## 3. Voice policy

- Speech recognition requests offline mode.
- The application must not intentionally retry recognition in online mode.
- If the device lacks the Ukrainian offline speech pack, Ci reports
  `offline_speech_pack_required`.
- Local supported commands are resolved on-device before optional LAN routing.
- Unsupported free-form text returns a truthful offline-core response instead of a
  fabricated AI answer.

## 4. Local command set

Minimum local voice/intent coverage:

- context/materialize;
- next stage;
- previous state;
- collapse/hide context;
- zero/reset state;
- tools;
- truthful offline fallback for unsupported input.

## 5. Resource state

Resource trust shown by the standalone APK is local device state only.
Cloud/operator health must not be queried by the offline build.

## 6. Release gates

A v0.6.1 candidate passes only when:

1. Presence contract audit passes.
2. Offline-first source audit passes.
3. Android lint and assembleDebug pass.
4. Android 35 install/start/overlay smoke passes.
5. No Ci Point crash is present in logcat.
6. Version reported by the installed package is 0.6.1.
7. The source set contains no public external-assistant URL; the only built-in LAN route is the trusted HOME.CI operator candidate.
8. Optional LAN failure leaves the local core operational.

Physical Lenovo Tab M11 acceptance remains a separate device gate after CI/emulator
verification.
