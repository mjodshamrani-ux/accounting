import LocalWorker from './worker.ts?worker&inline';
import { createWorkerClient } from './worker-client.ts';
const client = createWorkerClient(() => new LocalWorker());
export const workerTask = client.request;
export const prepareWorker = client.prepare;
