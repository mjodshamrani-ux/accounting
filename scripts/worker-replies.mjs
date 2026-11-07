// The worker replies a page receives, kept as the page receives them, so a
// browser check can work out from the engine's own reply what the screen
// must say. Runs in the page through addInitScript: it stands alone, and it
// changes nothing the page does with a reply.
export function keepReplies() {
  const descriptor = Object.getOwnPropertyDescriptor(
    Worker.prototype,
    'onmessage',
  );
  const handlers = new WeakMap();
  globalThis.alignmentReplies = [];
  Object.defineProperty(Worker.prototype, 'onmessage', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return handlers.get(this) ?? null;
    },
    set(handler) {
      handlers.set(this, handler);
      descriptor.set.call(
        this,
        typeof handler === 'function'
          ? function (event) {
              if (event.data && Object.hasOwn(event.data, 'value'))
                globalThis.alignmentReplies.push({
                  action: event.data.action,
                  value: structuredClone(event.data.value),
                });
              return handler.call(this, event);
            }
          : handler,
      );
    },
  });
}
