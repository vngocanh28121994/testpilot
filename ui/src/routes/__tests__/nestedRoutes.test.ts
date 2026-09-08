import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Bẫy lồng route của TanStack, đã làm hỏng ba trang cùng lúc.
 *
 * `runner.tsx` + `runner.history.tsx` không phải hai trang ngang hàng: file thứ
 * hai trở thành route CON của file thứ nhất. Cha không render <Outlet/> thì con
 * không bao giờ hiện — URL đổi thành /runner/history, thanh địa chỉ trông đúng,
 * mà màn hình vẫn là Local Runner. Bấm "Chi tiết" ở lịch sử chạy trông y như
 * một cái nút chết.
 *
 * Dấu gạch dưới cuối tên đoạn đường ("runner_.history.tsx") là cách TanStack
 * cho phép thoát khỏi việc lồng đó.
 */
describe('route lồng nhau', () => {
  // cwd của vitest là gốc repo, không phải ui/ — nên đường dẫn phải nói rõ.
  const dir = path.resolve('ui/src/routes');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && f !== '__root.tsx');

  it('mọi route con đều có cha render Outlet, hoặc đã thoát lồng bằng "_"', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const segments = file.replace(/\.tsx$/, '').split('.');
      if (segments.length < 2) continue;
      const parentSegment = segments[0]!;
      // Đã thoát lồng thì không còn cha nào để hỏi.
      if (parentSegment.endsWith('_')) continue;
      const parentFile = files.find((f) => f === `${parentSegment}.tsx`);
      if (!parentFile) continue; // không có cha ⇒ không lồng
      const parent = readFileSync(path.join(dir, parentFile), 'utf8');
      if (!parent.includes('Outlet')) offenders.push(`${file} (cha ${parentFile} không có Outlet)`);
    }
    expect(offenders).toEqual([]);
  });

  it('ba trang từng hỏng nay đều đứng độc lập', () => {
    for (const name of ['runner_.history.tsx', 'scenarios_.history.tsx', 'farm_.$runId.tsx']) {
      expect(files, `${name} phải tồn tại`).toContain(name);
    }
  });
});
