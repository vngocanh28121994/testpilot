import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { server } from '@/test/mocks/server';
import { ROUTES } from '@/api/routes';
import { BuildCell } from '../index';
import type { BuildsResponse } from '@core/ui/contracts.js';

/**
 * "Ưu tiên bản có sẵn trên thiết bị hay bản được upload?" — câu hỏi này trước
 * đây không có chỗ nào để trả lời.
 *
 * Người dùng chỉ gặp nó dưới dạng một thông báo chặn lúc chạy, rồi phải tự tìm
 * ra tên một cờ trong file config. Chuyện có thật: một bản SIT đã tải lên nằm
 * trên đĩa còn config thì không trỏ tới, và máy thì đang cài đúng bản ấy.
 */
type Row = BuildsResponse['environments'][number];

const sit: Row = {
  env: 'sit',
  isDefault: false,
  android: null,
  ios: { path: 'build/sit/app-sit.ipa', exists: true, sizeMb: 138 },
  missing: [],
  preferInstalled: { android: false, ios: false },
};

/** Ô là một <td>, nên phải có bảng quanh nó mới hợp lệ. */
function renderCell(row: Row, platform: 'android' | 'ios') {
  return renderWithProviders(
    <table>
      <tbody>
        <tr>
          <BuildCell row={row} platform={platform} onDone={() => {}} />
        </tr>
      </tbody>
    </table>,
  );
}

describe('Bản build — nguồn app của môi trường', () => {
  it('hỏi ưu tiên bản nào, và mặc định là bản được upload', () => {
    renderCell(sit, 'ios');
    expect(screen.getByText('Ưu tiên bản nào?')).toBeInTheDocument();
    expect(screen.getByLabelText('Bản được upload')).toBeChecked();
    expect(screen.getByLabelText('Bản có sẵn trên thiết bị')).not.toBeChecked();
    expect(screen.getByText('build/sit/app-sit.ipa')).toBeInTheDocument();
  });

  /**
   * Chọn "bản trên thiết bị" không xoá file đã tải lên — hai thứ cùng tồn tại,
   * và lựa chọn là thứ quyết định dùng cái nào. Đổi ý thì bấm lại, không phải
   * đi tải lên lần nữa.
   */
  it('đang ưu tiên bản trên máy thì vẫn thấy file đã tải lên, kèm cảnh báo', () => {
    renderCell({ ...sit, preferInstalled: { android: false, ios: true } }, 'ios');
    expect(screen.getByLabelText('Bản có sẵn trên thiết bị')).toBeChecked();
    expect(screen.getByText('build/sit/app-sit.ipa')).toBeInTheDocument();
    expect(screen.getByText(/dùng chung bundle id/)).toBeInTheDocument();
  });

  it('chọn bản trên thiết bị thì gửi đúng môi trường và nền tảng lên', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post(ROUTES.buildSource, async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({});
      }),
    );
    renderCell(sit, 'ios');
    await userEvent.click(screen.getByLabelText('Bản có sẵn trên thiết bị'));
    await waitFor(() =>
      expect(sent).toEqual([{ env: 'sit', platform: 'ios', useInstalled: true }]),
    );
  });

  /**
   * Môi trường mặc định là chính cấu hình gốc, không có khối override nào để
   * ghi lựa chọn vào — hỏi ở đó là hỏi một câu không lưu được câu trả lời.
   */
  it('không hỏi ở dòng dùng chung', () => {
    renderCell({ ...sit, env: '', isDefault: true, ios: null }, 'ios');
    expect(screen.getByText('Tải lên…')).toBeInTheDocument();
    expect(screen.queryByText('Ưu tiên bản nào?')).not.toBeInTheDocument();
  });
});
