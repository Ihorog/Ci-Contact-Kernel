const fs = require('fs');
const path = require('path');

class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.bufferLimit = 2000;
    this.buffer = [];
    this.appendChain = Promise.resolve();
    this.ensureStorage();
    this.loadBuffer();
  }

  ensureStorage() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '');
  }

  loadBuffer() {
    const raw = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!raw) return;
    this.buffer = raw
      .split('\n')
      .filter(Boolean)
      .slice(-this.bufferLimit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  append(record) {
    this.buffer.push(record);
    if (this.buffer.length > this.bufferLimit) this.buffer = this.buffer.slice(-this.bufferLimit);
    const line = `${JSON.stringify(record)}\n`;
    this.appendChain = this.appendChain
      .then(() => fs.promises.appendFile(this.filePath, line))
      .catch((error) => {
        const index = this.buffer.indexOf(record);
        if (index >= 0) this.buffer.splice(index, 1);
        console.error('Failed to append Ci memory record:', error.message);
      });
  }

  recent(limit = 50) {
    return this.buffer
      .slice(-Math.max(1, Number(limit) || 50))
      .reverse();
  }
}

module.exports = { MemoryStore };
