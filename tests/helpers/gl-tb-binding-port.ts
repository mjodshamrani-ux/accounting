import { Worker as NodeWorker } from 'node:worker_threads';
import type { WorkerPort } from '../../lib/reconciliation/worker-client.ts';
export type GlTbBindingResponse = {
  channel: string;
  id: number;
  action: string;
  ok: boolean;
  value: unknown;
  error?: string;
};
export class GlTbBindingPort implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null;
  onerror: WorkerPort['onerror'] = null;
  onmessageerror: WorkerPort['onmessageerror'] = null;
  readonly worker: NodeWorker;
  terminated = false;
  readonly transform: (
    response: GlTbBindingResponse,
    deliver: (response: GlTbBindingResponse) => void,
  ) => void;
  constructor(
    transform: (
      response: GlTbBindingResponse,
      deliver: (response: GlTbBindingResponse) => void,
    ) => void = (response, deliver) => deliver(response),
  ) {
    this.transform = transform;
    this.worker = new NodeWorker(
      new URL('./gl-tb-binding-worker.mjs', import.meta.url),
    );
    this.worker.on('message', (data) =>
      this.transform(data, (response) =>
        this.onmessage?.call(
          this as unknown as Worker,
          { data: response } as MessageEvent,
        ),
      ),
    );
    this.worker.on('error', (error) =>
      this.onerror?.call(
        this as unknown as Worker,
        { message: error.message } as ErrorEvent,
      ),
    );
    this.worker.on('messageerror', (error) =>
      this.onmessageerror?.call(
        this as unknown as Worker,
        { data: error } as MessageEvent,
      ),
    );
  }
  postMessage(message: unknown) {
    this.worker.postMessage(message);
  }
  terminate() {
    this.terminated = true;
    void this.worker.terminate();
  }
}
