import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { DeviceChips, chipLabel, matchesQuery, selectionHint, type DeviceTarget } from '@/components/DeviceChips';

/**
 * v2 chỉ có radio chọn MỘT máy, và Local Runner luôn gửi đúng một phần tử
 * trong `devices`. Nghĩa là giao diện không có cách nào khởi động một lượt chạy
 * song song, dù server đã làm được từ lâu: `devices.length > 1` là rẽ sang
 * run-parallel.ts, một tiến trình con cho mỗi máy.
 */
const targets: DeviceTarget[] = [
  { platform: 'android', id: 'sm-s918b', deviceName: 'SM_S918B', udid: 'R5C1', attached: true },
  { platform: 'android', id: 'sm-s938b', deviceName: 'SM_S938B', udid: 'R5C2', attached: false },
  // Nền tảng không được dò: tình trạng là CHƯA BIẾT, không phải "chưa cắm".
  { platform: 'ios', id: 'iphone-12-pro-max', deviceName: 'iPhone của Anh', udid: '0008', friendlyName: 'iPhone 12 Pro Max' },
];

describe('selectionHint', () => {
  it('chưa chọn thì nói rõ sẽ chạy như bình thường', () => {
    expect(selectionHint([], 'android')).toMatch(/Chưa chọn.*android/);
  });

  /** Một máy và hai máy khác nhau cả về thời gian lẫn cách gộp kết quả. */
  it('một máy là tuần tự, nhiều máy là song song', () => {
    expect(selectionHint(['android:a'], 'android')).toMatch(/tuần tự/);
    expect(selectionHint(['android:a', 'android:b'], 'android')).toMatch(/song song/);
  });

  it('bắc qua hai nền tảng thì nói ra', () => {
    expect(selectionHint(['android:a', 'ios:b'], 'android')).toMatch(/android \+ ios/);
  });
});

describe('matchesQuery', () => {
  const t = targets[0]!;
  it('khớp theo id, tên máy và udid', () => {
    expect(matchesQuery(t, 's918')).toBe(true);
    expect(matchesQuery(t, 'SM_S918B')).toBe(true);
    expect(matchesQuery(t, 'r5c1')).toBe(true);
  });
  it('rỗng thì khớp tất cả', () => {
    expect(matchesQuery(t, '  ')).toBe(true);
  });
  it('không khớp thì trả false', () => {
    expect(matchesQuery(t, 'iphone')).toBe(false);
  });
});

