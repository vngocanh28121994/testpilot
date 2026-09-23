import { describe, expect, it } from 'vitest';
import { groupByMachine } from '@/lib/deviceGroups';
import type { DeviceTarget } from '@/components/DeviceChips';

/**
 * Nhóm theo CHIẾC MÁY TÍNH, không theo nền tảng.
 *
 * Nền tảng đã chọn ở ô phía trên và hiện trên từng chip. Câu chưa ai trả lời
 * là "chiếc này ở bàn tôi hay ở phòng máy" — và hai thứ ấy khác nhau về hệ
 * quả: máy ở bàn mình thì cắm rút tuỳ ý, máy phòng máy thì người khác cũng
 * đang chờ.
 */
describe('gom máy theo máy tính', () => {
  const device = (over: Partial<DeviceTarget>): DeviceTarget => ({
    platform: 'android', id: 'x', ...over,
  });

  it('mỗi máy tính một nhóm, giữ nguyên thứ tự máy trong nhóm', () => {
    const groups = groupByMachine([
      device({ id: 'a', runnerName: 'phòng máy' }),
      device({ id: 'b', runnerName: 'laptop của Bình', mine: true }),
      device({ id: 'c', runnerName: 'phòng máy' }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['laptop của Bình', 'phòng máy']);
    expect(groups[1]!.list.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('máy của mình lên đầu — đó là chiếc vừa cắm', () => {
    const groups = groupByMachine([
      device({ id: 'a', runnerName: 'phòng máy' }),
      device({ id: 'b', runnerName: 'máy tôi', mine: true }),
    ]);
    expect(groups[0]!.title).toEqual('máy tôi');
  });

  it('đánh dấu nhóm nào là máy của người đang xem', () => {
    // Tên máy do người dùng tự đặt, nên "laptop của Bình" không nói cho Bình
    // biết đó là máy của mình. Nhãn phải là một trường riêng.
    const groups = groupByMachine([
      device({ id: 'a', runnerName: 'phòng máy' }),
      device({ id: 'b', runnerName: 'laptop của Bình', mine: true }),
    ]);
    expect(groups.map((g) => g.mine)).toEqual([true, false]);
  });

  it('chưa biết ở đâu thì vẫn hiện, không bị bỏ đi', () => {
    // Giấu một chiếc máy dùng được là cách chắc chắn để người ta tưởng nó hỏng.
    const groups = groupByMachine([device({ id: 'a' })]);
    expect(groups.length).toEqual(1);
    expect(groups[0]!.list.length).toEqual(1);
  });

  it('gộp đúng máy cùng tên dù nằm rải rác trong danh sách', () => {
    const groups = groupByMachine([
      device({ id: 'a', runnerName: 'm1' }),
      device({ id: 'b', runnerName: 'm2' }),
      device({ id: 'c', runnerName: 'm1' }),
    ]);
    expect(groups.length).toEqual(2);
    expect(groups.find((g) => g.title === 'm1')!.list.map((t) => t.id)).toEqual(['a', 'c']);
  });
});
