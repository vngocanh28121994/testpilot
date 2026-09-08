import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { TagChip } from '../TagChip';

/**
 * `@p0` không tự giải thích được nó là gì. Hệ thống đã có sẵn nhãn và mô tả
 * tiếng Việt cho từng tag trong tagTaxonomy, nhưng cả bản cũ lẫn bản React đều
 * chỉ in ra chuỗi thô và dùng taxonomy duy nhất cho gợi ý lúc sửa tag — nên
 * người đọc bảng không có cách nào biết @p0 khác @p1 ở chỗ nào.
 */
describe('TagChip', () => {
  it('giải thích tag ngay trên chính nó', async () => {
    renderWithProviders(<TagChip tag="@p0" />);
    const chip = await screen.findByText('@p0');
    // Chip hiện ngay từ render đầu; chỉ có phần NGHĨA là đến sau, khi taxonomy
    // về. Khẳng định ngay lúc thấy chữ là khẳng định trước khi có gì để đọc.
    await waitFor(() =>
      expect(chip.title).toBe(
        'P0 · Luồng trọng yếu — Happy path hoặc mục tiêu nghiệp vụ quan trọng nhất.',
      ),
    );
  });

  it('phân biệt được @p0 với @p1', async () => {
    const { unmount } = renderWithProviders(<TagChip tag="@p0" />);
    const p0chip = await screen.findByText('@p0');
    await waitFor(() => expect(p0chip.title).toMatch(/P0/));
    const p0 = p0chip.title;
    unmount();

    renderWithProviders(<TagChip tag="@p1" />);
    const p1chip = await screen.findByText('@p1');
    await waitFor(() => expect(p1chip.title).toMatch(/P1/));
    expect(p1chip.title).not.toBe(p0);
  });

  /**
   * Màu theo NHÓM, không theo từng tag: một bảng ba mươi kịch bản toàn chip xám
   * như nhau thì không quét bằng mắt được.
   */
  it('tag khác nhóm thì khác màu', async () => {
    const { unmount } = renderWithProviders(<TagChip tag="@p0" />);
    const p0chip = await screen.findByText('@p0');
    await waitFor(() => expect(p0chip.className).toMatch(/status-fail/));
    const priority = p0chip.className;
    unmount();

    renderWithProviders(<TagChip tag="@smoke" />);
    const smoke = await screen.findByText('@smoke');
    await waitFor(() => expect(smoke.className).toMatch(/status-running/));
    expect(smoke.className).not.toBe(priority);
  });

  /**
   * Tag lạ vẫn phải hiện: giấu đi thì người viết feature không bao giờ biết mình
   * vừa gõ sai một cái tên.
   */
  it('tag không có trong danh mục vẫn hiện, và nói rõ là không có', async () => {
    renderWithProviders(<TagChip tag="@go-bua" />);
    const chip = await screen.findByText('@go-bua');
    expect(chip.title).toMatch(/không có trong danh mục/);
  });
});
