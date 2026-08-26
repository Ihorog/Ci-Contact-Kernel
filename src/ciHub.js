const { EventEmitter } = require('events');

class CiHub extends EventEmitter {
  constructor() {
    super();
    this.modules = new Map();
  }

  registerModule(name, handlers = {}) {
    this.modules.set(name, handlers);
    this.emit('module.registered', { name, registeredAt: new Date().toISOString() });
  }

  getModules() {
    return Array.from(this.modules.keys());
  }
}

module.exports = new CiHub();
