# Orange Dual-Root Canon

**Status:** LOCKED (structural)
**Updated:** 2026-09-11T10:13:45.340761+00:00

## Roots

| Root | Path | Role |
|---|---|---|
| **Runtime seat** | `/home/kazkar/cit` | UI, state, modules, secrets, exec node, home ops (~962MB) |
| **Registry slim** | `/home/kazkar/cimeika/cit` | CI.REGISTRY v1.1.0 + vault (~148KB) |

Do **not** create a third true Ci root.
Operator identity: `CI.OPERATOR.ORANGE` (binding). Seat hardware is not Ci identity.

## UX target (Product Canon v2.0)

User face: Widget Passive → Context → Confirm → Result.
Legacy sidebar modules / dashboard / external admin links are not core (freeze, then remove from user path).
Maintenance (`admin.html`, health, systemd) stays on seat, out of Moment.
