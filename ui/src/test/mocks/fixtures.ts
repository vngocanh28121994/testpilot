import type { StateResponse, HealingResponse } from '@core/ui/contracts.js';

/**
 * Fixture bám sát hình dạng thật của server.
 *
 * Kiểu tường minh ở đây là cố ý: nếu contract đổi, fixture đỏ ngay tại
 * `tsc -b ui` chứ không phải ở một assertion khó hiểu trong test.
 */
export const stateFixture: StateResponse = {
  config: {
    web: { baseUrl: 'https://example.com' },
    accounts: [{ label: 'khach-hang', username: 'user@example.com' }],
  } as unknown as StateResponse['config'],
  configError: null,
  configFile: '/tmp/testpilot.config.json',
  features: [],
  elements: 106,
  reports: [],
  runs: [],
  // KHÔNG có trường `password` — xem R9 và test ở api/__tests__/secrets.test.ts.
  accounts: [{ label: 'khach-hang', username: 'user@example.com', hasPassword: true }],
  hasApiKey: true,
  modelKeys: { deepseek: false, gemini: false, anthropic: true },
  appBuilds: { android: null, ios: null },
  deviceEnv: {},
  envBuilds: {},
  tagTaxonomy: { version: 1, definitions: [], featurePattern: '@feature-<ten-chuc-nang>' } as unknown as StateResponse['tagTaxonomy'],
};

import type { HealingRecordView } from '@core/ui/contracts.js';

function record(over: Partial<HealingRecordView> = {}): HealingRecordView {
  return {
    id: 'h1',
    elementId: 'login.submit',
    platform: 'web',
    current: { strategy: 'css', value: '#old-btn', weight: 0.5, origin: 'authored' },
    proposed: { strategy: 'testId', value: 'login-submit', weight: 0.9, origin: 'healed' },
    primary: { strategy: 'css', value: '#old-btn', weight: 0.5, origin: 'authored' },
    quality: { score: 92, stable: true, persistable: true, promotable: true, reasons: [] },
    successes: 5,
    runs: 3,
    runIds: ['r1', 'r2', 'r3'],
    devices: { 'Pixel 7': 3, 'iPhone 15': 2 },
    deviceCount: 2,
    firstSeen: '2026-08-01T10:00:00.000Z',
    lastSeen: '2026-08-20T14:30:00.000Z',
    status: 'proposed',
    ...over,
  } as HealingRecordView;
}

export const healingRecord = record;

export const healingFixture: HealingResponse = {
  policy: { minSuccesses: 3, minRuns: 2 },
  records: [
    record(),
    // Không đạt quality gate ⇒ nút "Áp dụng" phải bị khoá VÀ nói ra lý do.
    record({
      id: 'h2',
      elementId: 'cart.total',
      platform: 'android',
      quality: {
        score: 31,
        stable: false,
        persistable: false,
        promotable: false,
        reasons: ['xpath theo vị trí', 'không có testId'],
      },
      proposed: { strategy: 'xpath', value: '//div[3]/span[2]', weight: 0.2, origin: 'healed' },
    }),
    // Một máy nhưng nhiều run ⇒ bằng chứng yếu, bản cũ làm mờ ô Máy.
    record({ id: 'h3', elementId: 'home.banner', platform: 'ios', status: 'watching', devices: { 'iPhone 15': 4 }, deviceCount: 1, runs: 4 }),
    record({ id: 'h4', elementId: 'nav.logout', status: 'applied' }),
  ],
  summary: { total: 4, proposed: 2, watching: 1, applied: 1, rejected: 0 },
};
