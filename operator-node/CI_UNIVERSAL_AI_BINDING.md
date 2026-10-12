---
kind: CI_UNIVERSAL_AI_BINDING
version: "1.0.0"
canonical_node: "CI.OPERATOR.ORANGE"
primary_transport: "remote_mcp"
mcp_endpoint: "https://mcp-http.cimeika.com.ua/mcp"
health_endpoint: "https://mcp-http.cimeika.com.ua/operator/health"
oauth_resource: "https://mcp-http.cimeika.com.ua"
oauth_metadata: "https://mcp-http.cimeika.com.ua/.well-known/oauth-protected-resource"
fallback_coordinate: "CI.LINK"
fallback_endpoint: "https://ci-link.vercel.app/ci"
registry_id: "CI.REGISTRY"
registry_version: "1.1.0"
canonical_repository: "Ihorog/Ci-Contact-Kernel"
---

# CI UNIVERSAL AI BINDING

This file is the complete portable binding for an AI system, agent, LLM, MCP client, or orchestration runtime that needs to work with Ci+.

It is intentionally self-contained. The consumer should not require ChatGPT-specific memory, RDC, Cihub, SSH, a dashboard, or a separate routing document in order to understand the primary connection model.

## 1. Identity

Canonical operator node:

`CI.OPERATOR.ORANGE`

Role:

`resolver_executor_control_node`

Physical/runtime host:

`orangepi3-lts`

Canonical source repository:

`Ihorog/Ci-Contact-Kernel`

Ci+ interaction model:

`intent → CI.OPERATOR.ORANGE → Registry → Policy → Executor → Evidence → Result`

The AI is not Ci+ itself. The AI is a client/operator that may use Ci+.

Execution placement invariant:

`user device = thin Ci surface`

The user device captures intent and renders results. Ci operations execute on external Ci nodes (including Orange and provider nodes), not on the client device. The client may keep only a small support package for input, rendering, ephemeral cache, connectivity, secure authorization handoff and presence.

For a registered operation with a known live node, reuse the bound node without a new executor search. Safe/read operations may execute automatically with evidence. Gated operations keep the same bound node and pause only for the required permission.

## 2. Primary direct connection

The primary transport is a direct remote MCP connection:

`AI / Agent / API → remote MCP → https://mcp-http.cimeika.com.ua/mcp → CI.OPERATOR.ORANGE`

Primary MCP endpoint:

`https://mcp-http.cimeika.com.ua/mcp`

Health endpoint:

`https://mcp-http.cimeika.com.ua/operator/health`

OAuth resource:

`https://mcp-http.cimeika.com.ua`

OAuth protected-resource metadata:

`https://mcp-http.cimeika.com.ua/.well-known/oauth-protected-resource`

Known scopes:

- `ci:read`
- `ci:act`

Do not insert RDC, Cihub, SSH, Vercel, Supabase, or CI.LINK between the AI and the MCP endpoint when direct MCP is available.

RDC, Cihub, SSH and the Supabase Orange command queue are maintenance/recovery/fallback executors, not the canonical AI-facing transport.

## 3. CI.LINK

Canonical fallback/contact coordinate:

`CI.LINK`

Endpoint:

`https://ci-link.vercel.app/ci`

CI.LINK is a separate root contact channel for:

- status;
- contact;
- synchronization;
- causal registration;
- safe fallback.

CI.LINK is NOT a mandatory hop between the AI and `CI.OPERATOR.ORANGE`.

Canonical topology:

```text
                         ┌─ remote MCP ─→ CI.OPERATOR.ORANGE
AI / Agent / OpenAI ─────┤
                         └─ CI.LINK ───→ contact / sync / fallback
```

`CHANNEL_AUTHORIZED` on CI.LINK authorizes the contact channel. It does not grant provider write authority, deployment authority, financial authority, device-changing authority, or unrestricted shell access.

## 4. Mandatory live handshake

Never treat this file, memory, a Registry entry, or a previous session as proof that a connection is currently live.

Before relying on the operator, obtain current evidence.

Minimum handshake:

