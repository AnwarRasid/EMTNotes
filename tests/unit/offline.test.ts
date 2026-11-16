// Task 19: an automatic reload waits while a run is on screen (spec §10 "held until no run is active"), and goes
// once the route has left the run. Callers pass the reload, so a test's spy stands in for location.reload.
import { releaseHeldReload, reloadHeld, requestReload } from '../../src/lib/offline';

const reload = vi.fn();

beforeEach(() => {
  reload.mockClear();
  location.hash = '#/';
});

afterEach(() => {
  location.hash = '#/';
  releaseHeldReload(() => {});   // no hold carries into the next test
});

describe('requestReload', () => {
  it('holds a reload asked for during a run', () => {
    location.hash = '#/run';
    requestReload(reload);
    expect(reload).not.toHaveBeenCalled();
    expect(reloadHeld()).toBe(true);
  });

  it('reloads once the route has left the run, once however often it was asked', () => {
    location.hash = '#/run';
    requestReload(reload);
    requestReload(reload);
    location.hash = '#/';
    releaseHeldReload(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadHeld()).toBe(false);
    releaseHeldReload(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once off a run', () => {
    location.hash = '#/quiz';
    requestReload(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadHeld()).toBe(false);
  });

  it('keeps holding when released while the run is still on screen', () => {
    location.hash = '#/run';
    requestReload(reload);
    releaseHeldReload(reload);
    expect(reload).not.toHaveBeenCalled();
    expect(reloadHeld()).toBe(true);
  });

  it('counts Run start and a debrief as off the run', () => {
    for (const hash of ['#/pam/start', '#/debrief/r1']) {
      location.hash = hash;
      requestReload(reload);
    }
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('releaseHeldReload', () => {
  it('does nothing with no reload held', () => {
    releaseHeldReload(reload);
    expect(reload).not.toHaveBeenCalled();
  });
});
