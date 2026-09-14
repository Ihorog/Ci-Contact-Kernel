const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'scripts/orange/orange-widgetize.py');

function makeTempHtml(content, mode = 0o640) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orange-widgetize-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, content, 'utf8');
  fs.chmodSync(file, mode);
  return { dir, file };
}

function runWidgetize(file) {
  return spawnSync('python3', [scriptPath, file], { encoding: 'utf8' });
}

test('orange widgetize scopes the rewrite to the legacy sidebar and preserves accessible controls', () => {
  const html = `<!doctype html>
<html lang="uk">
<head><title>Центр керування · Orange Pi</title></head>
<body>
  <main>
    <div class="s-sec">Сховище</div>
    <p>Цей вміст не є боковою панеллю.</p>
    <div class="s-sec">Історія</div>
  </main>
  <aside id="sidebar">
    <div class="s-sec">Сховище</div>
    <a class="s-item" href="/modules/cimeika">Модулі Cimeika</a>
    <a class="s-item" href="/dashboard">Dashboard</a>
    <a class="s-item" href="https://orange.local/admin.html">Admin</a>
    <div class="s-sec">Історія</div>
  </aside>
</body>
</html>`;
  const { dir, file } = makeTempHtml(html);
  const beforeMode = fs.statSync(file).mode & 0o777;

  try {
    const run = runWidgetize(file);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stdout, /widgetized_ok/);

    const updated = fs.readFileSync(file, 'utf8');
    const sidebarStart = updated.indexOf('<aside id="sidebar">');
    const sidebarEnd = updated.indexOf('</aside>');
    const sidebarHtml = updated.slice(sidebarStart, sidebarEnd);

    assert.ok(updated.includes('<!-- CI_WIDGETIZE_V1 -->'));
    assert.ok(updated.includes('<title>Ci</title>'));
    assert.match(updated, /<main>[\s\S]*Цей вміст не є боковою панеллю\.[\s\S]*<div class="s-sec">Історія<\/div>[\s\S]*<\/main>/);
    assert.ok(sidebarHtml.includes('onclick="window.location.reload()"'));
    assert.ok(sidebarHtml.includes('role="button" tabindex="0"'));
    assert.ok(sidebarHtml.includes("onkeydown=\"if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}\""));
    assert.equal(sidebarHtml.includes('Модулі Cimeika'), false);
    assert.equal(sidebarHtml.includes('Dashboard'), false);
    assert.equal(sidebarHtml.includes('admin.html'), false);
    assert.equal(fs.statSync(file).mode & 0o777, beforeMode);

    const rerun = runWidgetize(file);
    assert.equal(rerun.status, 0, rerun.stderr || rerun.stdout);
    assert.match(rerun.stdout, /already_widgetized/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('orange widgetize does not mutate files on module import', () => {
  const html = `<!doctype html><html><head><title>Центр керування · Orange Pi</title></head><body>
  <aside><div class="s-sec">Сховище</div><a class="s-item" href="/dashboard">Dashboard</a><div class="s-sec">Історія</div></aside>
</body></html>`;
  const { dir, file } = makeTempHtml(html);
  const before = fs.readFileSync(file, 'utf8');

  try {
    const imported = spawnSync(
      'python3',
      [
        '-c',
        [
          'import importlib.util, pathlib, sys',
          'script = pathlib.Path(sys.argv[1])',
          'spec = importlib.util.spec_from_file_location("orange_widgetize", script)',
          'module = importlib.util.module_from_spec(spec)',
          'spec.loader.exec_module(module)',
        ].join('; '),
        scriptPath,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(imported.status, 0, imported.stderr || imported.stdout);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('orange widgetize fails closed when no scoped legacy sidebar section exists', () => {
  const html = `<!doctype html><html><head><title>Центр керування · Orange Pi</title></head><body>
  <main><div class="s-sec">Сховище</div><p>Dashboard</p><div class="s-sec">Історія</div></main>
</body></html>`;
  const { dir, file } = makeTempHtml(html);
  const before = fs.readFileSync(file, 'utf8');

  try {
    const run = runWidgetize(file);
    assert.equal(run.status, 2, run.stderr || run.stdout);
    assert.match(run.stdout, /sidebar_pattern_not_found/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