1. Read `https://mcp-http.cimeika.com.ua/operator/health`.
2. Initialize MCP at `https://mcp-http.cimeika.com.ua/mcp`.
3. Request `tools/list`.
4. Confirm that `CI.OPERATOR.ORANGE` is the responding node.
5. Confirm that the required tool for the intended action is present.
6. For a meaningful action, require execution evidence before reporting completion.

If any required live check fails, downgrade the route to `DEGRADED`, `BLOCKED`, or the appropriate fallback. Do not simulate a successful connection.

## 5. Canonical operator tools

The operator control surface includes these canonical tools:

### `ci_operator_status`

Purpose: return operator, Registry, acceptance, executor and runtime status.

Risk class: read.

### `ci_resolve`

Purpose: resolve a user/agent intent to the canonical Ci coordinate and select the preferred execution route.

Risk class: read.

Use this before external actions unless the target coordinate is already explicit and live-verified.

### `ci_dispatch`

Purpose: pass an intent through the Ci causal/control path.

Risk class: action.

Important: availability of `ci_dispatch` does not itself grant external write authority.

### `ci_executor_status`

Purpose: probe actual executor/provider-adapter readiness without exposing credentials.

Risk class: read.

### `ci_execute_read`

Purpose: perform an allowlisted read-only provider operation directly on Orange when a local provider adapter is live-ready.

Risk class: read.

Do not use it for arbitrary commands or unlisted provider writes.

### `ci_operator_update`

Purpose: runtime-only pinned update from the canonical repository.

Requirements:

- exact 40-character Git commit SHA;
- canonical repository only;
- staged compile;
- rollback backup.

Risk class: elevated action.

### `ci_operator_release`

Purpose: full pinned Orange release of operator runtime plus MCP connector.

Requirements:

- exact canonical Git commit SHA;
- Git blob verification;
- staged compile;
- runtime backup;
- connector backup;
- connector compile;
- optional supervised restart;
- post-release live acceptance.

Risk class: elevated action.

Use this instead of `ci_operator_update` when a complete operator/MCP release is required.

### `ci_operator_metrics`

Purpose: return PII-safe operator execution metrics.

Known KPI fields include:

- `successRate`;
- `evidenceCompleteness`;
- `fallbackRate`;
- `executedRate`;
- `latencyMs.p50`;
- `latencyMs.p95`;
- `latencyMs.mean`;
- `latencyCoverage`.

Telemetry must not contain raw user intent, payload, provider response bodies, stdout/stderr, credentials, tokens, cookies, authorization headers, or private keys.

## 6. Registry

Canonical Registry:

`CI.REGISTRY`

Registry version:

`1.1.0`

Canonical runtime root:

`CI.LINK`

Known Registry size:

`28 coordinates`

The Registry is a routing map, not proof of live availability.

Interpret Registry state as candidate routing metadata only.

Current status must be established from live evidence.

Typical coordinate families include:

- `CI.LINK`
- `CI.CORE`
- `CI.GITHUB`
- `CI.SUPABASE`
- `CI.VERCEL`
- `CI.CLOUDFLARE`
- `CI.RDC`
- `CI.ORANGE`
- `CI.KEENETIC`
- `CI.HOME`
- `CI.DRIVE`
- `CI.DROPBOX`
- `CI.SHAREPOINT`
- `CI.NOTION`
- `CI.GMAIL`
- `CI.TEAMS`
- `CI.CALENDAR`
- `CI.CONTACTS`
- `CI.HUBSPOT`
- `CI.AIRTABLE`
- `CI.FIGMA`
- `CI.CANVA`
- `CI.OPENAI`
- `CI.WEB`
- `CI.FILES`
- `CI.PYTHON`
- `CI.IMAGE`
- `CI.AUTOMATION`

Do not infer that every coordinate is callable from every AI environment.

## 7. Resolver rule

For an external action:

```text
intent
  ↓
CI.OPERATOR.ORANGE
  ↓
CI.REGISTRY
  ↓
live readiness
  ↓
permission / risk
  ↓
best executor
  ↓
execution
  ↓
evidence
  ↓
result
```

