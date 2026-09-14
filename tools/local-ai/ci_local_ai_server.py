#!/usr/bin/env python3
import json
import os
import re
import subprocess
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = os.getenv("CI_LOCAL_AI_HOST", "0.0.0.0")
PORT = int(os.getenv("CI_LOCAL_AI_PORT", "8791"))
MODEL = os.getenv("CI_LOCAL_AI_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
OLLAMA_URL = os.getenv("CI_OLLAMA_URL", "http://127.0.0.1:11434/api/chat")
VAULT_SCRIPT = Path(os.getenv("CI_VAULT_SCRIPT", r"C:\Users\simei\Ci-Rebuild\CiVault.ps1"))
MAX_MEDIA_DIRS = int(os.getenv("CI_MEDIA_MAX_DIRS", "80"))
MAX_MEDIA_ITEMS = int(os.getenv("CI_MEDIA_MAX_ITEMS", "40"))

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif", ".bmp"}
VIDEO_EXT = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".ts"}

SYSTEM_PROMPT = """Ти локальний процесор намірів Сі. Відповідай українською.
Поверни ЛИШЕ JSON без markdown. Не вигадуй виконання зовнішніх дій.
action: answer|open_gpt|media_search|vault_list|previous|next|tools|collapse_current|collapse_all|restore_context.
Для фото/відео/фільмів використовуй media_search і media_kind: photo|video|movie|any.
Якщо користувач прямо просить GPT/ChatGPT — open_gpt. Для звичайної розмови — answer.
Поля: action, answer, query, media_kind, requires_confirmation.
requires_confirmation=true для видалення, фінансової, публічної або незворотної дії."""

def _json_request(url, payload, timeout=45):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _fallback(text):
    low = text.lower().strip()
    if any(token in low for token in ("chatgpt", "gpt", "чат gpt", "чатгпт")):
        return {"action": "open_gpt", "answer": "", "query": text, "media_kind": "any", "requires_confirmation": False}
    if any(token in low for token in ("фото", "фотограф", "знімк")):
        return {"action": "media_search", "answer": "", "query": text, "media_kind": "photo", "requires_confirmation": False}
    if any(token in low for token in ("фільм", "кіно")):
        return {"action": "media_search", "answer": "", "query": text, "media_kind": "movie", "requires_confirmation": False}
    if any(token in low for token in ("відео", "ролик")):
        return {"action": "media_search", "answer": "", "query": text, "media_kind": "video", "requires_confirmation": False}
    if "назад" in low:
        return {"action": "previous", "answer": "", "query": text, "media_kind": "any", "requires_confirmation": False}
    if "далі" in low or "вперед" in low:
        return {"action": "next", "answer": "", "query": text, "media_kind": "any", "requires_confirmation": False}
    return {"action": "answer", "answer": "Я почув запит.", "query": text, "media_kind": "any", "requires_confirmation": False}

def resolve_intent(text):
    payload = {
        "model": MODEL,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "options": {"temperature": 0.15},
    }
    try:
        raw = _json_request(OLLAMA_URL, payload)
        content = raw.get("message", {}).get("content", "")
        result = json.loads(content)
        result.setdefault("action", "answer")
        result.setdefault("answer", "")
        result.setdefault("query", text)
        result.setdefault("media_kind", "any")
        result.setdefault("requires_confirmation", False)
        result["processor"] = "local-ollama"
        result["model"] = MODEL
        return result
    except Exception as exc:
        result = _fallback(text)
        result["processor"] = "fallback"
        result["model"] = None
        result["processor_error"] = str(exc)[:180]
        return result


def _vault_list(path=""):
    command = [
        "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", str(VAULT_SCRIPT), "-Action", "list", "-Path", path,
    ]
    run = subprocess.run(command, capture_output=True, text=True, timeout=35)
    if run.returncode != 0:
        raise RuntimeError((run.stderr or run.stdout or "vault_list_failed")[-300:])
    lines = [line.strip() for line in run.stdout.splitlines() if line.strip().startswith("{")]
    if not lines:
        raise RuntimeError("vault_list_no_json")
    return json.loads(lines[-1])


def _relative_vault_path(raw):
    value = str(raw or "").replace("\\", "/")
    value = re.sub(r"^https?://[^/]+", "", value, flags=re.I)
    value = re.sub(r"^/webdav/[^/]+/", "", value, flags=re.I)
    return value.strip("/")

def _matches_kind(name, kind):
    ext = Path(name).suffix.lower()
    if kind == "photo":
        return ext in IMAGE_EXT
    if kind in {"video", "movie"}:
        return ext in VIDEO_EXT
    return ext in IMAGE_EXT or ext in VIDEO_EXT


def search_media(query, kind="any"):
    words = [w for w in re.findall(r"[\wа-яіїєґ'-]+", query.lower(), re.I)
             if len(w) >= 3 and w not in {"покажи", "знайди", "фото", "фотографії", "відео", "фільми", "фільм", "мої", "наші"}]
    queue = deque([""])
    seen = set()
    matches = []
    scanned_dirs = 0
    while queue and scanned_dirs < MAX_MEDIA_DIRS and len(matches) < MAX_MEDIA_ITEMS:
        current = queue.popleft()
        if current in seen:
            continue
        seen.add(current)
        scanned_dirs += 1
        try:
            listing = _vault_list(current)
        except Exception:
            continue
        for item in listing.get("items", []):
            name = str(item.get("name") or "")
            path = _relative_vault_path(item.get("path") or name)
            if item.get("type") == "directory":
                if path and path not in seen:
                    queue.append(path)
                continue
            if not _matches_kind(name, kind):
                continue
            haystack = (path + " " + name).lower()
            score = sum(1 for word in words if word in haystack)
            matches.append({
                "name": name, "path": path, "size": item.get("size"),
                "modified": item.get("modified"), "score": score,
            })
    matches.sort(key=lambda row: (row["score"], str(row.get("modified") or "")), reverse=True)
    return matches[:MAX_MEDIA_ITEMS], scanned_dirs


def process_intent(text):
    result = resolve_intent(text)
    action = result.get("action")
    if action == "vault_list":
        listing = _vault_list("")
        result["result"] = listing
        result["answer"] = result.get("answer") or f"У сховищі бачу {len(listing.get('items', []))} елементів верхнього рівня."
    elif action == "media_search":
        items, scanned = search_media(result.get("query") or text, result.get("media_kind") or "any")
        result["result"] = {"items": items, "scannedDirectories": scanned}
        if items:
            result["answer"] = f"Знайшов {len(items)} медіафайлів."
        else:
            result["answer"] = "За поточним файловим індексом збігів не знайшов."
    return result

class Handler(BaseHTTPRequestHandler):
    server_version = "CiLocalAI/0.1"

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {
                "ok": True,
                "service": "CI.LOCAL_AI",
                "model": MODEL,
                "ollama": OLLAMA_URL,
                "tokenRequired": False,
            })
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path != "/ci/intent":
            self._send(404, {"ok": False, "error": "not_found"})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 65536)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text") or payload.get("message") or "").strip()
            if not text:
                self._send(400, {"ok": False, "error": "text_required"})
                return
            result = process_intent(text)
            self._send(200, {"ok": True, **result})
        except Exception as exc:
            self._send(500, {"ok": False, "error": str(exc)[:300]})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"ok": True, "service": "CI.LOCAL_AI", "host": HOST, "port": PORT, "model": MODEL}, ensure_ascii=False), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
