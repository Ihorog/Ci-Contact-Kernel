#!/usr/bin/env python3
from html import unescape
from pathlib import Path
import os
import re
import sys
import tempfile

DEFAULT_INDEX_PATH = Path("/home/kazkar/cit/cit-pwa/index.html")
MARKER = "CI_WIDGETIZE_V1"
LEGACY_PATTERNS = (
    re.compile(r"Модулі\s+Cimeika"),
    re.compile(r"Dashboard", re.I),
    re.compile(r"admin(?:\.html)?", re.I),
)
VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
TAG_RE = re.compile(r"<!--.*?-->|<![^>]*>|<[^>]+>", re.S)
ATTR_RE = re.compile(r'([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+)))?')
KEYBOARD_ATTRS = (
    ' role="button" tabindex="0"'
    ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}"'
)
REPL = (
    '<div class="s-sec">Ci</div>\n'
    f'    <div class="s-item" onclick="window.location.reload()"{KEYBOARD_ATTRS}>\n'
    '      <span class="s-item-icon">🌀</span><span class="s-item-label">Намір → результат</span>\n'
    "    </div>\n"
    f'    <div class="s-item" id="view-memory-btn"{KEYBOARD_ATTRS}>\n'
    "      <span class=\"s-item-icon\">🧠</span><span class=\"s-item-label\">Пам'ять</span>\n"
    "    </div>\n"
    f'    <div class="s-item" id="save-memory-btn"{KEYBOARD_ATTRS}>\n'
    '      <span class="s-item-icon">💾</span><span class="s-item-label">Зберегти останнє</span>\n'
    "    </div>\n"
    '    <div class="s-divider"></div>\n'
    '    <div class="s-sec">Історія</div>'
)


class WidgetizeError(Exception):
    def __init__(self, code, exit_code):
        super().__init__(code)
        self.code = code
        self.exit_code = exit_code


def _normalize(text):
    return " ".join(text.split())


def _parse_start_tag(tag_text):
    body = tag_text[1:-1].strip()
    if body.endswith("/"):
        body = body[:-1].rstrip()
    parts = body.split(None, 1)
    tag = parts[0].lower()
    attrs = {}
    if len(parts) > 1:
        for name, v1, v2, v3 in ATTR_RE.findall(parts[1]):
            attrs[name.lower()] = unescape(v1 or v2 or v3 or "")
    return tag, attrs


def _strip_tags(fragment):
    return _normalize(unescape(re.sub(r"<[^>]+>", " ", fragment)))


def _scan_elements(text):
    elements = []
    stack = []
    next_id = 1
    for match in TAG_RE.finditer(text):
        tag_text = match.group(0)
        if tag_text.startswith("<!--") or tag_text.startswith("<!"):
            continue
        if tag_text.startswith("</"):
            tag = tag_text[2:-1].strip().lower()
            if not stack or stack[-1]["tag"] != tag:
                continue
            node = stack.pop()
            node["end"] = match.end()
            node["inner_text"] = _strip_tags(text[node["open_end"] : match.start()])
            elements.append(node)
            continue
        tag, attrs = _parse_start_tag(tag_text)
        if tag in VOID_TAGS or tag_text.endswith("/>"):
            continue
        stack.append(
            {
                "id": next_id,
                "tag": tag,
                "attrs": attrs,
                "start": match.start(),
                "open_end": match.end(),
                "parent_id": stack[-1]["id"] if stack else None,
            }
        )
        next_id += 1
    return elements


def _find_sidebar_bounds(text):
    elements = _scan_elements(text)
    by_id = {element["id"]: element for element in elements}
    sections = [
        element
        for element in sorted(elements, key=lambda item: item["start"])
        if "s-sec" in element["attrs"].get("class", "").split()
    ]
    matches = []
    for index, start in enumerate(sections):
        if start["inner_text"] != "Сховище":
            continue
        for end in sections[index + 1 :]:
            if end["inner_text"] != "Історія" or end["parent_id"] != start["parent_id"]:
                continue
            legacy_slice = text[start["end"] : end["start"]]
            if "s-item" not in legacy_slice:
                continue
            if not any(pattern.search(legacy_slice) for pattern in LEGACY_PATTERNS):
                continue
            matches.append((start, end, by_id.get(start["parent_id"])))
            break
    if not matches:
        raise WidgetizeError("sidebar_pattern_not_found", 2)
    if len(matches) > 1:
        raise WidgetizeError("sidebar_pattern_ambiguous", 3)
    start, end, parent = matches[0]
    if parent is None:
        raise WidgetizeError("sidebar_parent_not_found", 4)
    return start, end, parent


def _ensure_marker(text):
    if MARKER in text:
        return text
    if "</title>" in text:
        return text.replace("</title>", f"</title>\n<!-- {MARKER} -->", 1)
    if "</head>" in text:
        return text.replace("</head>", f"<!-- {MARKER} -->\n</head>", 1)
    return f"<!-- {MARKER} -->\n{text}"


def widgetize_text(text):
    start, end, parent = _find_sidebar_bounds(text)
    updated = text[: start["start"]] + REPL + text[end["end"] :]
    updated = updated.replace("Центр керування · Orange Pi", "Ci")
    updated = _ensure_marker(updated)
    delta = len(updated) - len(text)
    parent_html = updated[parent["start"] : parent["end"] + delta]
    if any(pattern.search(parent_html) for pattern in LEGACY_PATTERNS):
        raise WidgetizeError("legacy_sidebar_entries_still_present", 5)
    return updated


def _write_atomic(path, text):
    original_mode = path.stat().st_mode
    tmp_name = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            tmp_name = handle.name
            handle.write(text)
            handle.flush()
            os.fchmod(handle.fileno(), original_mode)
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    idx = Path(args[0]) if args else Path(os.environ.get("CI_ORANGE_WIDGETIZE_INDEX_PATH", DEFAULT_INDEX_PATH))
    text = idx.read_text(encoding="utf-8")
    if MARKER in text:
        print("already_widgetized")
        return 0
    try:
        updated = widgetize_text(text)
    except WidgetizeError as exc:
        print(exc.code)
        return exc.exit_code
    _write_atomic(idx, updated)
    print("widgetized_ok", idx.stat().st_size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
