import { beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ROUTES } from '@/api/routes';
import { server } from '@/test/mocks/server';
import { renderWithRouter } from '@/test/utils';
import ScenarioReviewPanel from '@/panels/ScenarioReview';

const render = () => renderWithRouter(<ScenarioReviewPanel search={{}} />, { path: '/scenarios' });

let puts: Array<{ filename: string; content: string; baseRevision?: string }>;

beforeEach(() => {
  puts = [];
  server.use(
    http.put(ROUTES.feature, async ({ request }) => {
      puts.push((await request.json()) as (typeof puts)[number]);
      return HttpResponse.json({ ok: true, revision: 'r2' });
    }),
  );
});

describe('ScenarioReviewPanel — sửa trực tiếp trên danh sách', () => {
  it('bấm tên kịch bản thì bung đúng khối Gherkin ngay dưới hàng', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');

    await user.click(
      screen.getByRole('button', { name: 'Sửa trực tiếp Đăng nhập thành công' }),
    );

    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Nội dung trực tiếp của Đăng nhập thành công',
    });
    expect(editor.value).toContain('Scenario: Đăng nhập thành công');
    expect(editor.value).not.toContain('Scenario: Sai mật khẩu');
  });

  it('dùng cùng bộ công cụ sửa tag, cú pháp, chuẩn hoá và phím Tab với panel đầy đủ', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(
      screen.getByRole('button', { name: 'Sửa trực tiếp Đăng nhập thành công' }),
    );

    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Nội dung trực tiếp của Đăng nhập thành công',
    });
    await user.click(screen.getByRole('button', { name: '@smoke' }));
    expect(editor.value.split('\n')[0]).toBe('@web @smoke');
    expect(screen.getByRole('searchbox', { name: 'Tìm trong bảng cú pháp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chuẩn hoá' })).toBeInTheDocument();

    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    await user.keyboard('{Tab}');
    expect(editor.value).toMatch(/  $/);
  });

  it('lưu inline chỉ thay đúng kịch bản và gửi revision chống ghi đè', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(
      screen.getByRole('button', { name: 'Sửa trực tiếp Đăng nhập thành công' }),
    );

    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Nội dung trực tiếp của Đăng nhập thành công',
    });
    fireEvent.change(editor, {
      target: {
        value: [
          '@web',
          '  Scenario: Đăng nhập thành công đã sửa',
          '    Given I open the app',
          '    Then I see "Trang tổng quan"',
        ].join('\n'),
      },
    });
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ filename: 'dang-nhap.feature', baseRevision: 'r1' });
    expect(puts[0]!.content).toContain('Scenario: Đăng nhập thành công đã sửa');
    expect(puts[0]!.content).toContain('Scenario: Sai mật khẩu');
  });

  it('đóng editor không ghi file', async () => {
    const user = userEvent.setup();
    await render();
    await screen.findByText('Đăng nhập thành công');
    await user.click(
      screen.getByRole('button', { name: 'Sửa trực tiếp Đăng nhập thành công' }),
    );
    await user.click(screen.getByRole('button', { name: 'Đóng' }));

    expect(
      screen.queryByRole('textbox', { name: 'Nội dung trực tiếp của Đăng nhập thành công' }),
    ).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });
});
