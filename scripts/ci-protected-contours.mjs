import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(fs.readFileSync('config/protected-contours.json', 'utf8'));
const fail = (message) => { console.error(`CI_PROTECTED_CONTOUR_FAIL: ${message}`); process.exitCode = 1; };

for (const path of manifest.protected_contours) {
  if (!fs.existsSync(path) || fs.statSync(path).size === 0) fail(`missing or empty protected path: ${path}`);
}

for (const invariant of manifest.invariants) {
  const text = fs.existsSync(invariant.path) ? fs.readFileSync(invariant.path, 'utf8') : '';
  if (!text.includes(invariant.contains)) fail(`${invariant.path} lost invariant: ${invariant.contains}`);
}

const publicBaseline = fs.readFileSync(manifest.public_baseline, 'utf8');
const privateIp = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/;
const explicitHealthAddress = /(?:https?:\/\/\S+|:\d{2,5}\/?(?:health)?\b)/i;
if (privateIp.test(publicBaseline)) fail('public Orange baseline exposes a private LAN IP');
if (explicitHealthAddress.test(publicBaseline)) fail('public Orange baseline exposes an explicit URL or service port');

const baseSha = String(process.env.CI_BASE_SHA || '').trim();
if (baseSha && !/^0+$/.test(baseSha)) {
  try {
    const diff = execFileSync('git', ['diff', '--numstat', `${baseSha}...HEAD`], { encoding: 'utf8' });
    let deleted = 0;
    const touched = new Set();
    for (const line of diff.trim().split('\n').filter(Boolean)) {
      const [addedRaw, deletedRaw, path] = line.split('\t');
      if (deletedRaw !== '-') deleted += Number(deletedRaw || 0);
      if (path) touched.add(path);
    }
    const protectedTouched = manifest.protected_contours.filter((path) => touched.has(path));
    const approved = String(process.env.CI_APPROVED_DESTRUCTIVE_CHANGE || '').toLowerCase() === 'true';
    if (deleted > manifest.destructive_change_threshold_deleted_lines && !approved) {
      fail(`destructive diff deletes ${deleted} lines; approval label '${manifest.approval_label}' is required`);
    }
    if (protectedTouched.length) console.log(`Protected contours touched: ${protectedTouched.join(', ')}`);
  } catch (error) {
    fail(`unable to evaluate destructive diff: ${error.message}`);
  }
}

if (!process.exitCode) console.log('CI protected contours: OK');
