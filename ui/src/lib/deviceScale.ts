/**
 * Quy đổi một cú bấm trên canvas thành toạ độ của MÀN HÌNH máy.
 *
 * Ba hệ toạ độ chồng nhau ở màn điều khiển: canvas vẽ ở kích thước nào tuỳ bố
 * cục trang, khung video là 720 chiều rộng, còn `input tap` đi theo kích thước
 * thật của màn hình (1080 chẳng hạn). Nhầm giữa hai hệ sau không làm hỏng theo
 * cách nhìn thấy được — cú chạm vẫn xảy ra, chỉ là lệch đều đặn theo tỉ lệ, nên
 * nó trông như "app hỏng" chứ không như "toạ độ sai".
 *
 * Nên phép quy đổi là một hàm thuần, và nó có test.
 */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toScreenPoint(
  at: { clientX: number; clientY: number },
  rect: Rect,
  screen: { width: number; height: number },
): { x: number; y: number } {
  // Kẹp vào trong màn hình: kéo chuột ra ngoài mép canvas là chuyện thường khi
  // quét, và server từ chối toạ độ ngoài biên — nên kẹp ở đây để cú quét vẫn
  // đi, thay vì trả về một lỗi mà người dùng không hiểu mình làm sai gì.
  const ratioX = rect.width === 0 ? 0 : (at.clientX - rect.left) / rect.width;
  const ratioY = rect.height === 0 ? 0 : (at.clientY - rect.top) / rect.height;
  const clamp = (value: number, max: number): number =>
    Math.max(0, Math.min(max, Math.round(value)));
  return {
    x: clamp(ratioX * screen.width, screen.width),
    y: clamp(ratioY * screen.height, screen.height),
  };
}

/** Kéo bao nhiêu pixel thì tính là quét, dưới mức đó là chạm. */
export const DRAG_THRESHOLD_PX = 12;

export function isDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD_PX;
}
