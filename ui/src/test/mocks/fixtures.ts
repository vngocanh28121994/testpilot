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

export const healingFixture: HealingResponse = {
  policy: { minSuccesses: 3, minRuns: 2 },
  records: [],
  summary: { total: 0, proposed: 0, watching: 0, applied: 0, rejected: 0 },
};