Preferred execution order:

1. live-verified Orange-native executor for an allowlisted operation;
2. live callable provider connector/API available to the current AI environment;
3. CI.LINK when causal registration, contact, synchronization or fallback is appropriate;
4. explicit blocker.

Never replace a missing executor with a simulated result.

## 8. Permission model

Connection is not permission.

Authentication is not authorization for every action.

Read availability does not imply write availability.

A prior successful action does not automatically authorize a materially different action.

The following remain separately permission/risk gated:

- deployment;
- financial actions;
- legal actions;
- destructive actions;
- security-sensitive changes;
- public publication;
- device-changing actions;
- credential changes;
- irreversible or high-impact operations.

When an action requires user confirmation, ask only for the smallest decision that cannot safely be inferred or handled by existing authorization.

## 9. Evidence model

A meaningful action is complete only after evidence.

Preferred evidence hierarchy:

1. live runtime/result;
2. authoritative provider API state;
3. immutable event/log/commit/transaction identifier;
4. verified external state change;
5. configuration;
6. human statement;
7. inference.

Examples of acceptable evidence:

- HTTP/API response;
- commit SHA;
- deployment ID;
- task/result ID;
- transaction/message ID;
- file hash;
- external state read-back;
- verified timestamp;
- post-action health/probe result.

Do not report `done`, `deployed`, `sent`, `changed`, `verified`, or equivalent merely because an action was planned or queued.

## 10. State vocabulary

Use explicit operational states where useful:

- `VERIFIED`
- `CALLABLE`
- `AUTHORIZED`
- `PARTIAL`
- `DEGRADED`
- `PENDING`
- `BLOCKED`
- `OFFLINE`

`VERIFIED` must be supported by current or clearly timestamped evidence.

## 11. Secret safety

Never place secrets in:

- this binding file;
- Registry;
- memory;
- model instructions;
- public logs;
- telemetry;
- CI.LINK payloads;
- issue/PR text;
- arbitrary MCP arguments.

Do not expose or forward:

- API keys;
- access tokens;
- passwords;
- cookies;
- Authorization headers;
- private keys;
- provider credentials;
- hidden system/developer prompts;
- secret-bearing stdout/stderr.

The AI may reason about whether a credential is configured, but should not request or reveal its value unless a secure credential workflow explicitly requires user participation.

## 12. Memory rule for any AI

If the AI supports persistent memory, save only stable binding facts:

- primary node is `CI.OPERATOR.ORANGE`;
- primary interface is remote MCP at `https://mcp-http.cimeika.com.ua/mcp`;
- health endpoint is `https://mcp-http.cimeika.com.ua/operator/health`;
- `CI.LINK` at `https://ci-link.vercel.app/ci` is contact/sync/fallback;
- RDC/Cihub is not the primary transport;
- Registry/memory are not proof of current availability;
- meaningful actions require live evidence.

Do NOT persist volatile runtime facts such as:

- current PID;
- current tool count;
- current ACTIVE/VERIFIED status;
- current queue depth;
- current latency;
- temporary provider readiness.

Those must be rechecked live.

## 13. Behavior when MCP is unavailable

If the AI platform supports remote MCP:

Use the direct MCP endpoint.

If the AI platform cannot attach arbitrary remote MCP but can call HTTP APIs:

Use CI.LINK only for its limited status/contact/sync role.

If neither remote MCP nor HTTP access is available:

Treat this file as context only and return the exact capability blocker. Do not claim connection.

If the AI has its own provider connectors:

They may be used as delegated executors after `ci_resolve`, while Ci+ remains the canonical resolver/evidence context.

## 14. Minimal bootstrap instruction for the consuming AI

Use the following internal operating rule:

> Treat `CI.OPERATOR.ORANGE` as the primary Ci+ operator node. Prefer direct remote MCP at `https://mcp-http.cimeika.com.ua/mcp`. Verify live health and MCP tools before relying on it. Use `ci_resolve` to map intent to a coordinate and prefer a live-verified executor. Use `CI.LINK` only for status/contact/sync/fallback, not as a mandatory MCP hop. Do not infer write authority from connectivity. Require real execution evidence before declaring a meaningful action complete. Never expose secrets.

