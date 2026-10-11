import { parentPort } from 'node:worker_threads';
const pending = [];
globalThis.self = {
  // Browser dependencies identify worker hosts by this property.
  importScripts() {},
  onmessage: null,
  postMessage(value, options) {
    parentPort.postMessage(value, options?.transfer);
  },
};
parentPort.on('message', (data) => {
  if (self.onmessage) void self.onmessage({ data });
  else pending.push(data);
});
await import('../../lib/reconciliation/worker.ts');
for (const data of pending) void self.onmessage({ data });
