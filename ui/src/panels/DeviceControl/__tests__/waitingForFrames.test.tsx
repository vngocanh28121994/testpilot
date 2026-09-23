/**
 * Ô hình trống phải NÓI nó đang ở trạng thái nào.
 *
 * Trước đây, khoảng từ lúc bấm "Giữ máy" tới khung hình đầu tiên là một ô xám
 * trống — giống hệt ô xám trống của một luồng đã chết. Người dùng không phân
 * biệt được, và "treo" là chữ họ dùng cho cả hai.
 *
 * Khoảng ấy không ngắn: scrcpy phải đẩy file lên máy rồi dựng một tiến trình
 * Java ở đó, đo được khoảng hai giây rưỡi, và lần đầu còn lâu hơn.
 *
 * Dựng thẳng component chứ không dựng cả panel: panel mở `EventSource` và
 * `VideoDecoder`, hai thứ jsdom không có — và bài test sẽ đo môi trường giả
 * lập chứ không đo câu chữ hiện ra.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { WaitingForFrames } from '@/panels/DeviceControl';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('chờ khung hình đầu tiên', () => {
  it('nói đang mở luồng, không để ô trống câm', () => {
    render(<WaitingForFrames />);
    expect(screen.getByText(/Đang mở luồng hình/)).toBeInTheDocument();
  });

  it('là một vùng trạng thái, để trình đọc màn hình đọc được', () => {
    render(<WaitingForFrames />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('chờ quá lâu thì đổi giọng và chỉ việc phải làm', () => {
    // Trấn an mãi là vô ích khi thứ người ta cần là biết bấm gì tiếp.
    //
    // `act` chứ không `waitFor`: `waitFor` chờ bằng đồng hồ THẬT, mà đồng hồ ở
    // đây đã bị thay bằng đồng hồ giả — hai thứ ấy gặp nhau thì bài test treo
    // cho tới khi hết giờ.
    render(<WaitingForFrames />);
    act(() => { vi.advanceTimersByTime(13_000); });
    expect(screen.getByText(/Chưa nhận được khung hình nào/)).toBeInTheDocument();
    expect(screen.getByText(/Nhả máy/)).toBeInTheDocument();
    expect(screen.queryByText(/Đang mở luồng hình/)).toBeNull();
  });

  it('chưa tới mốc thì vẫn là câu trấn an', () => {
    render(<WaitingForFrames />);
    vi.advanceTimersByTime(11_000);
    expect(screen.getByText(/Đang mở luồng hình/)).toBeInTheDocument();
  });
});
