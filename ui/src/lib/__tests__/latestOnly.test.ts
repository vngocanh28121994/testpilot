import { describe, expect, it } from 'vitest';
import { latestOnly } from '../latestOnly';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('latestOnly', () => {
  it('trong lúc đang làm, chỉ phần tử MỚI NHẤT được làm tiếp — không hàng chờ', async () => {
    const gates: Array<ReturnType<typeof deferred>> = [];
    const done: number[] = [];
    const run = latestOnly(async (n: number) => {
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      done.push(n);
    });
    run(1);
    run(2);
    run(3);
    run(4);
    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    gates[1]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual([1, 4]);
  });

  it('không bao giờ chạy hai việc cùng lúc', async () => {
    let live = 0;
    let peak = 0;
    const run = latestOnly(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
    });
    for (let i = 0; i < 20; i += 1) run(i);
    await new Promise((r) => setTimeout(r, 20));
    expect(peak).toBe(1);
  });

  it('một phần tử hỏng không làm kẹt phần tử sau', async () => {
    const done: number[] = [];
    const run = latestOnly(async (n: number) => {
      if (n === 1) throw new Error('ảnh hỏng');
      done.push(n);
    });
    run(1);
    await new Promise((r) => setTimeout(r, 0));
    run(2);
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toEqual([2]);
  });
});
