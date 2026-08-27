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
