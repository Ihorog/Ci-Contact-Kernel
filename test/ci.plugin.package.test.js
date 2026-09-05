const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const manifestPath = 'plugins/ci/.codex-plugin/plugin.json';
const mcpPath = 'plugins/ci/.mcp.json';
const skillPath = 'plugins/ci/skills/ci-orchestration/SKILL.md';
const marketplacePath = '.agents/plugins/marketplace.json';

test('Ci plugin package contract', () => {
  const manifest = json(manifestPath);
  const mcp = json(mcpPath);
  const skill = read(skillPath);
  const marketplace = json(marketplacePath);

  assert.equal(manifest.name, 'ci');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(Object.hasOwn(manifest, 'apps'), false, 'apps must be added only after real ChatGPT MCP registration');

  const ciMcp = mcp.mcpServers?.ci;
  assert.equal(ciMcp?.type, 'http');
  assert.equal(ciMcp?.url, 'https://mcp-http.cimeika.com.ua/mcp');
  assert.equal(ciMcp?.oauth_resource, 'https://mcp-http.cimeika.com.ua');

  assert.match(skill, /^---\nname: ci-orchestration\n/m);
  for (const token of ['ci_plan', 'ci_action', 'ci_verify', 'ACTUAL', 'PREDICTED', 'TARGET']) {
    assert.ok(skill.includes(token), `skill missing ${token}`);
  }

  const entry = marketplace.plugins?.find((p) => p.name === 'ci');
  assert.equal(entry?.source?.path, './plugins/ci');
  assert.equal(entry?.policy?.installation, 'AVAILABLE');
  assert.equal(entry?.policy?.authentication, 'ON_INSTALL');

  const publicConfig = JSON.stringify({ manifest, mcp });
  for (const raw of ['exec', 'shell', 'ssh', 'write_file', 'service_status']) {
    assert.equal(publicConfig.includes(`\"${raw}\"`), false, `raw executor leaked: ${raw}`);
  }
});
