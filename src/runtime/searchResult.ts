import type { LocatorCandidate } from '../core/types.js';
import { normalizeHumanText } from '../core/text.js';
import type { UiDriver, UiHandle } from '../drivers/driver.js';

export interface ExactSearchResult {
  handle: UiHandle;
  candidate: LocatorCandidate;
  attempts: number;
}

/**
 * Find the requested feature by its exact visible title inside the feature
 * result block. The result ordering is relevance-based and is not an identity:
 * a more specific feature can legitimately appear before the exact query.
 */
export async function waitForExactSearchResult(
  driver: UiDriver,
  query: string,
  timeoutMs = 12_000,
  pollMs = 150,
): Promise<ExactSearchResult> {
  const candidate: LocatorCandidate = {
    strategy: 'label',
    value: query,
    weight: 1,
    origin: 'authored',
    // Web and WebView drivers apply this scope. A pure native context ignores
    // it and still uses the exact accessibility label/text.
    runtimeScope: '.searched-feature-block',
  };
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastSeen = '';
  let announced = false;

  do {
    attempts += 1;
    const handle = await driver.find(candidate).catch(() => null);
    if (handle && await handle.isVisible().catch(() => false)) {
      const title = (await handle.text().catch(() => '')).trim();
      if (title) lastSeen = title;
      if (normalizeHumanText(title) === normalizeHumanText(query)) {
        if (announced) console.log(`[flow:wait] đã thấy đúng kết quả "${query}".`);
        return { handle, candidate, attempts };
      }
    }

    if (!announced) {
      announced = true;
      console.log(`[flow:wait] đang chờ kết quả chính xác "${query}"…`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);

  throw new Error(
    `Không thấy kết quả tìm kiếm khớp chính xác "${query}" trong ${timeoutMs}ms`
    + `${lastSeen ? `; kết quả cuối cùng là "${lastSeen}"` : ''}.`,
  );
}
