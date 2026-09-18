/**
 * Một model Gemini cạn quota không được phép làm mù cả tầng thị giác.
 *
 * Đo trên máy thật ngày 2026-09-16: `gemini-3.6-flash` trả 429 ngay ở element
 * đầu tiên cần tới thị giác, và circuit breaker tắt tầng ấy cho cả lượt chạy.
 * Đó là tầng DUY NHẤT nhận ra được một nút chỉ có icon — không chữ, không
 * nhãn, không testid — nên kịch bản hỏng ở một bước mà log chỉ nói "không có
 * ứng viên dùng được". Quota là của từng model, nên một model cạn không có
 * nghĩa là hết đường.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiVisionElementProvider } from '../ai/GeminiVisionElementProvider.js';
import {
  budgetForNextModel,
  DEFAULT_VISION_MODEL_CHAIN,
  ExhaustedModels,
  MIN_MODEL_BUDGET_MS,
  shouldTryNextModel,
  visionModelChain,
} from '../ai/geminiModels.js';
import type { ElementIntent } from '../ElementIntent.js';
import type { UiObservation } from '../UiObservation.js';

const intent: ElementIntent = { action: 'tap', label: 'Thêm mã' } as ElementIntent;
const observation = {
  id: 'o1',
  timestamp: '2026-09-16T00:00:00.000Z',
  platform: 'android',
  source: 'native',
  context: {},
  elements: [{ id: 'e1', role: 'button', text: 'Thêm mã', visible: true }],
} as unknown as UiObservation;

const answer = (text: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { totalTokenCount: 10 },
}), { status: 200 });

const found = JSON.stringify({
  candidates: [{
    observedElementId: 'e1',
    visualDescription: 'nút thêm mã',
    confidence: 90,
    reasoning: 'khớp nhãn',
  }],
});

/** Model nào được gọi, theo thứ tự, đọc ra từ URL endpoint. */
function recorder(reply: (model: string) => Response): { calls: string[]; fetcher: typeof fetch } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    const model = decodeURIComponent(String(url).split('/models/')[1]!.split(':')[0]!);
    calls.push(model);
    return reply(model);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe('chuỗi model Gemini', () => {
  it('hết quota ở model đầu thì sang model sau và vẫn trả lời được', async () => {
    const { calls, fetcher } = recorder((model) =>
      model === 'a' ? new Response('quota exceeded', { status: 429 }) : answer(found));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b', 'c'], fetcher);

    const result = await provider.findElementInScreenshot(intent, 'AAA', observation);
    assert.equal(result.modelId, 'b');
    assert.deepEqual(calls, ['a', 'b']);
  });

  /**
   * Model đã cạn thì nhớ luôn. Không nhớ thì mỗi element sau đó lại gọi nó một
   * lần trước khi sang model sống — hàng chục round-trip chỉ để nhận lại đúng
   * lỗi đã biết.
   */
  it('không gọi lại model đã cạn quota ở những lần sau', async () => {
    const { calls, fetcher } = recorder((model) =>
      model === 'a' ? new Response('quota exceeded', { status: 429 }) : answer(found));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);

    await provider.findElementInScreenshot(intent, 'AAA', observation);
    await provider.findElementInScreenshot(intent, 'AAA', observation);
    assert.deepEqual(calls, ['a', 'b', 'b']);
  });

  /**
   * Một câu trả lời hợp lệ mà không có ứng viên nào là một CÂU TRẢ LỜI. Chuyển
   * model lúc ấy chỉ nhân ba chi phí để nhận lại đúng kết quả đó, ba lần.
   */
  it('trả lời rỗng không phải là lỗi, không chuyển model', async () => {
    const { calls, fetcher } = recorder(() => answer(JSON.stringify({ candidates: [] })));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);

    const result = await provider.findElementInScreenshot(intent, 'AAA', observation);
    assert.equal(result.candidates?.length ?? 0, 0);
    assert.deepEqual(calls, ['a']);
  });

  /**
   * Lỗi không thuộc về model — thiếu quyền, ảnh hỏng, request sai — thì model
   * sau cũng hỏng y hệt. Thử tiếp chỉ làm chậm lúc hỏng và giấu nguyên nhân
   * thật sau hai lỗi giống nhau.
   */
  it('lỗi cấu hình thì hỏng ngay, không rải qua cả chuỗi', async () => {
    const { calls, fetcher } = recorder(() => new Response('permission denied', { status: 403 }));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b', 'c'], fetcher);

    await assert.rejects(
      () => provider.findElementInScreenshot(intent, 'AAA', observation),
      /403/,
    );
    assert.deepEqual(calls, ['a']);
  });

  it('cả chuỗi hỏng thì nói ra từng model hỏng vì gì', async () => {
    const { fetcher } = recorder(() => new Response('quota exceeded', { status: 429 }));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);

    await assert.rejects(
      () => provider.findElementInScreenshot(intent, 'AAA', observation),
      (err: Error) => /a: .*429/.test(err.message) && /b: .*429/.test(err.message),
    );
  });

  /**
   * Đo trên prod ngày 2026-09-18: model đầu hỏng, model dự phòng được gọi ở
   * giây thứ 14 của ngân sách 15 giây, và câu trả lời về khi resolver đã bỏ
   * cuộc — trả tiền cho một lượt gọi không ai đọc. Chuỗi fallback chỉ có nghĩa
   * khi model sau còn kịp trả lời.
   */
  it('hết ngân sách thì không gọi model dự phòng nữa', async () => {
    const { calls, fetcher } = recorder((model) =>
      model === 'a' ? new Response('quota exceeded', { status: 429 }) : answer(found));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);

    // Hạn chót đã ở quá khứ: model đầu cũng không được gọi.
    await assert.rejects(
      () => provider.findElementInScreenshot(intent, 'AAA', observation, {
        deadlineAt: Date.now() - 1,
      }),
      /không đủ để gọi/,
    );
    assert.deepEqual(calls, []);
  });

  it('còn dư thời gian thì chuỗi vẫn chạy như cũ', async () => {
    const { calls, fetcher } = recorder((model) =>
      model === 'a' ? new Response('quota exceeded', { status: 429 }) : answer(found));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);

    const result = await provider.findElementInScreenshot(intent, 'AAA', observation, {
      deadlineAt: Date.now() + 60_000,
    });
    assert.equal(result.modelId, 'b');
    assert.deepEqual(calls, ['a', 'b']);
  });

  /** Không nói hạn chót thì giữ nguyên hành vi cũ, không tự bịa ra một cái. */
  it('ngân sách: không có hạn chót thì dùng trọn thời gian chờ mặc định', () => {
    assert.equal(budgetForNextModel(12_000, undefined), 12_000);
    assert.equal(budgetForNextModel(12_000, 1_000, 0), 1_000);
    assert.equal(budgetForNextModel(12_000, 99_000, 0), 12_000);
    assert.equal(budgetForNextModel(12_000, 500, 1_000), 0, 'quá hạn thì không còn gì');
    assert.ok(MIN_MODEL_BUDGET_MS > 0);
  });

  /**
   * Đọc log prod mà chỉ thấy "không gọi được" thì không phân biệt được hết
   * quota (đợi sang ngày), tên model sai (sửa cấu hình) hay dịch vụ lỗi (chạy
   * lại là xong) — ba nguyên nhân với ba cách xử lý khác hẳn nhau.
   */
  it('log chuyển model nói ra nguyên nhân', async () => {
    const { fetcher } = recorder((model) =>
      model === 'a' ? new Response('quota exceeded', { status: 429 }) : answer(found));
    const provider = new GeminiVisionElementProvider('key', ['a', 'b'], fetcher);
    const lines: string[] = [];
    const warn = console.warn;
    console.warn = (line: string) => { lines.push(line); };
    try {
      await provider.findElementInScreenshot(intent, 'AAA', observation);
    } finally {
      console.warn = warn;
    }
    const line = lines.find((item) => item.includes('chuyển sang model dự phòng'));
    assert.ok(line, 'không thấy dòng chuyển model');
    assert.match(line, /429/);
  });

  it('đọc chuỗi từ biến môi trường, ngăn cách bằng dấu phẩy', () => {
    assert.deepEqual(visionModelChain('x, y ,z'), ['x', 'y', 'z']);
    assert.deepEqual(visionModelChain(''), [...DEFAULT_VISION_MODEL_CHAIN]);
    assert.deepEqual(visionModelChain(undefined), [...DEFAULT_VISION_MODEL_CHAIN]);
  });

  it('chỉ lỗi thuộc về model mới đáng chuyển tiếp', () => {
    for (const message of ['Gemini Vision 429: quota', 'Vision 404: not found', '503 unavailable']) {
      assert.equal(shouldTryNextModel(message), true, message);
    }
    for (const message of ['Gemini Vision 403: permission denied', 'không parse được JSON']) {
      assert.equal(shouldTryNextModel(message), false, message);
    }
  });

  /**
   * 5xx là lỗi tạm thời — dịch vụ hỏng một phút rồi lại chạy — nên lần này bỏ
   * qua model đó, lần sau vẫn phải thử lại. Nhớ nhầm nó thành chết vĩnh viễn
   * là tự vứt bỏ model tốt nhất của chuỗi vì một sự cố thoáng qua.
   */
  it('chỉ nhớ lỗi vĩnh viễn, không nhớ lỗi tạm thời', () => {
    const dead = new ExhaustedModels();
    dead.remember('a', 'Gemini Vision 429: quota exceeded');
    dead.remember('b', 'Gemini Vision 503: unavailable');
    assert.equal(dead.has('a'), true);
    assert.equal(dead.has('b'), false);
    assert.deepEqual(dead.usable(['a', 'b']), ['b']);
  });

  /** Cả chuỗi chết thì vẫn gọi một lần rồi hỏng có thông báo, không im lặng. */
  it('cả chuỗi chết vẫn còn đường hỏng có tiếng', () => {
    const dead = new ExhaustedModels();
    dead.remember('a', '429 quota');
    dead.remember('b', '429 quota');
    assert.deepEqual(dead.usable(['a', 'b']), ['a', 'b']);
  });
});
