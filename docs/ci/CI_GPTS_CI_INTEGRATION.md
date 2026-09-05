# GPTs Ci — налаштування та інтеграція

**Версія:** 1.0  
**Статус:** canonical implementation contract  
**Мета:** GPTs Ci працює як центральний інтерфейс до єдиної актуальної структури Ci через власний App/MCP-контур.

## 1. Архітектура

```text
USER
  ↓
GPTs Ci
  ↓
Ci App / MCP
  ↓
Ci Unified Structure
  ├─ components
  ├─ entities
  ├─ relations
  ├─ bindings
  ├─ dependencies
  ├─ capabilities
  ├─ facts
  ├─ state
  ├─ policy
  ├─ actions
  ├─ verification
  ├─ memory
  └─ provenance
```

GPTs Ci не є сховищем істини. Він розпізнає намір, отримує ACTUAL, читає залежності/можливості, застосовує policy/risk і викликає семантичні MCP tools.

## 2. Канонічні функціональні вузли

```text
activity
context
care
calendar
gallery
narrative
```

Їх сенс:

- `activity` — задачі, події, рутини, виконання, прогрес;
- `context` — сигнали, поточний контекст, зміни стану;
- `care` — потреби, профілі, догляд, залежні процеси;
- `calendar` — час, події, планування;
- `gallery` — медіа та візуальна пам’ять;
- `narrative` — пояснення, історія та мовна проєкція.

Персоніфіковані історичні назви не є частиною активної структури, UI, MCP schema або нових facts.

## 3. Ci ID

Усі сутності мають стабільний URI:

```text
ci://<type>/<scope>/<id>
```

Приклади:

```text
ci://node/home/orange
ci://device/home/tv
ci://network/home/lan
ci://storage/home/vault
ci://service/home/mcp
ci://component/home/calendar
```

## 4. Пріоритет стану

```text
ACTUAL > PREDICTED > TARGET
Local > Cloud
Data > UI
State > description
```

ACTUAL існує лише з provenance/evidence.

## 5. Компонент

Кожен компонент повинен підтримувати:

```text
id
type
role
scope
status
health
version
location
authority
owner
capabilities[]
interfaces[]
relations[]
bindings[]
dependencies[]
state
facts[]
actions[]
verifiers[]
last_seen
last_verified
source
provenance
```

## 6. Relations і bindings

`relation` описує семантичний зв’язок.  
`binding` описує фізичну/логічну реалізацію.

Приклад:

```text
ci://node/home/orange
  hosts → ci://service/home/mcp
  connected_via → ci://network/home/lan
  uses → ci://storage/home/vault
  provides → local_execution
```

## 7. MCP surface

### Read

```text
ci_structure
ci_get
ci_query
ci_state
ci_relations
ci_bindings
ci_dependencies
ci_capabilities
ci_facts
ci_history
ci_diff
ci_verify
search
fetch
```

### Write

```text
ci_plan
ci_action
ci_memory_append
```

### Заборонений зовнішній surface

```text
shell
exec
ssh
systemctl
write_file
rm
sudo
raw_sql
```

Ці primitives допускаються лише всередині executor layer після policy/risk gate.

## 8. Action/verification loop

```text
INTENT
→ TaskType
→ resolve entity
→ read ACTUAL
→ read relations/dependencies
→ capability
→ policy/risk
→ PLAN
→ ACTION
→ VERIFY
→ FACT
→ EVENT
→ MEMORY
→ ACTUALₙ₊₁
```

Дія не вважається завершеною тільки через успішний виклик executor. `COMPLETE` можливий лише після verification.

Результати перевірки:

```text
SUCCESS
DEVIATION
UNCERTAIN
NOT_EXECUTED
```

Policy decisions:

```text
ALLOW
CONFIRM
DENY
DEFER
```

## 9. Єдина логічна правда

Фізичні джерела можуть бути різними: SQLite, PostgreSQL, локальні файли, Vault, Cloud. Вони не створюють незалежні truth stores.

```text
many storage adapters
        ↓
one identity space
        ↓
one resolver
        ↓
one ACTUAL projection
```

## 10. GPTs Ci instructions

GPTs Ci зобов’язаний:

1. Спочатку визначити контекст і TaskType.
2. Використовувати Ci IDs як canonical identity.
3. Читати ACTUAL, relations і dependencies перед state-changing action.
4. Не вигадувати фактичний стан.
5. Не викликати raw executor tools напряму.
6. Перевіряти capability і policy.
7. Після write виконувати verification.
8. Не повідомляти COMPLETE без verification evidence.
9. Після підтвердженої зміни формувати новий FACT з provenance.
10. Не створювати дублюючі registry/truth stores.

## 11. Acceptance gates

```text
canonical_component_ids_valid = true
raw_executor_tools_public = false
actual_without_provenance = 0
complete_without_verification = 0
broken_relations = 0
orphan_components = 0
unbound_capabilities = 0
active_personified_labels = 0
```

## 12. Definition of Done

Інтеграція завершена тільки коли фактично проходить цикл:

```text
GPTs Ci
→ Ci App/MCP
→ ci_structure
→ resolve entity
→ read relations/bindings/capabilities
→ policy decision
→ permitted action
→ independent verification
→ new fact
→ updated ACTUAL
```

Без ручного SSH, ручного редагування бази і без Desktop Commander у штатному контурі.