describe('DeviceChips', () => {
  const setup = (selected: string[] = []) => {
    const onToggle = vi.fn();
    render(
      <DeviceChips targets={targets} selected={selected} onToggle={onToggle} fallbackPlatform="android" />,
    );
    return onToggle;
  };

  it('hiện cả máy chưa cắm', () => {
    setup();
    expect(screen.getByRole('button', { name: /SM_S938B/ })).toBeInTheDocument();
    // Chip hiện TÊN máy khi biết, nên tìm theo tên chứ không theo mã.
    expect(screen.getByRole('button', { name: /iPhone 12 Pro Max/ })).toBeInTheDocument();
  });

  it('chọn được nhiều máy', async () => {
    const user = userEvent.setup();
    const onToggle = setup(['android:sm-s918b']);
    await user.click(screen.getByRole('button', { name: /SM_S938B/ }));
    expect(onToggle).toHaveBeenCalledWith('android:sm-s938b');
  });

  it('lọc theo ô tìm kiếm', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Tìm thiết bị' }), 'iphone');
    expect(screen.getByRole('button', { name: /iPhone 12 Pro Max/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SM_S918B/ })).toBeNull();
  });

  /**
   * Gõ tìm rồi thấy máy đang chọn biến mất là mất luôn cách bỏ chọn nó, và
   * dòng tổng kết bên dưới thành khó hiểu.
   */
  it('máy đang chọn không bị lọc mất', async () => {
    const user = userEvent.setup();
    setup(['android:sm-s918b']);
    await user.type(screen.getByRole('searchbox', { name: 'Tìm thiết bị' }), 'iphone');
    expect(screen.getByRole('button', { name: /SM_S918B/ })).toBeInTheDocument();
  });

  it('không khớp gì thì nói ra', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Tìm thiết bị' }), 'zzz');
    expect(screen.getByText('Không có thiết bị nào khớp.')).toBeInTheDocument();
  });

  /**
   * Preflight chỉ dò nền tảng đang chọn. Vẽ chấm xám cho nền tảng còn lại là
   * khẳng định "chưa cắm" mà chưa hề kiểm tra.
   */
  it('không vẽ chấm khi chưa biết máy có cắm hay không', () => {
    setup();
    const dots = (name: RegExp) =>
      screen.getByRole('button', { name }).querySelectorAll('span[aria-hidden="true"]').length;
    expect(dots(/SM_S918B/)).toBe(1);
    expect(dots(/iPhone 12 Pro Max/)).toBe(0);
  });

  it('máy đang chọn nói ra bằng aria-pressed, không chỉ bằng màu', () => {
    setup(['android:sm-s918b']);
    expect(screen.getByRole('button', { name: /SM_S918B/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /SM_S938B/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('chipLabel', () => {
  /**
   * Tên thương mại thật chỉ iOS có (qua devicectl). Android hầu như không
   * khai — tôi hỏi thẳng một Galaxy S25 Ultra đang cắm, cả sáu prop
   * marketname đều trống — nên ở đó `deviceName` trong config là thứ đọc được
   * nhất: ngắn, ổn định, do đội đặt.
   */
  it('tên thương mại thắng khi có', () => {
    expect(chipLabel({ platform: 'ios', id: 'x', deviceName: 'iPhone của Anh', friendlyName: 'iPhone 12 Pro Max' }))
      .toBe('iPhone 12 Pro Max');
  });

  it('không có thì dùng deviceName của config', () => {
    expect(chipLabel({ platform: 'android', id: 'sm-s938b', deviceName: 'SM_S938B' })).toBe('SM_S938B');
  });

  it('không có gì thì dùng id', () => {
    expect(chipLabel({ platform: 'android', id: 'sm-s938b' })).toBe('sm-s938b');
  });
});

describe('tên máy đọc được', () => {
  it('hiện tên thật cho ios, deviceName cho android', () => {
    render(<DeviceChips targets={targets} selected={[]} onToggle={vi.fn()} fallbackPlatform="android" />);
    expect(screen.getByRole('button', { name: /iPhone 12 Pro Max/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SM_S918B/ })).toBeInTheDocument();
  });

  it('tìm được theo cả tên thật lẫn mã máy', async () => {
    const user = userEvent.setup();
    render(<DeviceChips targets={targets} selected={[]} onToggle={vi.fn()} fallbackPlatform="android" />);
    const box = screen.getByRole('searchbox', { name: 'Tìm thiết bị' });
    await user.type(box, 'pro max');
    expect(screen.getByRole('button', { name: /iPhone 12 Pro Max/ })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, 'iphone-12');
    expect(screen.getByRole('button', { name: /iPhone 12 Pro Max/ })).toBeInTheDocument();
  });
});

describe('nút dò máy đang cắm', () => {
  it('gọi ra ngoài khi bấm', async () => {
    const user = userEvent.setup();
    const onDetect = vi.fn();
    render(
      <DeviceChips
        targets={targets}
        selected={[]}
        onToggle={vi.fn()}
        fallbackPlatform="android"
        onDetect={onDetect}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Kiểm tra máy đang cắm' }));
    expect(onDetect).toHaveBeenCalledTimes(1);
  });

  it('đang dò thì khoá nút và nói ra', () => {
    render(
      <DeviceChips
        targets={targets}
        selected={[]}
        onToggle={vi.fn()}
        fallbackPlatform="android"
        onDetect={vi.fn()}
        detecting
      />,
    );
    expect(screen.getByRole('button', { name: 'Đang dò…' })).toBeDisabled();
  });

  /** Không truyền onDetect thì không có nút — Studio chưa dùng tới nó. */
  it('không có onDetect thì không hiện nút', () => {
    render(
      <DeviceChips targets={targets} selected={[]} onToggle={vi.fn()} fallbackPlatform="android" />,
    );
    expect(screen.queryByRole('button', { name: /Kiểm tra máy|Đang dò/ })).toBeNull();
  });
});
