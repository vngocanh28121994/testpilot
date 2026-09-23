import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { groupByMachine } from '@/lib/deviceGroups';

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
   * Tên thương mại thật, do chính máy khai — "iPhone 12 Pro Max".
   *
   * Chỉ iOS có sẵn (qua devicectl). Android hầu như không khai, nên ở đó
   * `deviceName` trong config là thứ đọc được nhất.
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
  /**
   * Tên chiếc MÁY TÍNH nó cắm vào.
   *
   * Từ lúc có runner cá nhân, "SM_S918B" một mình không nói được nó nằm ở
   * laptop của ai hay ở phòng máy — mà đó là câu người dùng phải trả lời trước
   * khi bấm chạy: chiếc ở bàn mình thì cắm rút tuỳ ý, chiếc ở phòng máy thì
   * người khác cũng đang dùng.
   */
  runnerName?: string;
  /** Máy cắm ở chính máy tính của người đang xem. */
  mine?: boolean;
}

export const deviceToken = (t: DeviceTarget) => `${t.platform}:${t.id}`;

/**
 * Chữ trên chip.
 *
 * Tên thương mại thật thắng, vì chỉ nó mới nói được "máy nào" — nhưng chỉ iOS
 * có. Android quay về `deviceName` trong config: nó ngắn, ổn định, và do đội
 * đặt, khác hẳn tên máy tự đặt vốn là bất cứ thứ gì người cầm máy đã gõ.
 */
export function chipLabel(target: DeviceTarget): string {
  return target.friendlyName ?? target.deviceName ?? target.id;
}

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
  const groups = groupByMachine(visible);

  return (
    <div className="border-border flex flex-col gap-2.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium whitespace-nowrap">Chạy trên máy</span>
        <div className="ms-auto flex items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm máy…"
            aria-label="Tìm thiết bị"
            className="h-8 w-32 text-xs"
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
      {/* Vùng chip cuộn RIÊNG, không đẩy dài cả thẻ.
          Một phòng máy cắm hai ba chục chiếc thì danh sách phẳng đẩy nút "Chạy
          test" và phần preflight xuống dưới màn hình — tức là để chọn máy thì
          phải cuộn, rồi để chạy lại phải cuộn ngược lên. Ô tìm kiếm ở trên nằm
          NGOÀI vùng cuộn, vì nó là thứ đầu tiên người ta với tới khi danh sách
          dài. */}
      <div className="flex max-h-52 flex-col gap-2.5 overflow-y-auto">
      {groups.map(({ key, title, mine, list }) => (
        // Tiêu đề đứng RIÊNG một dòng, không phải một cột hẹp bên trái: tên máy
        // tính là thứ người ta tự đặt, và "MacBook-Air-cua-Tuoi.local" vỡ thành
        // ba dòng trong một cột hẹp.
        <div key={key} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
              {title}
            </span>
            {/* Nhãn chứ không dựa vào tên: tên máy do người dùng đặt, và
                "laptop của Bình" không nói cho Bình biết đó là máy của mình. */}
            {mine && (
              <span className="border-border text-muted-foreground rounded border px-1 text-[10px]">
                máy của bạn
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
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
                  'flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px]',
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
                {chipLabel(target)}
                {/* Nền tảng lùi xuống thành nhãn nhỏ trên chip, vì nhóm ngoài
                    giờ trả lời câu khác — máy này nằm ở đâu. */}
                <span className="text-muted-foreground text-[10px] uppercase">
                  {target.platform}
                </span>
              </button>
            );
          })}
          </div>
        </div>
      ))}
      </div>
      <span className="text-muted-foreground text-xs">{selectionHint(selected, fallbackPlatform)}</span>
    </div>
  );
}
