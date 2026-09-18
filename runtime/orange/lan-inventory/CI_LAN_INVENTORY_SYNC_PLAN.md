# CI LAN Inventory Sync — plan (Orange)

Updated: `2026-09-18T08:53:59+00:00`
Status: DESIGN + DRY-RUN (no structure write yet)

## Goal
Запит «які пристрої / хто в мережі / групи» → відповідь з Ci structure без людини. Джерело: Keenetic RCI → sync у ci_devices/structure.

## Є зараз
- Keenetic AUTH_OK + `ci-keenetic-admin.py` (SHA256 ndw2)
- sealed `keenetic_admin` vault
- phrase router `хто в мережі` → passport-aware summary (chat/exec), НЕ structure
- `ci-device-passports.json` (owners/labels)
- Orange dual-IP/MAC canon (один логічний вузол)
- MCP `ci_devices` = лише orangepi3-lts (ci.collector)

## Бракує
1. Collector: Keenetic hotspot → normalized LAN device entities
2. Merge passports (label/owner/kind) + category map
3. Structure ingest so `ci_devices` / `ci_structure` бачать LAN клієнтів
4. Scheduler: `@every 5–15m` і/або event on DHCP/lease Δ
5. Query path: MCP/phrase читає structure, не разовий RCI dump

## Категорії
infrastructure | computers | phones | tablets | tv_media | smart_home | unknown

## План змін на Orange
A. `cit/bin/ci_keenetic_lan_sync.py` — read RCI, merge passports, write `cit/state/lan-inventory.json` + Δ
B. Projection adapter у ci.collector / MCP `ci_devices` filter type=device* включає LAN
C. systemd timer `ci-keenetic-lan-sync.timer` (почати з 10m)
D. Keep phrase router як UX поверх structure (після ingest)

## Дозвіл потрібен на
- запис collector/scripts на Orange + timer unit
- зміну/розширення ci.collector або MCP device projection (код seat)
- ingest у structure (write facts/entities)

## Safe без підтвердження (зроблено)
- dry-run projection: `/workspace/ci-lan-inventory-projection.dryrun.json`
- counts: {"devices": 21, "by_category": {"infrastructure": 1, "smart_home": 3, "unknown": 10, "phones": 3, "tablets": 2, "computers": 1, "tv_media": 1}, "active": 13}

## Правила
- .54+.132 = один node orangepi3-lts
- .52 (14:14:16:…) = unknown (Gaoshengda Wi-Fi OUI) до ідентифікації
- мережу не змінювати; лише read Keenetic + write Ci state/structure
