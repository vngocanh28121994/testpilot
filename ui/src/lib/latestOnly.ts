/**
 * Chạy việc cho phần tử MỚI NHẤT, một việc tại một thời điểm.
 *
 * Dùng cho luồng ảnh JPEG của màn Điều khiển thiết bị: ảnh tới 30 lần mỗi giây,
 * và người điều khiển chỉ cần thấy trạng thái HIỆN TẠI của máy. Trong lúc một
 * ảnh đang giải mã, ảnh tới sau thay chỗ nhau — chỉ ảnh cuối cùng được giải mã
 * tiếp. Không có hàng chờ nào để trễ dồn lên, và không có hai lần giải mã chạy
 * song song để ảnh cũ vẽ đè lên ảnh mới.
 */
export function latestOnly<T>(work: (item: T) => Promise<void>): (item: T) => void {
  let next: { item: T } | undefined;
  let busy = false;
  const drain = async (): Promise<void> => {
    busy = true;
    try {
      while (next) {
        const { item } = next;
        next = undefined;
        try {
          await work(item);
        } catch {
          // Một phần tử hỏng không được làm kẹt những phần tử sau.
        }
      }
    } finally {
      busy = false;
    }
  };
  return (item) => {
    next = { item };
    if (!busy) void drain();
  };
}
