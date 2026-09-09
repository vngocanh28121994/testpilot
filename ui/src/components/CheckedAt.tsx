/**
 * Dấu thời gian của lần dò gần nhất.
 *
 * Mọi nút "kiểm tra" ở đây đều có chung một vấn đề: kết quả THƯỜNG không đổi —
 * Xcode vẫn thế, máy vẫn thế — nên bấm xong màn hình đứng im, và không phân
 * biệt được "đã kiểm rồi, vẫn vậy" với "nút hỏng".
 *
 * Vòng quay không cứu được: đo trên trình duyệt thật, một lần dò mất khoảng
 * 11ms trên kết nối đã ấm. Nó chớp một cái rồi mất.
 *
 * Nên dấu thời gian là bằng chứng còn lại sau khi vòng quay dừng. Để ở một chỗ
 * dùng chung vì đúng chuyện này vừa xảy ra: sửa cho một nút mà quên hai nút
 * còn lại, và người dùng gặp lại y nguyên lỗi cũ ở nút bên cạnh.
 */
export function CheckedAt({ at, busy }: { at?: number; busy?: boolean }) {
  if (busy) return <span className="text-muted-foreground text-xs">đang kiểm…</span>;
  if (!at) return null;
  return (
    <span className="text-muted-foreground text-xs">
      đã kiểm lúc {new Date(at).toLocaleTimeString('vi-VN')}
    </span>
  );
}
