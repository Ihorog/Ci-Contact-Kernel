#!/usr/bin/env python3
from pathlib import Path
import re
import sys

idx = Path("/home/kazkar/cit/cit-pwa/index.html")
t = idx.read_text(encoding="utf-8")
if "CI_WIDGETIZE_V1" in t:
    print("already_widgetized")
    raise SystemExit(0)

pattern = re.compile(
    r'<div class="s-sec">Сховище</div>.*?<div class="s-sec">Історія</div>',
    re.S,
)
repl = (
    '<div class="s-sec">Ci</div>\n'
    '    <div class="s-item" onclick="window.location.reload()">\n'
    '      <span class="s-item-icon">🌀</span><span class="s-item-label">Намір → результат</span>\n'
    '    </div>\n'
    '    <div class="s-item" id="view-memory-btn">\n'
    "      <span class=\"s-item-icon\">🧠</span><span class=\"s-item-label\">Пам'ять</span>\n"
    '    </div>\n'
    '    <div class="s-item" id="save-memory-btn">\n'
    '      <span class="s-item-icon">💾</span><span class="s-item-label">Зберегти останнє</span>\n'
    '    </div>\n'
    '    <div class="s-divider"></div>\n'
    '    <div class="s-sec">Історія</div>'
)
if not pattern.search(t):
    print("sidebar_pattern_not_found")
    raise SystemExit(2)
t2 = pattern.sub(repl, t, count=1)
t2 = t2.replace("Центр керування · Orange Pi", "Ci")
if "</title>" in t2 and "CI_WIDGETIZE_V1" not in t2:
    t2 = t2.replace("</title>", "</title>\n<!-- CI_WIDGETIZE_V1 -->", 1)
idx.write_text(t2, encoding="utf-8")
print("widgetized_ok", idx.stat().st_size)
