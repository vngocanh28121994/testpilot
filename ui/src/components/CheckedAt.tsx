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
  // Đang kiểm mà đã có dấu thời gian cũ thì GIỮ nguyên nó, chỉ làm mờ đi.
  //
  // Nút bấm ngay cạnh vốn đã bị khoá và có vòng quay, nên chữ "đang kiểm…" nói
  // lại đúng điều đó một lần nữa — và vì nó ngắn hơn hẳn "đã kiểm lúc
  // 16:17:15", cả cụm co vào rồi giãn ra sau mỗi lần bấm. Một thông tin, hai
  // chỗ nói, kèm một cú giật.
  //
  // Lần kiểm đầu tiên: không hiện gì cả.
  //
  // Đây mới là lúc người dùng nhìn thấy nhiều nhất, chứ không phải lúc bấm tay:
  // dấu thời gian sống trong state của màn hình, nên MỖI lần mở trang nó về
  // rỗng và cú kiểm lúc mount rơi đúng vào nhánh này. Chữ "đang kiểm…" hiện ra
  // rồi biến mất sau ~11ms, kéo theo một cú giật, và nói lại đúng điều mà nút
  // bên cạnh — đang khoá và đang quay — đã nói.
  if (!at) return null;
  return (
    <span className={busy ? 'text-muted-foreground/60 text-xs' : 'text-muted-foreground text-xs'}>
      đã kiểm lúc {new Date(at).toLocaleTimeString('vi-VN')}
    </span>
  );
}