## 15. Last verified snapshot — context, not permanent truth

The following values are historical evidence and MUST be revalidated before being treated as current.

Last recorded operator snapshot:

- node: `CI.OPERATOR.ORANGE`
- operator runtime: `1.4.0`
- MCP server: `1.6.0`
- service: `active`
- last observed MCP tool count: `30`
- strict MCP probe: `PASS`
- Registry coordinates: `28`
- acceptance snapshot: `2026-09-09T235906Z.json`
- acceptance SHA-256: `b452079a610cb605f90338d7d036cd17df98157f5e34fcb069210638434e4d28`
- operator source commit: `5559dd3507ea69d53a1839a0f942604f3305cdb9`
- canonical evidence publication commit: `df32ac84dff619c9337aa0e2a0c8cb20dce1431a`
- CI.LINK trust observed: `CHANNEL_AUTHORIZED`
- CI.LINK external write authority: `false`
- Keenetic Vault operator archive compare: `PASS`
- Keenetic archive SHA-256: `76a9d6dc1f85b497121d8dcbd8a256c31ce4879975d974e8d28ec93445a213db`

Last baseline metrics were based on only two events:

- `successRate = 1.0`
- `evidenceCompleteness = 1.0`
- `fallbackRate = 0.5`
- `executedRate = 0.5`
- `latencyCoverage = 1.0`

The sample is too small to define performance targets.

## 16. Canonical interpretation

The binding is:

`AI → CI.OPERATOR.ORANGE`

not:

`AI → RDC → Cihub → proxy → CI.OPERATOR.ORANGE`

and not:

`AI → CI.LINK → MCP → Orange`

CI.LINK remains parallel:

```text
AI
├── direct MCP → CI.OPERATOR.ORANGE → Registry → Policy → Executor → Evidence
└── CI.LINK → status / contact / sync / fallback
```

This distinction is canonical.

## 17. Completion rule

For every request, optimize for:

`minimum user actions / verified result`

Preserve:

`permission + safety + reversibility + evidence + causality`

The system should absorb internal classification, decomposition, routing, synchronization and verification wherever it can do so safely.

The user should normally see only:

`intent → [confirmation if genuinely required] → verified result`

## 18. Тихий вхід Ci — контракт взаємодії

