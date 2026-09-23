/**
 * Gom máy theo CHIẾC MÁY TÍNH nó cắm vào, máy của mình lên trước.
 *
 * Ở một chỗ dùng chung vì có HAI màn hỏi cùng câu ấy — Local Runner và App
 * Automation Studio — và hai bản chép tay sẽ lệch nhau ở đúng những chi tiết
 * người dùng nhìn thấy: nhóm nào lên trước, máy chưa rõ nguồn gốc thì hiện hay
 * giấu, tên nhóm viết thế nào.
 *
 * Vì sao nhóm theo máy tính chứ không theo nền tảng: nền tảng đã chọn ở ô phía
 * trên, còn câu chưa ai trả lời là "chiếc này ở bàn tôi hay ở phòng máy". Hai
 * thứ ấy khác nhau về hệ quả — máy ở bàn mình thì cắm rút tuỳ ý, máy phòng máy
 * thì người khác cũng đang chờ.
 */

/** Đủ để gom nhóm; mỗi màn thêm phần của riêng nó. */
export interface OnSomeMachine {
  /** Tên chiếc máy tính giữ nó. Vắng mặt nghĩa là chưa biết. */
  runnerName?: string;
  /** Máy cắm ở chính máy tính của người đang xem. */
  mine?: boolean;
}

export interface MachineGroup<T> {
  key: string;
  title: string;
  mine: boolean;
  list: T[];
}

export function groupByMachine<T extends OnSomeMachine>(items: T[]): Array<MachineGroup<T>> {
  const order: string[] = [];
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = item.runnerName ?? '';
    if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
    byKey.get(key)!.push(item);
  }
  return order
    .map((key) => ({
      key: key || 'chưa-rõ',
      title: key || 'chưa rõ máy',
      // Máy chưa biết nằm ở đâu vẫn hiện, chỉ xuống cuối: chúng chạy được, và
      // giấu một chiếc máy dùng được là cách chắc chắn để người ta tưởng nó
      // hỏng.
      mine: byKey.get(key)!.some((item) => item.mine),
      list: byKey.get(key)!,
    }))
    // Máy của mình lên đầu: đó là chiếc người ta vừa cắm và đang định chạy.
    // Giữ nguyên thứ tự còn lại, để danh sách không nhảy giữa hai lần dò.
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}
