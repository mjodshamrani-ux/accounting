import { parentPort } from 'node:worker_threads';
const queued = [];
globalThis.self = {
  importScripts() {},
  onmessage: null,
  postMessage(value, options) {
    parentPort.postMessage(value, options?.transfer);
  },
};
parentPort.on('message', (data) => {
  if (self.onmessage) self.onmessage({ data });
  else queued.push(data);
});
await import('../../lib/reconciliation/worker.ts');
for (const data of queued) self.onmessage({ data });
