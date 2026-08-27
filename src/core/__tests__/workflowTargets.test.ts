import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigSchema } from '../../config.js';

/**
 * Device Farm is chosen separately from the local platforms, which makes three
 * combinations meaningful and one meaningless. The schema is where that gets
 * settled, because a workflow with nothing to run on would otherwise generate a
 * whole suite before stopping without saying why.
 */

const base = { web: { baseUrl: 'https://example.com' } };

test('local platforms alone are a complete choice', () => {
  const cfg = ConfigSchema.parse({ ...base, workflow: { platforms: ['web'] } });
  assert.deepEqual(cfg.workflow.platforms, ['web']);
  assert.equal(cfg.workflow.deviceFarm, undefined);
});

test('farm alone is a complete choice, with no local platform', () => {
  const cfg = ConfigSchema.parse({
    ...base,
    workflow: { platforms: [], deviceFarm: { platform: 'ios' } },
  });
  assert.deepEqual(cfg.workflow.platforms, []);
  assert.deepEqual(cfg.workflow.deviceFarm, { platform: 'ios' });
});

test('local and farm together are a complete choice', () => {
  const cfg = ConfigSchema.parse({
    ...base,
    workflow: { platforms: ['web', 'android'], deviceFarm: { platform: 'android' } },
  });
  assert.deepEqual(cfg.workflow.platforms, ['web', 'android']);
  assert.deepEqual(cfg.workflow.deviceFarm, { platform: 'android' });
});

test('neither is rejected rather than silently producing a workflow that runs nothing', () => {
  const parsed = ConfigSchema.safeParse({ ...base, workflow: { platforms: [] } });
  assert.equal(parsed.success, false);
  assert.match(
    parsed.error!.issues.map((i) => i.message).join(' '),
    /ít nhất một nền tảng/,
  );
});

test('the farm platform is limited to what device farms actually offer', () => {
  const parsed = ConfigSchema.safeParse({
    ...base,
    workflow: { platforms: ['web'], deviceFarm: { platform: 'web' } },
  });
  assert.equal(parsed.success, false);
});

test('omitting workflow entirely still yields a runnable default', () => {
  const cfg = ConfigSchema.parse(base);
  assert.deepEqual(cfg.workflow.platforms, ['web']);
});
