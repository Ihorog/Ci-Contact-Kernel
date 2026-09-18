import json
import time
import uuid

CONTEXT_PROMPT = """Ти Context Resolver операційної системи Сі.
Поверни ЛИШЕ JSON: {"cards":[...]} і максимум 3 картки.
Картка описує найближчий сенс користувача, а не меню програми.
Використовуй тільки наданий контекст; не вигадуй фактів чи виконання.
actual = підтверджений поточним контекстом; predicted = припущення; past = минулий стан.
Для predicted починай label зі слова «Ймовірно:».
Кожна картка: id,label,context{intent,state,relevance},
routing{taskType,capability,environment,action},
execution{mode,requiresConfirmation,status},evolution{onSuccess,onFailure}.
taskType: compute|api_call|data_processing|file_operation|persona_transformation|integration|monitoring|deployment.
environment — лише внутрішній виконавчий контекст, за замовчуванням system.
action за замовчуванням resolve_intent. Не створюй меню або назви модулів як навігацію."""

VALID_STATES = {"actual", "predicted", "past"}
VALID_TASKS = {
    "compute", "api_call", "data_processing", "file_operation",
    "persona_transformation", "integration", "monitoring", "deployment",
}


def _clamp(value, low=0.0, high=1.0):
    try:
        number = float(value)
    except Exception:
        number = low
    return max(low, min(high, number))


def _clean(value, limit=96):
    text = " ".join(str(value or "").split())
    return text[:limit].strip()


def make_card(label, intent, state="actual", relevance=0.5,
              task_type="integration", capability="resolve_intent",
              environment="system", action="resolve_intent",
              mode="local", requires_confirmation=False):
    label = _clean(label, 72) or "Сі"
    intent = _clean(intent, 220) or label
    if state not in VALID_STATES:
        state = "actual"
    if task_type not in VALID_TASKS:
        task_type = "integration"
    if state == "predicted" and not label.lower().startswith("ймовірно:"):
        label = "Ймовірно: " + label
    return {
        "id": f"ci-card-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
        "label": label,
        "context": {"intent": intent, "state": state, "relevance": _clamp(relevance)},
        "routing": {
            "taskType": task_type,
            "capability": _clean(capability, 64) or "resolve_intent",
            "environment": _clean(environment, 64) or "system",
            "action": _clean(action, 64) or "resolve_intent",
        },
        "execution": {
            "mode": "external" if mode == "external" else "local",
            "requiresConfirmation": bool(requires_confirmation),
            "status": "ready",
        },
        "evolution": {"onSuccess": [], "onFailure": []},
    }


def normalize_card(raw, index=0):
    if not isinstance(raw, dict):
        raw = {}
    context = raw.get("context") if isinstance(raw.get("context"), dict) else {}
    routing = raw.get("routing") if isinstance(raw.get("routing"), dict) else {}
    execution = raw.get("execution") if isinstance(raw.get("execution"), dict) else {}
    state = str(context.get("state") or "actual")
    label = raw.get("label") or context.get("intent") or f"Контекст {index + 1}"
    card = make_card(
        label=label,
        intent=context.get("intent") or label,
        state=state,
        relevance=context.get("relevance", max(0.1, 0.9 - index * 0.15)),
        task_type=routing.get("taskType") or "integration",
        capability=routing.get("capability") or "resolve_intent",
        environment=routing.get("environment") or "system",
        action=routing.get("action") or "resolve_intent",
        mode=execution.get("mode") or "local",
        requires_confirmation=execution.get("requiresConfirmation", False),
    )
    if raw.get("id"):
        card["id"] = _clean(raw.get("id"), 96)
    evolution = raw.get("evolution") if isinstance(raw.get("evolution"), dict) else {}
    card["evolution"] = {
        "onSuccess": list(evolution.get("onSuccess") or [])[:3],
        "onFailure": list(evolution.get("onFailure") or [])[:3],
    }
    return card


def _last_result(payload):
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    last = context.get("last_result")
    return last if isinstance(last, dict) else {}


def _current_intent(payload):
    last = _last_result(payload)
    query = _clean(last.get("query") or last.get("answer"), 180)
    if query:
        return query
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    parent = context.get("parent_card") if isinstance(context.get("parent_card"), dict) else {}
    parent_context = parent.get("context") if isinstance(parent.get("context"), dict) else {}
    return _clean(parent_context.get("intent") or parent.get("label"), 180)


def _navigation_cards(gesture, current):
    current = current or "Продовжити поточний контекст"
    if gesture in {"context_newer", "next_stage"}:
        action = "next_stage" if gesture == "next_stage" else "context_newer"
        capability = "context_next_stage" if gesture == "next_stage" else "context_newer"
        label = "Наступний етап" if gesture == "next_stage" else "Новіший контекст"
        return [
            make_card(label, label, "predicted", 0.92, capability=capability, action=action),
            make_card("Поточний контекст", current, "actual", 0.82),
            make_card("Попередній стан", "Повернути попередній стан", "past", 0.54,
                      capability="context_previous", action="previous_state"),
        ]
    if gesture in {"context_older", "previous_state"}:
        action = "previous_state" if gesture == "previous_state" else "context_older"
        capability = "context_previous_state" if gesture == "previous_state" else "context_older"
        label = "Попередній стан" if gesture == "previous_state" else "Старіший контекст"
        return [
            make_card(label, label, "past", 0.92, capability=capability, action=action),
            make_card("Поточний контекст", current, "actual", 0.82),
            make_card("Ймовірно: наступний крок", "Наступний крок у поточному контексті",
                      "predicted", 0.54, capability="context_newer", action="context_newer"),
        ]
    return None


