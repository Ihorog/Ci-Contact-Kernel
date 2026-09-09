# Ci Registry v1.1

## Робоча модель
`intent → index → coordinate → via → live verification → action → evidence`

### Що читає GPT
1. `ci-registry.json` — завжди, коли потрібен зовнішній зв’язок.
2. `ci-link-passport.json` — лише коли використовується корінь `CI.LINK`.
3. `ci-registry-catalog.json` — тільки для пояснення/аудиту/редагування.

### Оптимізація
Початкова повна карта була ~12.9 KB. Runtime-карту відокремлено від описового каталогу, щоб:
- менше knowledge-контексту на кожне звернення;
- не дублювати опис сервісів;
- не зберігати live-статуси;
- залишити один стабільний алгоритм `direct → CI.LINK → safe fallback`.

### Безпека
Registry не містить credentials. Наявність маршруту не дорівнює дозволу на write.
