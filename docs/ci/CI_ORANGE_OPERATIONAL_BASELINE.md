# Ci+ Orange Pi 3 LTS — операційний базовий стан

> **Статус:** `ACCEPTED / VERIFIED BASELINE`  
> **Дата фіксації:** 2026-09-01  
> **Власник стану:** Ci+ Control Plane  
> **Призначення:** єдина вихідна точка для всіх наступних робіт з Orange Pi. Перед будь-яким аудитом, відновленням або повторним підключенням спочатку читати цей документ.

## 1. Канонічна роль вузла

- Плата: **Orange Pi 3 LTS**.
- Hostname: `orangepi3-lts`.
- Роль: **Ci+ Local Action Bridge** — локальне виконання, домашні конектори, журнали та підтвердження.
- Канонічний канал адміністрування: **Cihub (Windows) → SSH public key → `kazkar`**.
- Поточна LAN-адреса зберігається у внутрішньому інвентарі; ідентичність вузла не залежить від IP.
- SSH password authentication вимкнений; це очікувана політика, а не несправність.
- Root-доступ через SSH-ключ не налаштований. Адміністративні дії виконуються через `sudo` користувача `kazkar`.
- Пароль адміністратора не зберігається в GitHub, коді, журналах або документації. Після випадкового розкриття 2026-09-01 пароль було змінено.

## 2. Фінальний підтверджений стан

| Контур | Стан |
|---|---|
| Коренева файлова система | 57 ГБ; 5,9 ГБ використано; 51 ГБ вільно; 11% |
| `master-orchestrator.service` | активний, канонічний оркестратор |
| `ci-orchestrator.service` | вимкнений як точний дубль |
| `groq-agent.service` | активний; Redis queue worker |
| `groq_agent.py` | активний окремий health/automation агент; не є дублем `groq_agent_new.py` |
| `ci-orange-lounge-watch.timer/service` | вимкнені як зламаний і непотрібний контур |
| Docker / Docker socket / containerd | вимкнені; контейнерів та образів не було |
| WebDAV `/mnt/cimeika_vault` | змонтований; сім застарілих recovery-архівів видалено; виконано фінальне перемонтування |
| Health endpoints | OK; конкретні адреси, домени та порти зберігаються у внутрішньому інвентарі |

## 3. Виконане очищення

### Локальні snapshots

- Видалено рівно **89** файлів `/home/kazkar/cit_snapshots/cit_daily_*.tar.gz`.
- Сумарно видалено **48 695 623 101 байт**.
- Із crontab вилучено `17 3 * * * /home/kazkar/cit/daily_backup.sh`, щоб snapshots не створювалися повторно.
- Безпечні кеші `~/.cache`, `~/.npm/_cacache`, `~/.npm/_logs` очищено: **443 420 338 байт**.
- Робочі `.npm-global`, `node_modules`, `ci_env`, `.claude-server-commander` не видалялися.

### WebDAV / Keenetic vault

Видалено рівно сім застарілих архівів із `/mnt/cimeika_vault/lost+found`:

- `cit_daily_20260521_031701.tar.gz-Hh2xnf`
- `cit_daily_20260519_031701.tar.gz-tmHkxL`
- `cit_daily_20260520_031701.tar.gz-mBKbID`
- `cit_daily_20260518_031701.tar.gz-cpT6sO`
- `cit_daily_20260516_031701.tar.gz-ZITXik`
- `cit_daily_20260511_031701.tar.gz-DynJgz`
- `cit_daily_20260506_031701.tar.gz-ebVvwg`

Сумарно: **4 229 975 156 байт**. Повторне відновлення цих файлів заборонене: перевірений recovery bundle уже збережений на Cihub.

## 4. Recovery baseline на Cihub

- Bundle: `%USERPROFILE%\Ci-Rebuild\orange-recovery-20260830.tar.gz`
- Розмір: **845 457 001 байт**
- SHA-256: `29fa8adf1c37edfaf24c6324cce58daaa3a6a7cb35b164fcc8669f2a2cf7d60d`
- Перевірка архіву: успішна.
- Образ: `%USERPROFILE%\Ci-Rebuild\Armbian_26.8.2_Orangepi3-lts_trixie_current_6.18.44_minimal.img.xz`
- SHA-256 образу: `00807af5fbbd160ccd238b049f34c899aa7fc4fc6885ad92151574797ed90ad9`
- Root-service backup: `/home/kazkar/cit/logs/root-service-backup-20260901-112508`.

Recovery bundle не містить snapshots, кешів і залежностей, які відтворюються. Три root-only nginx-файли не копіювалися: старий backup, `.ci_external_htpasswd`, `ssl-key.pem`; у разі rebuild вони генеруються заново, а не відновлюються зі старого стану.

## 5. USB і живлення — остаточне рішення

- Orange Pi 3 LTS не має Micro-USB.
- Type-C використовується для живлення.
- Не підключати Windows USB-A ↔ Orange USB-A звичайним A-to-A кабелем: USB-A є host-контуром і не використовується як адміністративний канал.
- Не створювати USB RNDIS/gadget-конфігурацію для цієї плати.
- Прямий дротовий канал — Ethernet.
- Аварійна консоль — USB-to-TTL **3,3 В**, лише `GND/TX/RX`, без 5 В.
- Основний робочий канал залишається SSH через LAN.

## 6. Заборона повторного відновлення

Без нового фактичного доказу або прямого рішення власника **не можна**:

1. повторно вмикати `ci-orchestrator.service`;
2. повторно вмикати Lounge Watch;
3. повторно вмикати Docker/containerd;
4. повертати видалений cron `daily_backup.sh`;
5. відновлювати видалені snapshots або сім WebDAV recovery-архівів;
6. будувати USB-A gadget/RNDIS канал;
7. трактувати Plink password failure як розрив SSH — сервер навмисно приймає тільки public key;
8. починати повторний повний аудит доступів, якщо SSH-ключ Cihub і health endpoints працюють.

Перегляд цього baseline дозволений лише якщо:

- змінилася фізична плата або носій;
- виконано новий Armbian rebuild;
- є нова помилка, підтверджена поточним журналом або health-check;
- власник прямо змінив рішення.

## 7. Правило для наступних агентів

`ACTUAL` має пріоритет над `PREDICTED` і `TARGET`. Історичні попередження до дати цього baseline не є новою несправністю. Не відтворювати видалені компоненти «про всяк випадок». Спочатку перевірити цей документ, потім виконати мінімальний актуальний health-check, і лише після нового доказу відкривати інцидент.