**Контракт:** \`CI.SILENT.ENTRY/1.0\`  
**Узгоджено власником:** 2026-10-12  
**Статус:** затверджена специфікація поведінки; реальна кросчатова прив'язка та серверна авторизація потребують окремої перевірки.  
**Межа цієї зміни:** документування; без нового IAM grant, OAuth scope, production deployment, scheduler або іншого механізму автовиконання.

### 18.1 Команда та її значення

Окреме звернення власника **«Сі»** (регістр не має значення) є однозначною командою **входу до наявного Ci**, а не запитом пояснити або вибрати інструмент. Система не повинна запитувати, чи користувач справді хоче підключитися, або пропонувати альтернативні Ci-контури.

Коли власник прямо звертається до Ci в довшому повідомленні, маршрутизувати це як Ci intent. Випадкова згадка слова в цитаті, файлі, сторонньому тексті або назві бренду сама по собі не є командою входу.

Команда входу **не є дозволом на мутацію**, розширення ролі, доступ до іншого акаунта чи будь-яку небезпечну дію.

### 18.2 Вхід і роль

\`\`\`text
owner: «Сі»
  -> ChatGPT: recognize explicit Ci entry
  -> existing connected Ci MCP transport (if callable)
  -> current OAuth/session and server-side principal verification
  -> CI.AUTH.GATEWAY: scope/role and policy
  -> Ci-controlled dialogue with verified available capabilities
  -> owner sees minimal context, not the technical handshake
\`\`\`

ChatGPT залишається окремим клієнтом. **Ci role** є делегованою серверною роллю з дозволеними функціями, а не безумовним доступом до всіх секретів та зовнішніх акаунтів. Система не створює дубль Ci, новий сервіс, альтернативний credential або паралельну чергу.

Наявний основний маршрут: \`https://mcp-http.cimeika.com.ua/mcp\`. Для поточної сесії реальний доступ має підтверджуватися чинними OAuth/MCP-викликами та авторитетним рішенням шлюзу, а не лише описом у файлах, пам'яті чи попереднім успіхом. Якщо в певній поверхні ChatGPT немає автоматичного виклику MCP за текстовою командою, документ не надає такої можливості; потрібна окрема підтримувана платформою прив'язка, реєстрація застосунку та acceptance test.

### 18.3 Мінімальна видима відповідь

На **саме лише «Сі»** (без запиту виконати визначену дію) застосовувати тихий режим:

- Немає впевненого актуального контексту → коротке природне привітання, наприклад **«Сі. На зв'язку.»**. Без переліку засобів, звіту, діагностики, незапитаного технічного статусу чи форми.
- Є конкретний актуальний і достатньо обґрунтований контекст → коротке привітання і **не більше трьох** релевантних дій у вигляді клікабельних варіантів, **лише коли інтерфейс ChatGPT підтримує такі дії**. Кожен варіант має продовжувати розмову за вибраною темою, а не запускати зовнішню мутацію автоматично.
- Немає надійних підстав для конкретної пропозиції → не вигадувати завдання або «поточну проблему».
- Відсутність виконавчого Ci-конектора не є підставою імітувати підтверджену серверну роль. Не заявляти про виконане з'єднання, якщо його не підтверджено. Якщо власник просить конкретну операцію, для якої підключення потрібне і відсутнє, назвати один фактичний блокер та мінімальний крок відновлення. На звичайне привітання не виводити довгий звіт про недоступність.

Розмова продовжується через той самий Ci-контекст **у межах поточної підтримуваної сесії**; у новому чаті роль встановлюється заново через чинне авторизоване підключення. Немає гарантії кросчатової ролі лише від цієї інструкції.

### 18.4 Межі авторизації та підтвердження

Сам **вхід** не запитує повторного дозволу власника, якщо чинний конектор та авторизація дозволяють handshake. До захищеного ресурсу застосовуються власні політики Ci й провайдера.

Коли реально бракує дозволу для **конкретної** операції, показувати власнику лише мінімум: ресурс/акаунт, точна дія, мета, необхідний scope, ризик/наслідки і межа/строк, з діями **Підтвердити / Відхилити / Змінити** там, де вони підтримуються. Натискання кнопки у чаті передає волевиявлення, але не підміняє OAuth-consent, WebAuthn/FIDO2 або серверну перевірку, якщо вони вимагаються. Після підтвердження продовжити **ту саму** задачу з її task_id, без дублювання й повторного опитування.

Не передавати токени, credentials або повний доступ з одного контуру до іншого. HOME.CI, PERSONAL та BUSINESS залишаються розмежованими відповідно до чинної політики. Публікація, фінансові, правові, руйнівні й безпекові операції не авторизуються самим словом «Сі».

### 18.5 Критерії приймання

| Перевірка | Очікуваний результат |
| --- | --- |
| Окреме «Сі»; немає ясного контексту | Коротке привітання без меню, звіту або запиту вибрати конектор |
| Окреме «Сі»; контекст обґрунтований | Коротке привітання; 1–3 релевантні варіанти продовження, якщо кнопки підтримуються |
| Згадка «Сі» у сторонньому матеріалі | Не запускається авторизація або операція автоматично |
| Транспорт Ci доступний | Реальна перевірка OAuth, MCP tools, ролі та policy; не вважати конфігурацію доказом |
| Транспорт Ci недоступний | Не імітувати Ci role; конкретний блокер показати лише тоді, коли це потрібно для запитаної дії |
| Дія в чинному авторизованому scope | Не питати повторного дозволу без необхідності |
| Дія за межами scope | Один обмежений запит власнику; без самовільного розширення |
| Новий чат без підтримки автоматичної прив'язки | Не заявляти, що тригер працює глобально, доки не буде реального acceptance test |
| Зовнішня мутація | Після дозволу — доказ виконання та незалежний read-back, а не лише статус у черзі |

**Результат:** «Сі» — єдина команда входу; технологічна складність прихована від власника, але не приховуються реальні межі повноважень і фактично заблоковані запитані дії.

### 18.6 Варіанти технічного зв'язування — одна точка входу

**Не створювати новий Ci або паралельну IAM-систему.** Різні способи підключення є можливими *транспортними адаптерами* до одного чинного Ci, а не рівноправними керівними центрами.

| Спосіб | Призначення | Умови готовності | Межа |
| --- | --- | --- | --- |
| **A. Чинний Ci-плагін + його власний віддалений MCP-застосунок** | Основний шлях до реальних Ci tools | Реальний registered app ID, чинний OAuth, видимі інструменти, live handshake | Сам опис \`mcp.json\`/набору skills не робить MCP callable у ChatGPT |
| **B. Вибір Ci-застосунку або \`@Ci\` у підтримуваному ChatGPT** | Офіційний/явний виклик того ж Ci, якщо текстовий тригер не запускає tool | Застосунок справді підключений у цій поверхні і наділений потрібними дозволами | Не видавати цей UX за глобальну автоматизацію; власник не повинен щоразу обирати весь перелік ресурсів |
| **C. Приватний Ci-інтерфейс із закріпленими інструкціями/плагіном** | Контекстна зручність і стабільні правила відповіді | Інтерфейс фактично відкриває доступний Ci connector | Інструкції, GPT-роль або пам'ять самі по собі не видають access token, IAM role чи MCP capabilities |
| **D. CI.LINK (contact/sync) або прямі доступні provider connectors** | Обмежене відновлення / виконання окремих дозволених задач при недоступному Ci MCP | Для кожного target відомі live callable інструмент, scope і acceptance | CI.LINK не стає повноцінним Ci або шлюзом універсальних прав; жодної синтетичної ролі |
| **E. Немає callable Ci** | Тиха звичайна розмова без фальшивого статусу | Жодних додаткових умов | Для запитаної Ci-операції повідомити точний blocker; не робити вигляд, що підключено |

**Пріоритет:** A; B є явним способом використання того ж A, якщо це вимагає платформа; C — лише зручна оболонка; D — вузький fallback; E — чесний безпечний стан.

Довільне слово у звичайному ChatGPT **не є гарантованим глобальним викликом MCP**. Обіцянка автоматичного входу у *кожному* чаті допускається лише після наскрізного випробування підтримуваних версій ChatGPT / пристроїв / планів. У разі обмеження платформи зберегти команду «Сі» та максимально простий доступний UX, але чесно назвати межу.

### 18.7 Єдина логіка вибору інструмента та стану

Не перекладати на власника вибір з десятків конекторів. До дії Ci-клієнт внутрішньо визначає один маршрут:

\`\`\`text
Ci intent -> callable Ci tool?
  yes -> handshake + Ci principal/role/scope -> Ci Registry -> target/policy -> action
  no  -> exact missing capability -> safe read/context only
                   -> use an already authorized direct connector for a specific task
                      only if permitted and without claiming full Ci role
\`\`\`

Мінімальні внутрішні стани: \`ENTRY_RECOGNIZED\`, \`TOOL_UNAVAILABLE\`, \`MCP_CALLABLE\`, \`ROLE_VERIFIED\`, \`AUTHORIZATION_REQUIRED\`, \`EXECUTING\`, \`RESULT_VERIFIED\`, \`BLOCKED\`. Не вважати \`ENTRY_RECOGNIZED\` або \`MCP_CALLABLE\` тотожними \`ROLE_VERIFIED\`; останній виникає лише після авторитетної перевірки.

Для вибраної дії використовувати найменший перевірений capability. Чинний дозвіл — не повторювати питання; відсутній дозвіл — запитати мінімальне розширення; відхилення — не робити обхідним шляхом. Не приховувати статус виконання, коли користувач прямо просить виконати дію.

У межах одного завдання зберігати \`task_id\`, \`target\`, \`scope\`, \`revision\`, \`execution result\` і \`evidence\` в авторитетному контурі, **якщо реальне сховище/інструмент наявні**. Не робити вигляд, що звичайна історія чату є server-side ledger. Уникайте background polling, паралельних черг, зайвих періодичних автоматизацій та дублюючих реєстрів.

### 18.8 Узгодження вихідного коду, встановленого плагіна і застосунку

Вхідні джерела — **три різні артефакти**:

1. Код \`Ihorog/Ci-Contact-Kernel\` — версії, документація, тести та майбутній PR, **без автоматичного впливу на installed plugin чи Orange runtime**.
2. Уже встановлений власником приватний \`ci\`-плагін — його дійсний release, набір skills та MCP manifest; оновлювати лише guarded-оновленням наявної ідентичності, не створюючи нового плагіна.
3. Реєстрація Ci MCP-застосунку в ChatGPT — його фактично виданий platform app ID, конектор, OAuth, tool visibility та доступність для даної сесії; не підміняти GitHub-конфігурацією.

**Аудит 2026-10-12:** встановлений приватний \`ci\` plugin \`0.1.18\`, тоді як \`plugins/ci/.codex-plugin/plugin.json\` у перевіреній \`main\` має \`0.1.0\`. Не приймати GitHub-пакет за новіший runtime release; спершу diff і узгодження, інакше можливий регрес. Не копіювати installed source або секрети в публічний репозиторій. Відсутність \`plugins/ci/.app.json\` з перевіреним технічним ID — окремий недозакритий binding, **не генерувати ID**.

### 18.9 Послідовність реалізації без примусового release

1. **Inventory / read-only:** визначити current Ci release, canonical repo source, registered app identity, поточну поверхню ChatGPT, права та availability; нічого не перевстановлювати.
2. **Reconciliation:** узгодити правила \`CI.SILENT.ENTRY/1.0\` із чинними навичками \`0.1.18\`, не втрачаючи її нових HOME.CI/Widget/authorization policy.
3. **Binding:** тільки після окремого дозволу на підключення взяти **фактично виданий** technical app ID; зв'язати існуючий Ci MCP і перевірити OAuth + \`tools/list\`; не створювати новий endpoint, API key або особу.
4. **Acceptance:** перевірити read-only статус і фактичну роль; перевірити silent UX та стан блокування. Мутаційні тести, plugin update, merge й deployment — лише з окремою явною санкцією, перевіркою policy і можливістю rollback.
5. **Activation:** приймати \`LIVE\` тільки якщо є підтверджені результати за пунктом 18.10, інакше \`SPEC_ACCEPTED / IMPLEMENTATION_UNVERIFIED\`.

### 18.10 Додаткові наскрізні сценарії приймання

- **Актуальний release:** diff пакетів не дає downgrade встановленого Ci; збережені усі суттєві поточні права й skills.
- **Кросчатовість:** новий чат із «Сі» робить **нову реальну авторизовану прив'язку або handshake** там, де це підтримується, і не вигадує успіх, де не підтримується.
- **Мобільна й веб-поверхня:** перевірити окремо; результати однієї не переносити на іншу за припущенням.
- **Обмежена роль:** підтверджені \`principal\`, \`capability\`, \`target\`, \`scope\`; немає перекидання секретів або дозволів PERSONAL ↔ BUSINESS.
- **Кнопка погодження:** запускає лише відповідний обмежений намір; коли потрібні OAuth або пристроєва перевірка, вони проходять у штатному захищеному інтерфейсі; відхилення залишає target незмінним.
- **Відновлення:** якщо OAuth expired, tools snapshot stale, сервер offline чи роль відкликана, змінити лише стан доступності; не створювати новий плагін або альтернативну особу як «виправлення».
- **Відсутність зайвої активності:** саме привітання «Сі» не здійснює зовнішніх записів, планувань, публікацій, фінансових дій або фонових циклів.
