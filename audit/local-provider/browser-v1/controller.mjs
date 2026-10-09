/** A development-only worker owner. Cancellation kills the actual worker. */
export class BrowserProviderController {
  constructor(createWorker, observe = () => {}) {
    this.createWorker = createWorker;
    this.observe = observe;
    this.worker = null;
    this.active = null;
    this.serial = 0;
    this.epoch = 0;
    this.staleReplies = 0;
    this.terminations = 0;
  }

  request(operation, payload, deadlineMs) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)
      throw new Error('Invalid worker deadline');
    if (this.active) this.cancel('superseded');
    const id = ++this.serial;
    const epoch = this.epoch;
    return new Promise((resolve) => {
      this.active = { id, epoch, resolve, timer: null };
      this.active.timer = setTimeout(() => this.cancel('deadline'), deadlineMs);
      try {
        if (!this.worker) {
          this.worker = this.createWorker();
          this.worker.onmessage = ({ data }) => this.receive(data, epoch);
          this.worker.onerror = (error) => {
            if (epoch !== this.epoch) { this.staleReplies++; return; }
            this.cancel('worker-unavailable', error?.message || 'Worker module failed');
          };
        }
        this.worker.postMessage({ id, operation, payload });
      } catch (error) {
        this.cancel('worker-unavailable', String(error));
      }
    });
  }

  receive(message, epoch) {
    if (!this.active || epoch !== this.epoch || message.id !== this.active.id) {
      this.staleReplies++;
      return false;
    }
    if (message.type === 'progress') {
      this.observe(message);
      return true;
    }
    if (message.type !== 'result' && message.type !== 'error') return false;
    const pending = this.active;
    clearTimeout(pending.timer);
    this.active = null;
    if (message.type === 'error') {
      this.destroy();
      pending.resolve({ status: 'fallback', reason: 'runtime-unavailable', error: message.error });
    } else pending.resolve({ status: 'ok', value: message.value });
    return true;
  }

  destroy() {
    this.epoch++;
    if (this.worker) {
      this.worker.terminate();
      this.terminations++;
      this.worker = null;
    }
  }

  cancel(reason = 'cancelled', error = null) {
    const pending = this.active;
    this.active = null;
    if (pending) clearTimeout(pending.timer);
    this.destroy();
    if (pending) pending.resolve({ status: 'fallback', reason, error });
  }
}
