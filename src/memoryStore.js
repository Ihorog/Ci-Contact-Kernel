const fs = require('fs');
const path = require('path');

class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureStorage();
  }

  ensureStorage() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '');
  }

  append(record) {
    fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
  }

  recent(limit = 50) {
    const raw = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .slice(-Math.max(1, Number(limit) || 50))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  }
}

module.exports = { MemoryStore };
