import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { CheckedAt } from '@/components/CheckedAt';

describe('CheckedAt', () => {
  it('hiện giờ của lần dò gần nhất', () => {
    render(<CheckedAt at={new Date('2026-09-09T15:30:08').getTime()} />);
    expect(screen.getByText(/đã kiểm lúc \d{1,2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('đang chạy thì nói đang chạy, không hiện giờ cũ', () => {
    render(<CheckedAt at={Date.now()} busy />);
    expect(screen.getByText('đang kiểm…')).toBeInTheDocument();
    expect(screen.queryByText(/đã kiểm lúc/)).toBeNull();
  });

  it('chưa dò lần nào thì không hiện gì', () => {
    const { container } = render(<CheckedAt />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * Mọi nút "kiểm tra" phải để lại dấu.
 *
 * Kết quả của chúng THƯỜNG không đổi, nên bấm xong màn hình đứng im và không
 * phân biệt được "đã kiểm rồi, vẫn vậy" với "nút hỏng". Vòng quay không cứu
 * được: một lần dò mất khoảng 11ms trên kết nối đã ấm, đo trên trình duyệt
 * thật.
 *
 * Test quét nguồn thay vì render, vì thứ cần chặn là một nút MỚI mọc ra ở đâu
 * đó mà quên dấu thời gian — đúng chuyện vừa xảy ra: sửa cho nút "Kiểm tra
 * lại" rồi để nguyên "Kiểm tra Xcode" và "Xem thiết bị hệ thống thấy" bên
 * cạnh, và người dùng gặp lại y nguyên lỗi cũ.
 */
describe('không nút kiểm tra nào bị bỏ quên', () => {
  /** Bỏ comment: nhắc tới một thứ trong câu giải thích không phải là dùng nó. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /**
   * Bỏ luôn nội dung toast, cùng một lý do.
   *
   * Một câu như “rồi bấm Kiểm tra lại” là chỉ đường tới nút, không phải một nút.
   * Không bỏ thì test bắt nhầm mọi file lịch sự chỉ đường, và cách chữa duy
   * nhất là viết câu tệ đi — tức là test làm hỏng đúng thứ nó muốn bảo vệ.
   */
  const stripToasts = (source: string) =>
    source.replace(/toast\.[a-z]+\((?:[^()]|\([^()]*\))*\)/g, '');
  const src = (rel: string) => stripComments(readFileSync(path.resolve('ui/src', rel), 'utf8'));

  /**
   * Nút này không dò gì tại chỗ — nó làm mới kết luận preflight ở một THẺ KHÁC
   * phía trên, có thể đang ngoài tầm nhìn. Nên dấu thời gian tại chỗ vô nghĩa;
   * thứ nó phải làm là kéo kết quả vào tầm mắt và nói ra.
   */
  it('"Kiểm tra lại sau khi sửa" kéo kết quả vào tầm nhìn và báo lại', () => {
    const code = src('panels/Runner/PrereqTools.tsx');
    expect(code).toMatch(/scrollIntoView/);
    expect(code).toMatch(/Đã kiểm tra lại môi trường/);
    // Và không được là ghost: nó phải trông ra một cái nút.
    expect(code).not.toMatch(/variant="ghost"/);
  });

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
      return /\.tsx$/.test(name) ? [full] : [];
    });

  it('file nào có nút kiểm tra thì file đó phải dùng CheckedAt', () => {
    const offenders = walk(path.resolve('ui/src'))
      .filter((file) => file !== path.resolve('ui/src/components/CheckedAt.tsx'))
      .filter((file) => {
        const code = stripToasts(stripComments(readFileSync(file, 'utf8')));
        const hasProbeButton = /(Kiểm tra Xcode|Kiểm tra lại|Xem thiết bị hệ thống thấy)/.test(code);
        return hasProbeButton && !code.includes('CheckedAt');
      })
      .map((file) => path.relative(path.resolve('ui/src'), file));
    expect(offenders).toEqual([]);
  });
});
