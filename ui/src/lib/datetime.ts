import { endOfDay, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';

/**
 * Định dạng thời gian của bảng điều khiển — giữ nguyên `when()` ở app.js:1067.
 *
 * Cố ý dùng locale 'vi-VN' cố định chứ không theo locale trình duyệt: bảng này
 * đối chiếu song song với bản cũ suốt Phase 5, và một định dạng ngày khác nhau
 * giữa hai tab là thứ trông như lệch dữ liệu.
 */
export function when(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Một mốc thời gian có nằm trong khoảng đã chọn không.
 *
 * Dùng chung cho mọi bảng có lọc theo ngày. Trước đây nó nằm riêng trong panel
 * Workflow History, nên bảng lịch sử chạy local — thêm sau — sẽ phải có bản thứ
 * hai, và hai bản đó sẽ lệch nhau đúng vào lúc không ai để ý.
 *
 * Chưa chọn khoảng nào thì mọi thứ đều lọt: bộ lọc trống không phải là bộ lọc
 * chặn hết. Ngược lại, một mốc thời gian không đọc được thì bị loại — nó không
 * chứng minh được mình nằm trong khoảng.
 *
 * Cả hai đầu đều tính trọn ngày: chọn "hôm nay" mà lượt chạy lúc 14:00 bị loại
 * vì mốc so sánh là 00:00 thì bộ lọc trông như hỏng.
 */
export function inRange(iso: string | undefined, range: DateRange | undefined): boolean {
  if (!range?.from) return true;
  const time = Date.parse(iso ?? '');
  if (Number.isNaN(time)) return false;
  return time >= startOfDay(range.from).getTime()
    && time <= endOfDay(range.to ?? range.from).getTime();
}
