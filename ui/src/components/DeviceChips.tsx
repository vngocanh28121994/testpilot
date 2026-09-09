import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Chọn máy để chạy — nhiều máy một lúc.
 *
 * v2 trước đây chỉ có radio chọn MỘT máy, và Local Runner luôn gửi đúng một
 * phần tử trong `devices`. Nghĩa là giao diện không có cách nào khởi động một
 * lượt chạy song song, dù server đã làm được từ lâu: `picked.length > 1` là rẽ
 * sang run-parallel.ts, một tiến trình con cho mỗi máy.
 *
 * Chip chứ không phải danh sách chọn: mục đích là nhìn thấy ngay những máy nào
 * đang nằm trên bàn, và thấy được cả những máy có trong config mà chưa cắm —
 * một dropdown giấu đúng thứ cần nhìn.
 */

export interface DeviceTarget {
  platform: 'android' | 'ios';
  id: string;
  deviceName?: string;
  udid?: string;
  /**
   * Tên máy đọc được — "iPhone 12 Pro Max", "Galaxy S23 Ultra".
   *
   * Chỉ có sau khi dò, vì nó đến từ chính cái máy. Mã máy trong config
   * ("sm-s918b") không nói lên đó là máy nào trên bàn, mà `deviceName` cũng
   * không cứu được: nó hoặc là cùng mã đó viết hoa, hoặc là tên ai đó tự gõ
   * vào phần Cài đặt của máy.
   */
  friendlyName?: string;
  /**
   * Máy có đang cắm không — `undefined` khi CHƯA BIẾT.
   *
   * Preflight chỉ dò nền tảng đang chọn, nên tình trạng của nền tảng còn lại là
   * chưa biết chứ không phải "chưa cắm". Vẽ một chấm xám ở đó là khẳng định một
   * điều chưa hề kiểm tra.
   */
  attached?: boolean;
}

export const deviceToken = (t: DeviceTarget) => `${t.platform}:${t.id}`;

/**
 * Lựa chọn hiện tại có nghĩa gì.
 *
 * Không có dòng này thì "tích hai máy" và "tích một máy" trông giống hệt nhau,
 * trong khi một bên chạy song song và một bên chạy tuần tự — khác nhau cả về
 * thời gian lẫn về việc kết quả được gộp ra sao.
 */
export function selectionHint(tokens: string[], fallbackPlatform: string): string {
  if (tokens.length === 0) return `Chưa chọn — chạy ${fallbackPlatform} như bình thường.`;
  if (tokens.length === 1) return '1 máy — chạy tuần tự.';
  const platforms = [...new Set(tokens.map((t) => t.split(':')[0]))];
  return platforms.length > 1
    ? `${tokens.length} máy trên ${platforms.join(' + ')} — chạy song song.`
    : `${tokens.length} máy — chạy song song, gộp kết quả sau khi xong.`;
}

/** Khớp theo id, tên máy hoặc udid — ba thứ người ta thật sự gõ để tìm. */
export function matchesQuery(target: DeviceTarget, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [target.id, target.friendlyName, target.deviceName, target.udid]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(q));
}

export function DeviceChips({
  targets,
  selected,
  onToggle,
  fallbackPlatform,
  onDetect,
  detecting,
}: {
  targets: DeviceTarget[];
  selected: string[];
  onToggle: (token: string) => void;
  fallbackPlatform: string;
  /** Dò lại xem máy nào đang cắm, cho CẢ hai nền tảng. */
  onDetect?: () => void;
  detecting?: boolean;
}) {
  const [query, setQuery] = useState('');
  if (targets.length === 0) return null;

  // Máy ĐANG CHỌN không bao giờ bị lọc mất. Gõ tìm rồi thấy lựa chọn biến mất
  // là mất luôn cách bỏ chọn nó, và dòng tổng kết bên dưới thành khó hiểu.
  const visible = targets.filter(
    (t) => matchesQuery(t, query) || selected.includes(deviceToken(t)),
  );
  const groups = (['android', 'ios'] as const)
    .map((platform) => [platform, visible.filter((t) => t.platform === platform)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Chạy trên máy</span>
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm máy…"
            aria-label="Tìm thiết bị"
            className="h-8 w-36 text-xs"
          />
          {/* Nút nằm ngay cạnh thứ nó thay đổi. Để nó ở khu công cụ phía dưới
              thì bấm xong ticks đổi ở một chỗ người đọc không nhìn tới. */}
          {onDetect && (
            <Button size="sm" variant="outline" disabled={detecting} onClick={onDetect}>
              {detecting ? 'Đang dò…' : 'Kiểm tra máy đang cắm'}
            </Button>
          )}
        </div>
      </div>
      {groups.length === 0 && (
        <span className="text-muted-foreground text-xs">Không có thiết bị nào khớp.</span>
      )}
      {groups.map(([platform, list]) => (
        <div key={platform} className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
          <span className="text-muted-foreground w-14 shrink-0 text-[11px] tracking-wide uppercase">
            {platform}
          </span>
          {list.map((target) => {
            const token = deviceToken(target);
            const on = selected.includes(token);
            return (
              <button
                key={token}
                type="button"
                aria-pressed={on}
                // Mọi thứ khác về máy nằm ở tooltip: một chip hai dòng chỉ lặp
                // lại cùng một mã máy ở dạng viết khác.
                // Mã máy và udid lùi vào tooltip: chúng cần khi đi đối chiếu,
                // không cần khi đang tìm xem máy nào là máy nào.
                title={[target.id, target.deviceName, target.udid].filter(Boolean).join(' · ')}
                onClick={() => onToggle(token)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs',
                  on ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-muted/50',
                )}
              >
                {/* Chấm chỉ nói MỘT điều: máy có đang cắm không — và chỉ vẽ
                    khi đã thật sự biết. Không có chấm nghĩa là chưa dò. */}
                {target.attached !== undefined && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 rounded-full',
                      target.attached ? 'bg-status-pass' : 'bg-muted-foreground/40',
                    )}
                  />
                )}
                {target.friendlyName ?? target.id}
              </button>
            );
          })}
        </div>
      ))}
      <span className="text-muted-foreground text-xs">{selectionHint(selected, fallbackPlatform)}</span>
    </div>
  );
}
