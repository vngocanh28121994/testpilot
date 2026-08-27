import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ACTION_CAPABILITIES,
  assertCapabilitySupported,
  UnsupportedActionCapabilityError,
} from '../capabilities.js';

describe('runtime action capabilities', () => {
  it('allows hover on web and rejects it explicitly on native platforms', () => {
    assert.doesNotThrow(() => assertCapabilitySupported('hover', 'web'));
    assert.throws(
      () => assertCapabilitySupported('hover', 'android'),
      (error: Error) =>
        error instanceof UnsupportedActionCapabilityError &&
        /Hover cần con trỏ thật/.test(error.message),
    );
  });

  it('supports drag-drop and scroll consistently on all platforms', () => {
    for (const platform of ['web', 'android', 'ios'] as const) {
      assert.equal(ACTION_CAPABILITIES.dragDrop.platforms[platform], true);
      assert.doesNotThrow(() => assertCapabilitySupported('scroll', platform));
    }
  });
});