def fallback_cards(payload):
    gesture = str(payload.get("gesture") or "tap")
    direction = str(payload.get("direction") or "")
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    parent = context.get("parent_card") if isinstance(context.get("parent_card"), dict) else {}
    last = _last_result(payload)
    current = _current_intent(payload)

    explicit = _navigation_cards(gesture, current)
    if explicit is not None:
        return explicit[:3]

    cards = []
    if gesture in {"swipe_left", "materialize_context"}:
        cards.append(make_card(
            "Поточний контекст",
            current or "Матеріалізувати поточний контекст",
            "actual", 0.94,
            capability="materialize_context",
            action="resolve_intent",
        ))

    if parent:
        parent_context = parent.get("context") if isinstance(parent.get("context"), dict) else {}
        intent = _clean(parent_context.get("intent") or parent.get("label"), 180)
        if intent and len(cards) < 3:
            cards.append(make_card("Продовжити цей контекст", intent, "actual", 0.98))

    projection = last.get("projection") if isinstance(last.get("projection"), dict) else {}
    items = projection.get("items") if isinstance(projection.get("items"), list) else []
    for item in items:
        if len(cards) >= 3:
            break
        if isinstance(item, dict):
            label = _clean(item.get("label") or item.get("name") or item.get("path"), 72)
        else:
            label = _clean(item, 72)
        if label:
            cards.append(make_card(
                label,
                f"Відкрити {label}",
                "actual",
                0.96 - len(cards) * 0.06,
                task_type="file_operation",
                capability="resolve_intent",
            ))

    if len(cards) < 3 and current:
        cards.append(make_card("Продовжити поточне", current, "actual", 0.88))

    if len(cards) < 3:
        cards.append(make_card(
            "Ймовірно: наступний крок",
            "Наступний крок у поточному контексті",
            "predicted",
            0.58,
            capability="context_newer",
            action="context_newer",
        ))

    if len(cards) < 3:
        cards.append(make_card(
            "Повернути попереднє",
            "Повернути попередній контекст",
            "past",
            0.46,
            capability="context_previous",
            action="previous_state",
        ))

    if direction == "right":
        cards.sort(key=lambda card: card["context"]["state"] != "past")
    elif direction == "up":
        cards.sort(key=lambda card: card["context"]["state"] == "past")
    return cards[:3]


def resolve_context_cards(payload, json_request, ollama_url, model):
    fallback = fallback_cards(payload)
    compact = {
        "gesture": payload.get("gesture"),
        "direction": payload.get("direction"),
        "context": payload.get("context") if isinstance(payload.get("context"), dict) else {},
    }
    request = {
        "model": model,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": CONTEXT_PROMPT},
            {"role": "user", "content": json.dumps(compact, ensure_ascii=False, default=str)},
        ],
        "options": {"temperature": 0.1},
    }
    try:
        raw = json_request(ollama_url, request, timeout=18)
        content = raw.get("message", {}).get("content", "")
        parsed = json.loads(content)
        incoming = parsed.get("cards") if isinstance(parsed, dict) else None
        if not isinstance(incoming, list):
            return fallback
        cards = [
            normalize_card(card, i)
            for i, card in enumerate(incoming[:3])
            if isinstance(card, dict)
        ]
        return cards or fallback
    except Exception:
        return fallback


def execute_context_card(payload, process_intent, finalize_result, resolver):
    raw_card = payload.get("card")
    if not isinstance(raw_card, dict):
        raise ValueError("card_required")
    card = normalize_card(raw_card)
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    execution = card.get("execution") or {}
    routing = card.get("routing") or {}
    card_context = card.get("context") or {}
    action = str(routing.get("action") or "resolve_intent")
    intent = _clean(card_context.get("intent") or card.get("label"), 220)

    if execution.get("requiresConfirmation"):
        result = finalize_result({
            "action": action,
            "answer": "Потрібне підтвердження.",
            "query": intent,
            "media_kind": "any",
            "requires_confirmation": True,
            "processor": "context-card",
        }, context)
    elif action == "resolve_intent":
        result = process_intent(intent, context)
    else:
        result = finalize_result({
            "action": action,
            "answer": "",
            "query": intent,
            "media_kind": "any",
            "requires_confirmation": False,
            "processor": "context-card",
        }, context)

    result["selected_card_id"] = card.get("id")
    next_context = dict(context)
    next_context["last_result"] = result
    next_payload = {
        "gesture": "after_action",
        "direction": "",
        "context": next_context,
    }
    return result, resolver(next_payload)
