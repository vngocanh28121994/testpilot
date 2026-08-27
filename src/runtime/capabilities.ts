import type { Platform } from '../core/types.js';

export type RuntimeCapability = 'hover' | 'dragDrop' | 'scroll' | 'scrollTo';

export interface RuntimeCapabilityDef {
  description: string;
  platforms: Readonly<Record<Platform, boolean>>;
}

/**
 * Authoritative action support matrix. Natural-language normalization may only
 * emit actions listed here; execution checks the current runtime platform
 * before attempting locator discovery or healing.
 */
export const ACTION_CAPABILITIES: Readonly<Record<RuntimeCapability, RuntimeCapabilityDef>> = {
  hover: {
    description: 'Move a real pointer over an element',
    platforms: { web: true, android: false, ios: false },
  },
  dragDrop: {
    description: 'Drag one element to another',
    platforms: { web: true, android: true, ios: true },
  },
  scroll: {
    description: 'Scroll the current viewport',
    platforms: { web: true, android: true, ios: true },
  },
  scrollTo: {
    description: 'Bring a target element into view',
    platforms: { web: true, android: true, ios: true },
  },
};

export class UnsupportedActionCapabilityError extends Error {
  constructor(readonly capability: RuntimeCapability, readonly platform: Platform) {
    super(
      `Thao tác "${capability}" chưa được hỗ trợ trong context ${platform}. ` +
      (capability === 'hover'
        ? 'Hover cần con trỏ thật nên chỉ chạy trên web hoặc WebView.'
        : 'Driver hiện tại chưa cung cấp implementation cho thao tác này.'),
    );
    this.name = 'UnsupportedActionCapabilityError';
  }
}

export function assertCapabilitySupported(
  capability: RuntimeCapability,
  platform: Platform,
): void {
  if (!ACTION_CAPABILITIES[capability].platforms[platform]) {
    throw new UnsupportedActionCapabilityError(capability, platform);
  }
}
