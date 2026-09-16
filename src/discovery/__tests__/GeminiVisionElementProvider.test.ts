import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GeminiVisionElementProvider,
  parseVisionAnswer,
} from '../ai/GeminiVisionElementProvider.js';
import type { UiObservation } from '../UiObservation.js';
import { RuntimeRegistry } from '../RuntimeRegistry.js';
import { VisionElementDiscovery } from '../ai/VisionElementDiscovery.js';

const observation: UiObservation = {
  id: 'screen-1',
  timestamp: '2026-09-15T00:00:00.000Z',
  platform: 'android',
  source: 'native',
  context: {},
  elements: [
    {
      id: 'menu-row-vix',
      role: 'android.view.View',
      interactive: true,
      visible: true,
      enabled: true,
      resourceId: 'row-vix',
      bounds: { x: 0, y: 100, width: 900, height: 80 },
      childIds: ['menu-icon-vix'],
    },
    {
      id: 'menu-icon-vix',
      parentId: 'menu-row-vix',
      role: 'android.widget.ImageView',
      accessibilityLabel: 'Icon ... tại dòng VIX',
      visible: true,
      enabled: true,
      bounds: { x: 830, y: 110, width: 50, height: 50 },
    },
  ],
};

describe('Gemini runtime vision provider', () => {
  it('parses a visually selected leaf and its proven clickable ancestor', () => {
    const result = parseVisionAnswer(JSON.stringify({
      candidate: {
        observedElementId: 'menu-icon-vix',
        clickableAncestorObservedElementId: 'menu-row-vix',
        confidence: 91,
        reasoning: 'Icon ba chấm ở cuối dòng VIX.',
      },
      bounds: { x: 830, y: 110, width: 50, height: 50 },
    }), observation.elements);
    assert.equal(result.candidate?.observedElementId, 'menu-icon-vix');
    assert.equal(result.candidate?.clickableAncestorObservedElementId, 'menu-row-vix');
    assert.equal(result.candidate?.confidence, 91);
    assert.deepEqual(result.bounds, { x: 830, y: 110, width: 50, height: 50 });
  });

  it('uses GEMINI_API_KEY in a header and sends both screenshot and observation', async () => {
    let request: RequestInit | undefined;
    const fetcher: typeof fetch = async (_input, init) => {
      request = init;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          candidate: {
            observedElementId: 'menu-icon-vix',
            visualDescription: 'Nút menu thao tác của dòng VIX',
            confidence: 88,
            reasoning: 'Khớp icon thao tác của dòng VIX.',
          },
        }) }] } }],
        usageMetadata: { totalTokenCount: 123 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new GeminiVisionElementProvider('secret-test-key', 'gemini-test', fetcher);
    const result = await provider.findElementInScreenshot({
      id: 'priceBoard.rowMenu',
      action: 'tap',
      label: 'Icon ... tại dòng VIX',
      context: ['Kết quả cần chứng minh: menu thao tác xuất hiện'],
    }, 'cG5n', observation);

    assert.equal((request?.headers as Record<string, string>)['x-goog-api-key'], 'secret-test-key');
    const body = JSON.parse(String(request?.body)) as {
      contents: Array<{ parts: Array<{ text?: string; inlineData?: { data: string } }> }>;
      generationConfig: {
        maxOutputTokens: number;
        responseMimeType: string;
        responseJsonSchema?: { properties?: { candidates?: { maxItems?: number } } };
      };
    };
    assert.match(body.contents[0]!.parts[0]!.text ?? '', /menu thao tác xuất hiện/);
    assert.equal(body.contents[0]!.parts[1]!.inlineData?.data, 'cG5n');
    assert.equal(body.generationConfig.maxOutputTokens, 1_800);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema?.properties?.candidates?.maxItems, 3);
    assert.equal(result.candidate?.observedElementId, 'menu-icon-vix');
    assert.equal(result.candidate?.visualDescription, 'Nút menu thao tác của dòng VIX');
    assert.equal(result.tokensUsed, 123);
  });

  it('retries once with a larger budget when Gemini truncates the JSON', async () => {
    let calls = 0;
    const budgets: number[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body)) as {
        generationConfig: { maxOutputTokens: number };
      };
      budgets.push(request.generationConfig.maxOutputTokens);
      if (calls === 1) {
        return new Response(JSON.stringify({
          candidates: [{
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: '{"candidates":[' }] },
          }],
          usageMetadata: { totalTokenCount: 700 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          candidates: [{
            observedElementId: 'menu-icon-vix',
            confidence: 92,
            reasoning: 'Icon thao tác nhìn thấy trên dòng VIX.',
          }],
        }) }] } }],
        usageMetadata: { totalTokenCount: 180 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = new GeminiVisionElementProvider('secret-test-key', 'gemini-test', fetcher);

    const result = await provider.findElementInScreenshot({
      id: 'priceBoard.rowMenu',
      action: 'tap',
      label: 'Icon ... tại dòng VIX',
    }, 'cG5n', observation);

    assert.equal(result.candidate?.observedElementId, 'menu-icon-vix');
    assert.equal(result.tokensUsed, 880);
    assert.equal(calls, 2);
    assert.deepEqual(budgets, [1_800, 3_000]);
  });

  it('retries transient capacity failures but not authentication failures', async () => {
    let capacityCalls = 0;
    const capacityFetcher: typeof fetch = async () => {
      capacityCalls += 1;
      if (capacityCalls === 1) return new Response('busy', { status: 503 });
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ candidates: [] }) }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const capacityProvider = new GeminiVisionElementProvider('key', 'model', capacityFetcher);
    await capacityProvider.findElementInScreenshot({ id: 'menu', action: 'tap' }, 'cG5n', observation);
    assert.equal(capacityCalls, 2);

    let authCalls = 0;
    const authProvider = new GeminiVisionElementProvider('key', 'model', async () => {
      authCalls += 1;
      return new Response('bad key', { status: 401 });
    });
    await assert.rejects(
      authProvider.findElementInScreenshot({ id: 'menu', action: 'tap' }, 'cG5n', observation),
      /Gemini Vision 401/,
    );
    assert.equal(authCalls, 1);
  });

  it('rejects an element id invented by the model', () => {
    const result = parseVisionAnswer(JSON.stringify({
      candidate: {
        observedElementId: 'not-in-observation',
        confidence: 99,
        reasoning: 'guess',
      },
    }), observation.elements);
    assert.equal(result.candidate, undefined);
  });

  it('keeps an unknown id only when bounds can be correlated later', () => {
    const result = parseVisionAnswer(JSON.stringify({
      candidate: {
        observedElementId: 'visual-only-id',
        confidence: 84,
        reasoning: 'Found by its position in the screenshot.',
      },
      bounds: { x: 830, y: 110, width: 50, height: 50 },
    }), observation.elements);
    assert.equal(result.candidate?.observedElementId, 'visual-only-id');
    assert.deepEqual(result.bounds, { x: 830, y: 110, width: 50, height: 50 });
  });

  it('uses literal screenshot text to supplement an incomplete accessibility tree', async () => {
    const runtime = await RuntimeRegistry.load('/dev/null/nonexistent-visual-evidence.json');
    const partialTree: UiObservation = {
      ...observation,
      elements: [{
        id: 'asset-card',
        role: 'region',
        text: 'Tài sản',
        testId: 'asset-card',
        visible: true,
        enabled: true,
        interactive: false,
      }],
    };
    const discovery = new VisionElementDiscovery({
      findElementInScreenshot: async () => ({
        candidates: [{
          observedElementId: 'asset-card',
          visualText: 'Tổng tài sản',
          confidence: 94,
          reasoning: 'The screenshot visibly contains the full heading.',
        }],
      }),
    }, runtime);
    const result = await discovery.discover({
      id: 'home.totalAssets',
      action: 'assert-visible',
      label: 'Tổng tài sản',
    }, 'cG5n', partialTree, { persistSuggestedLocator: false });

    assert.equal(result.method, 'vision');
    assert.equal(result.verification?.checks.labelMatch, true);
    assert.ok(result.evidence.some((line) => line.includes('supplements UI-tree text')));
    assert.deepEqual(runtime.allLocators('home.totalAssets'), []);
  });

  it('rejects a correlated node when neither visual nor tree text matches the intent', async () => {
    const runtime = await RuntimeRegistry.load('/dev/null/nonexistent-wrong-visual-evidence.json');
    const discovery = new VisionElementDiscovery({
      findElementInScreenshot: async () => ({
        candidates: [{
          observedElementId: 'menu-icon-vix',
          visualText: 'Thông báo',
          confidence: 98,
          reasoning: 'High-confidence but semantically wrong visual choice.',
        }],
      }),
    }, runtime);
    const result = await discovery.discover({
      id: 'priceBoard.rowMenu',
      action: 'assert-visible',
      label: 'Tổng tài sản',
    }, 'cG5n', observation, { persistSuggestedLocator: false });

    assert.equal(result.method, 'failed');
    assert.ok(result.evidence.some((line) => line.includes('neither UI-tree text')));
    assert.deepEqual(runtime.allLocators('priceBoard.rowMenu'), []);
  });

  it('accepts a bounded icon identity only when an observable outcome will verify it', async () => {
    const runtime = await RuntimeRegistry.load('/dev/null/nonexistent-bounded-icon-evidence.json');
    const discovery = new VisionElementDiscovery({
      findElementInScreenshot: async () => ({
        candidates: [{
          observedElementId: 'menu-icon-vix',
          visualText: '⋮',
          visualDescription: 'Nút menu thao tác của dòng mã cổ phiếu',
          confidence: 93,
          reasoning: 'The bounded three-dot icon is the row action control.',
        }],
      }),
    }, runtime);
    const intent = {
      id: 'priceBoard.rowMenu',
      action: 'tap' as const,
      label: 'Nút menu thao tác của dòng mã cổ phiếu',
    };

    const strict = await discovery.discover(intent, 'cG5n', observation, {
      persistSuggestedLocator: false,
    });
    const outcomeBounded = await discovery.discover(intent, 'cG5n', observation, {
      persistSuggestedLocator: false,
      allowExactTextProxy: true,
    });

    assert.equal(strict.method, 'failed');
    assert.equal(outcomeBounded.method, 'vision');
    assert.ok(outcomeBounded.evidence.some((line) => line.includes('bounded icon identity')));
    assert.deepEqual(runtime.allLocators('priceBoard.rowMenu'), []);
  });
});
