// Structured errors retain cause/actual/aggregate edges. Truncation, cycles and
// non-Error causes cannot be silently dropped from a successful mutation kill.
import nodeAssert, { AssertionError } from 'node:assert';
import { syncBuiltinESMExports } from 'node:module';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url));
const nativeStackDescriptor = Object.getOwnPropertyDescriptor(
  new Error(),
  'stack',
);
const boundaryOutcomes = new WeakMap();
const nativePromise = Promise;
const nativeThen = Object.getOwnPropertyDescriptor(
  Promise.prototype,
  'then',
)?.value;
const nativeSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
function observablePromise(value) {
  return (
    !types.isProxy(value) &&
    types.isPromise(value) &&
    Object.getPrototypeOf(value) === nativePromise.prototype &&
    !Object.hasOwn(value, 'constructor') &&
    !Object.hasOwn(value, 'then') &&
    Object.getOwnPropertyDescriptor(nativePromise.prototype, 'constructor')
      ?.value === nativePromise &&
    Object.getOwnPropertyDescriptor(nativePromise.prototype, 'then')?.value ===
      nativeThen &&
    Object.getOwnPropertyDescriptor(nativePromise, Symbol.species)?.get ===
      nativeSpecies?.get
  );
}
// Installed only in the disposable child, before test modules import assert.
// Observe actual execution, not assertion messages or user-added error fields.
// Unknown promise shapes are not inspected and never prove an absent exception.
function installBoundaryObservation() {
  const wrappers = new Map();
  for (const owner of [nodeAssert, nodeAssert.strict]) {
    for (const operator of [
      'throws',
      'doesNotThrow',
      'rejects',
      'doesNotReject',
    ]) {
      const original = Reflect.get(owner, operator);
      let wrapper = wrappers.get(original);
      if (!wrapper) {
        const asynchronous =
          operator === 'rejects' || operator === 'doesNotReject';
        wrapper = function (...args) {
          const observation = {
            operator,
            outcome: 'unobserved',
            reason: undefined,
          };
          const observePromise = (promise) => {
            if (!observablePromise(promise)) return;
            // This side observer leaves the input promise and its result intact.
            Reflect.apply(nativeThen, promise, [
              () => {
                observation.outcome = 'fulfilled';
              },
              (reason) => {
                observation.outcome = 'rejected';
                observation.reason = reason;
              },
            ]);
          };
          const input = args[0];
          if (typeof input === 'function' && !types.isProxy(input)) {
            args[0] = (...callbackArgs) => {
              try {
                const result = Reflect.apply(input, undefined, callbackArgs);
                if (asynchronous) observePromise(result);
                else observation.outcome = 'returned';
                return result;
              } catch (reason) {
                observation.outcome = 'threw';
                observation.reason = reason;
                throw reason;
              }
            };
          } else if (asynchronous) observePromise(input);
          const remember = (error) => {
            try {
              if (
                types.isNativeError(error) &&
                !types.isProxy(error) &&
                error instanceof AssertionError
              ) {
                const observations = boundaryOutcomes.get(error) ?? [];
                // A propagated validator assertion may have a different
                // operator. Preserve the outer reason as well as its own proof.
                if (observations.length < 17) observations.push(observation);
                boundaryOutcomes.set(error, observations);
              }
            } catch {
              /* Observation must never replace the original error. */
            }
          };
          try {
            const result = Reflect.apply(original, this, args);
            if (!asynchronous || !observablePromise(result)) return result;
            // Rethrow through the returned promise: ignoring an assertion must
            // still produce an unhandled rejection, never a hidden test pass.
            return Reflect.apply(nativeThen, result, [
              undefined,
              (error) => {
                remember(error);
                throw error;
              },
            ]);
          } catch (error) {
            remember(error);
            throw error;
          }
        };
        wrappers.set(original, wrapper);
      }
      Reflect.set(owner, operator, wrapper);
    }
  }
  syncBuiltinESMExports();
}
if (process.env.MIZAN_FAULT_ASSERTION_OUTCOMES === '1')
  installBoundaryObservation();
