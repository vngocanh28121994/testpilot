/**
 * Quy đổi toạ độ: hàm nhỏ, nhưng là chỗ sai im lặng nhất của màn điều khiển.
 *
 * Nhầm giữa "kích thước khung video" và "kích thước màn hình" không làm hỏng
 * theo cách nhìn thấy được — cú chạm vẫn xảy ra, chỉ lệch đều theo tỉ lệ 1,5
 * lần, nên người ta đi tìm lỗi trong ứng dụng đang test.
 */
import { describe, it, expect } from 'vitest';
import { DRAG_THRESHOLD_PX, isDrag, toScreenPoint } from '@/lib/deviceScale';

const RECT = { left: 100, top: 50, width: 360, height: 800 };
const SCREEN = { width: 1080, height: 2400 };

describe('toScreenPoint', () => {
  it('góc trên trái của canvas là gốc màn hình', () => {
    expect(toScreenPoint({ clientX: 100, clientY: 50 }, RECT, SCREEN)).toEqual({ x: 0, y: 0 });
  });

  it('giữa canvas là giữa màn hình', () => {
    expect(toScreenPoint({ clientX: 280, clientY: 450 }, RECT, SCREEN))
      .toEqual({ x: 540, y: 1200 });
  });

  it('canvas nhỏ hơn màn hình ba lần thì toạ độ nhân lên ba lần', () => {
    expect(toScreenPoint({ clientX: 100 + 120, clientY: 50 + 200 }, RECT, SCREEN))
      .toEqual({ x: 360, y: 600 });
  });

  /** Kéo ra ngoài mép canvas là chuyện thường khi quét. */
  it('kẹp vào trong màn hình thay vì trả toạ độ âm hay vượt biên', () => {
    expect(toScreenPoint({ clientX: 0, clientY: 0 }, RECT, SCREEN)).toEqual({ x: 0, y: 0 });
    expect(toScreenPoint({ clientX: 9_999, clientY: 9_999 }, RECT, SCREEN))
      .toEqual({ x: 1080, y: 2400 });
  });

  it('canvas chưa có kích thước thì không chia cho không', () => {
    const empty = { left: 0, top: 0, width: 0, height: 0 };
    expect(toScreenPoint({ clientX: 10, clientY: 10 }, empty, SCREEN)).toEqual({ x: 0, y: 0 });
  });
});

describe('isDrag', () => {
  it('nhích vài pixel vẫn là một cú chạm', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 103, y: 102 })).toBe(false);
  });

  it('kéo xa hơn ngưỡng thì là quét', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 100, y: 100 + DRAG_THRESHOLD_PX })).toBe(true);
  });
});
