import base64
import hashlib
import os
import shutil
from pathlib import Path

VERSION = "1.0.0"
ROOT = Path(os.getenv("CI_VAULT_ROOT", "/mnt/cimeika_vault"))
MAX_CHUNK = int(os.getenv("CI_VAULT_MAX_CHUNK", str(4 * 1024 * 1024)))


def _root():
    return ROOT.resolve(strict=False)


def _path(value=""):
    root = _root()
    raw = str(value or "").replace("\\", "/").strip("/")
    if any(part == ".." for part in raw.split("/")):
        raise ValueError("path_traversal_denied")
    target = (root / raw).resolve(strict=False)
    if target != root and root not in target.parents:
        raise ValueError("path_outside_vault")
    return target


def _relative(path):
    path = Path(path)
    return "" if path == _root() else path.relative_to(_root()).as_posix()


def status():
    root = _root()
    exists = root.exists() and root.is_dir()
    writable = exists and os.access(root, os.W_OK)
    readable = exists and os.access(root, os.R_OK)
    usage = shutil.disk_usage(root) if exists else None
    return {
        "ok": bool(exists and readable),
        "node": "CI.VAULT",
        "version": VERSION,
        "root": str(root),
        "readable": readable,
        "writable": writable,
        "freeBytes": usage.free if usage else None,
        "totalBytes": usage.total if usage else None,
        "evidence": "live_filesystem_probe",
    }


def _meta(path):
    stat = path.stat()
    return {
        "name": path.name,
        "path": _relative(path),
        "type": "directory" if path.is_dir() else "file",
        "size": stat.st_size,
        "modifiedNs": stat.st_mtime_ns,
    }


def list_items(path=""):
    target = _path(path)
    if not target.is_dir():
        return {"ok": False, "error": "not_directory", "path": _relative(target)}
    items = sorted((_meta(p) for p in target.iterdir()), key=lambda row: (row["type"] != "directory", row["name"].lower()))
    return {"ok": True, "node": "CI.VAULT", "action": "list", "path": _relative(target), "items": items, "evidence": "live_filesystem_list"}


def stat_item(path):
    target = _path(path)
    if not target.exists():
        return {"ok": False, "error": "not_found", "path": str(path or "")}
    return {"ok": True, "node": "CI.VAULT", "action": "stat", "item": _meta(target), "evidence": "live_filesystem_stat"}


def download(path, offset=0, limit=MAX_CHUNK):
    target = _path(path)
    if not target.is_file():
        return {"ok": False, "error": "not_file", "path": str(path or "")}
    offset = max(0, int(offset or 0))
    limit = min(MAX_CHUNK, max(1, int(limit or MAX_CHUNK)))
    with target.open("rb") as handle:
        handle.seek(offset)
        chunk = handle.read(limit)
    size = target.stat().st_size
    return {
        "ok": True, "node": "CI.VAULT", "action": "download",
        "path": _relative(target), "offset": offset, "bytes": len(chunk),
        "totalBytes": size, "eof": offset + len(chunk) >= size,
        "contentBase64": base64.b64encode(chunk).decode("ascii"),
        "sha256Chunk": hashlib.sha256(chunk).hexdigest(), "evidence": "live_file_read",
    }


def upload(path, content_base64, offset=0, truncate=False):
    target = _path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = base64.b64decode(str(content_base64 or ""), validate=True)
    if len(data) > MAX_CHUNK:
        return {"ok": False, "error": "chunk_too_large", "maxChunkBytes": MAX_CHUNK}
    offset = max(0, int(offset or 0))
    mode = "r+b" if target.exists() and not truncate else "wb"
    with target.open(mode) as handle:
        if mode == "r+b":
            handle.seek(offset)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    return {
        "ok": True, "node": "CI.VAULT", "action": "upload",
        "path": _relative(target), "offset": offset, "bytes": len(data),
        "totalBytes": target.stat().st_size,
        "sha256Chunk": hashlib.sha256(data).hexdigest(), "evidence": "live_file_write",
    }


def mkdir(path):
    target = _path(path)
    target.mkdir(parents=True, exist_ok=False)
    return {"ok": True, "node": "CI.VAULT", "action": "mkdir", "path": _relative(target), "evidence": "live_directory_created"}


def move(path, destination):
    source = _path(path)
    target = _path(destination)
    if not source.exists():
        return {"ok": False, "error": "not_found", "path": str(path or "")}
    if target.exists():
        return {"ok": False, "error": "destination_exists", "destination": str(destination or "")}
    target.parent.mkdir(parents=True, exist_ok=True)
    source.replace(target)
    return {"ok": True, "node": "CI.VAULT", "action": "move", "from": _relative(source), "to": _relative(target), "evidence": "live_filesystem_move"}


def rename(path, name):
    source = _path(path)
    if "/" in str(name or "") or "\\" in str(name or "") or str(name or "") in {"", ".", ".."}:
        return {"ok": False, "error": "invalid_name"}
    destination = source.parent / str(name)
    return move(_relative(source), _relative(destination))


def delete(path, confirm_delete=False):
    target = _path(path)
    if target == _root():
        return {"ok": False, "error": "vault_root_delete_denied"}
    if not confirm_delete:
        return {"ok": False, "error": "delete_requires_confirmation", "permissionRequired": True}
    if not target.exists():
        return {"ok": False, "error": "not_found", "path": str(path or "")}
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"ok": True, "node": "CI.VAULT", "action": "delete", "path": str(path or ""), "evidence": "live_filesystem_delete"}


def execute(action, **kwargs):
    actions = {
        "status": lambda: status(),
        "list": lambda: list_items(kwargs.get("path", "")),
        "stat": lambda: stat_item(kwargs.get("path", "")),
        "download": lambda: download(kwargs.get("path", ""), kwargs.get("offset", 0), kwargs.get("limit", MAX_CHUNK)),
        "upload": lambda: upload(kwargs.get("path", ""), kwargs.get("contentBase64", ""), kwargs.get("offset", 0), kwargs.get("truncate", False)),
        "mkdir": lambda: mkdir(kwargs.get("path", "")),
        "move": lambda: move(kwargs.get("path", ""), kwargs.get("destination", "")),
        "rename": lambda: rename(kwargs.get("path", ""), kwargs.get("name", "")),
        "delete": lambda: delete(kwargs.get("path", ""), kwargs.get("confirmDelete", False)),
    }
    if action not in actions:
        return {"ok": False, "error": "unsupported_vault_action", "allowed": sorted(actions)}
    try:
        return actions[action]()
    except Exception as exc:
        return {"ok": False, "node": "CI.VAULT", "action": action, "error": str(exc)[:240]}
