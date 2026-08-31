import assert from 'node:assert/strict';

import {
  createSingleFlightLoader,
  startNonOverlappingPolling,
  type PollingScheduler,
} from '../src/httpPolling.ts';

const scheduled: Array<() => void> = [];
const cleared: unknown[] = [];
const scheduler: PollingScheduler = {
  setTimeout(callback) {
    scheduled.push(callback);
    return callback;
  },
  clearTimeout(handle) {
    cleared.push(handle);
  },
};

const deferred: Array<() => void> = [];
let activeLoads = 0;
let maxActiveLoads = 0;
let loadCount = 0;
const stop = startNonOverlappingPolling(async () => {
  loadCount += 1;
  activeLoads += 1;
  maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
  await new Promise<void>(resolve => deferred.push(resolve));
  activeLoads -= 1;
}, 5_000, scheduler);

await Promise.resolve();
assert.equal(loadCount, 1, 'polling starts immediately');
assert.equal(scheduled.length, 0, 'the next poll must not be scheduled while the current load is pending');

deferred.shift()?.();
await Promise.resolve();
await Promise.resolve();
assert.equal(scheduled.length, 1, 'the next poll is scheduled only after the current load settles');

scheduled.shift()?.();
await Promise.resolve();
assert.equal(loadCount, 2);
assert.equal(maxActiveLoads, 1, 'polling requests must never overlap');

stop();
deferred.shift()?.();
await Promise.resolve();
await Promise.resolve();
assert.equal(scheduled.length, 0, 'stopping during a load must not schedule another poll');
assert.equal(cleared.length, 0, 'there is no pending timer to clear when stopping during a load');

let singleFlightCalls = 0;
let releaseSingleFlight: (() => void) | undefined;
const singleFlight = createSingleFlightLoader(async () => {
  singleFlightCalls += 1;
  if (singleFlightCalls === 1) {
    await new Promise<void>(resolve => {
      releaseSingleFlight = resolve;
    });
  }
});
const first = singleFlight();
const second = singleFlight();
assert.equal(first, second, 'manual refresh and scheduled refresh must share an in-flight load');
assert.equal(singleFlightCalls, 0, 'single-flight work starts in a microtask');
await Promise.resolve();
assert.equal(singleFlightCalls, 1);
releaseSingleFlight?.();
await first;
await singleFlight();
assert.equal(singleFlightCalls, 2, 'a settled load must allow the next refresh');

console.log('Non-overlapping HTTP polling tests passed.');