export const exceptionAssertionOperators = new Set([
  'throws',
  'rejects',
  'doesNotThrow',
  'doesNotReject',
  'ifError',
]);
export const comparisonAssertionOperators = new Set([
  '==',
  '!=',
  '===',
  '!==',
  'strictEqual',
  'notStrictEqual',
  'deepEqual',
  'notDeepEqual',
  'deepStrictEqual',
  'notDeepStrictEqual',
  'match',
  'doesNotMatch',
  'fail',
]);
// Read data properties only. Unknown values must not execute getters, proxy
// traps or serialization hooks while the reporter decides whether evidence is
// complete. Missing and explicitly undefined causes are different states.
function dataProperty(value, key) {
  for (let depth = 0; value !== null && depth <= 16; depth++) {
    if (types.isProxy(value)) throw Error('Uninspectable proxy');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor) {
      if (!Object.hasOwn(descriptor, 'value'))
        throw Error('Uninspectable accessor');
      return { present: true, value: descriptor.value };
    }
    value = Object.getPrototypeOf(value);
  }
  if (value !== null) throw Error('Prototype depth limit');
  return { present: false, value: undefined };
}
function origin(error) {
  const descriptor = Object.getOwnPropertyDescriptor(error, 'stack');
  let stack = descriptor?.value;
  if (descriptor?.get) {
    if (descriptor.get !== nativeStackDescriptor?.get)
      throw Error('Uninspectable stack accessor');
    stack = Reflect.get(error, 'stack');
  }
  if (stack !== undefined && typeof stack !== 'string')
    throw Error('Non-string stack');
  const frame = (stack ?? '').slice(0, 8000).split('\n')[1] ?? '';
  const match =
    /^\s*at\s+(?:(.+?)\s+\()?((?:file:\/\/\/|\/)[^()]+):(\d+):(\d+)\)?$/.exec(
      frame,
    );
  if (!match) return null;
  const path = match[2].startsWith('file:')
    ? fileURLToPath(match[2])
    : match[2];
  const file = relative(root, path).replaceAll('\\', '/');
  return file.startsWith('../') ? null : { file, function: match[1] ?? null };
}
export function errorEvidence(error) {
  const errors = [],
    active = new Set();
  let complete = true;
  const visit = (value, parent = null, edge = 'root', depth = 0) => {
    if (active.has(value) || depth > 16 || errors.length >= 64) {
      complete = false;
      return;
    }
    active.add(value);
    try {
      const id = errors.length;
      if (types.isProxy(value) || !types.isNativeError(value)) {
        // Keep a bounded, JSON-safe marker. Do not inspect arbitrary objects or
        // turn string/null/undefined rejection into an absent actual edge.
        errors.push({
          kind: 'non-error',
          parent,
          edge,
          valueType: value === null ? 'null' : typeof value,
          ...(typeof value === 'string'
            ? {
                preview: value.slice(0, 4000),
                previewTruncated: value.length > 4000,
              }
            : {}),
        });
        complete = false;
        return;
      }
      const read = (key) => dataProperty(value, key);
      const messageValue = read('message').value;
      const message = messageValue === undefined ? '' : messageValue;
      const code = read('code').value ?? null;
      const name = read('name').value;
      const failureType = read('failureType').value ?? null;
      const genuineAssertion = value instanceof AssertionError;
      // Node's test envelope has an internal constructor getter. Identify
      // intrinsic families without invoking it or user-defined constructors.
      const constructorName = genuineAssertion
        ? 'AssertionError'
        : Object.getPrototypeOf(value) === Error.prototype
          ? 'Error'
          : parent === null &&
              code === 'ERR_TEST_FAILURE' &&
              value instanceof Error
            ? 'TestFailureEnvelope'
            : 'OtherError';
      const operator = genuineAssertion ? read('operator').value : null;
      if (
        typeof message !== 'string' ||
        typeof name !== 'string' ||
        typeof constructorName !== 'string' ||
        (code !== null && typeof code !== 'string') ||
        (failureType !== null && typeof failureType !== 'string') ||
        (genuineAssertion && typeof operator !== 'string')
      ) {
        complete = false;
        return;
      }
      if (
        genuineAssertion &&
        !exceptionAssertionOperators.has(operator) &&
        !comparisonAssertionOperators.has(operator)
      ) {
        complete = false;
        return;
      }
      const links = { cause: 0, actual: 0, aggregate: 0, boundary: 0 };
      const actual = read('actual');
      const observations = boundaryOutcomes.get(value) ?? [];
      if (observations.length > 16) complete = false;
      const observed = observations
        .filter((o) => o.operator === operator)
        .at(-1);
      const absence =
        genuineAssertion &&
        actual.present &&
        actual.value === undefined &&
        ((operator === 'throws' && observed?.outcome === 'returned') ||
          (operator === 'rejects' && observed?.outcome === 'fulfilled'));
      const reasonObserved =
        observed?.outcome === 'threw' || observed?.outcome === 'rejected';
      const identityVerified =
        observed?.operator === operator &&
        (absence ||
          (reasonObserved &&
            actual.present &&
            actual.value === observed.reason));
      if (observed && !identityVerified) complete = false;
      const boundary = observed
        ? {
            operator: observed.operator,
            outcome: observed.outcome,
            actualIdentityVerified: identityVerified,
          }
        : null;
      const requiresActual =
        genuineAssertion && exceptionAssertionOperators.has(operator);
      const actualRole = absence
        ? 'absence'
        : requiresActual ||
            (!genuineAssertion && actual.present) ||
            types.isNativeError(actual.value)
          ? 'cause'
          : genuineAssertion
            ? 'operand'
            : null;
      const propagation = [];
      const boundaryReasons = [];
      for (const context of observations) {
        if (context === observed) continue;
        const hasReason =
          context.outcome === 'threw' || context.outcome === 'rejected';
        const source = hasReason
          ? context.reason === value
            ? 'self'
            : 'boundary'
          : 'unobserved';
        propagation.push({
          operator: context.operator,
          outcome: context.outcome,
          source,
        });
        if (source === 'boundary') boundaryReasons.push(context.reason);
        if (source === 'unobserved') complete = false;
      }
      links.boundary = boundaryReasons.length;
      errors.push({
        kind: 'error',
        sameRealmError: value instanceof Error,
        parent,
        edge,
        code,
        name,
        constructor: constructorName,
        failureType,
        message: message.slice(0, 4000),
        messageTruncated: message.length > 4000,
        genuineAssertion,
        operator,
        origin: origin(value),
        links,
        actualRole,
        boundary,
        propagation,
      });
      const cause = read('cause');
      if (cause.present) {
        links.cause = 1;
        visit(cause.value, id, 'cause', depth + 1);
      }
      if (requiresActual && !actual.present) complete = false;
      if (
        ((!genuineAssertion || (requiresActual && !absence)) &&
          actual.present) ||
        types.isNativeError(actual.value)
      ) {
        links.actual = 1;
        visit(actual.value, id, 'actual', depth + 1);
      }
      for (const reason of boundaryReasons)
        visit(reason, id, 'boundary', depth + 1);
      if (value instanceof AggregateError) {
        const children = read('errors').value;
        if (
          types.isProxy(children) ||
          !Array.isArray(children) ||
          children.length > 64
        ) {
          complete = false;
        } else {
          links.aggregate = children.length;
          for (let i = 0; i < children.length; i++) {
            const child = dataProperty(children, String(i));
            if (!child.present) complete = false;
            else visit(child.value, id, 'aggregate', depth + 1);
          }
        }
      }
    } catch {
      complete = false;
    } finally {
      active.delete(value);
    }
  };
  visit(error);
  return { errors, errorGraphComplete: complete };
}
export default async function* report(events) {
  for await (const { type, data } of events) {
    if (type === 'test:pass' || type === 'test:fail') {
      const evidence =
        type === 'test:fail'
          ? errorEvidence(data.details?.error)
          : { errors: [], errorGraphComplete: true };
      yield (
        JSON.stringify({
          schema: 4,
          type,
          name: data.name,
          file: data.file,
          line: data.line,
          ...evidence,
          assertion: evidence.errors.some((error) => error.genuineAssertion),
        }) + '\n'
      );
    } else if (type === 'test:summary') {
      yield (
        JSON.stringify({
          schema: 4,
          type,
          success: data.success,
          counts: data.counts,
          durationMs: data.duration_ms,
        }) + '\n'
      );
    } else if (type === 'test:stderr' || type === 'test:stdout') {
      yield (
        JSON.stringify({
          schema: 4,
          type,
          message: String(data.message).slice(0, 8000),
        }) + '\n'
      );
    }
  }
}
