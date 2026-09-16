import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { UiDriver, UiHandle } from '../driver.js';
import {
  ANY_DROPDOWN_OPTION,
  DEFAULT_DROPDOWN_OPTION,
  resolveDropdownOption,
} from '../dropdownSelection.js';

const handle = (current: string | null): UiHandle => ({
  candidate: { strategy: 'label', value: 'Danh mục', weight: 1, origin: 'authored' },
  isVisible: async () => true,
  text: async () => current ?? '',
  value: async () => current,
});

const driver = (options: string[]): UiDriver => ({
  platform: 'web', device: 'test',
  start: async () => {}, stop: async () => {}, launch: async () => {}, isIdle: async () => true,
  find: async () => null, tap: async () => {}, longPress: async () => {},
  hover: async () => {}, dragDrop: async () => {}, input: async () => {},
  clear: async () => {}, selectOption: async () => {}, scrollIntoView: async () => {},
  swipe: async () => {}, scroll: async () => {}, back: async () => {},
  screenshot: async () => '',
  listOptions: async () => options,
});

describe('dynamic dropdown selection', () => {
  it('chooses a non-current entry for any option', async () => {
    assert.equal(
      await resolveDropdownOption(
        driver(['Danh mục mặc định', 'Danh mục tăng trưởng']),
        handle('Danh mục mặc định'),
        ANY_DROPDOWN_OPTION,
      ),
      'Danh mục tăng trưởng',
    );
  });

  it('chooses the named default, or the first entry when the UI does not label it', async () => {
    assert.equal(
      await resolveDropdownOption(
        driver(['Danh mục đầu tư', 'Danh mục mặc định']),
        handle('Danh mục đầu tư'),
        DEFAULT_DROPDOWN_OPTION,
      ),
      'Danh mục mặc định',
    );
    assert.equal(
      await resolveDropdownOption(
        driver(['Danh mục của tôi', 'Danh mục khác']),
        handle('Danh mục khác'),
        DEFAULT_DROPDOWN_OPTION,
      ),
      'Danh mục của tôi',
    );
  });
});
