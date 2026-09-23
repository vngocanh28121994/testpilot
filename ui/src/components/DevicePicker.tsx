import type { DeviceCandidate } from '@core/ui/contracts.js';
import { groupByMachine, type OnSomeMachine } from '@/lib/deviceGroups';

/**
 * Chạy trên máy nào.
 *
 * Radio chứ không phải dropdown: chỉ có hai ba máy, và mục đích là nhìn thấy
 * ngay những máy nào đang nằm trên bàn. Chọn xong là dò lại, nên kết luận ở
 * trên đổi từ đỏ sang xanh ngay lập tức thay vì chờ một cú lưu mà không ai biết
 * là phải bấm.
 *
 * Dùng chung cho Studio và Local Runner: hai chỗ hỏi cùng một câu, và để chúng
 * trôi ra hai lối hỏi khác nhau là cách chắc chắn để một bên có ô chọn còn bên
 * kia bị chặn cứng mà không ai để ý.
 */
export function DevicePicker({
  name,
  candidates,
  chosen,
  onPick,
}: {
  /** Tên nhóm radio; phải khác nhau giữa các nền tảng cùng hiện một lúc. */
  name: string;
  candidates: Array<DeviceCandidate & OnSomeMachine>;
  chosen?: string;
  onPick: (id: string) => void;
}) {
  return (
    <fieldset className="mt-1 flex flex-col gap-2">
      <legend className="text-xs font-medium">Chạy trên máy</legend>
      {/* Gom theo MÁY TÍNH, cùng một phép gom với ô chip ở Local Runner. Hai
          màn hỏi cùng một câu, nên chúng phải hỏi bằng cùng một hình dạng —
          và nhóm chỉ hiện khi có từ hai máy tính trở lên, vì một tiêu đề nhóm
          cho một nhóm duy nhất là một dòng chữ không nói thêm gì. */}
      {groupByMachine(candidates).map(({ key, title, mine, list }, _i, groups) => (
        <div key={key} className="flex flex-col gap-1">
          {groups.length > 1 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
                {title}
              </span>
              {mine && (
                <span className="border-border text-muted-foreground rounded border px-1 text-[10px]">
                  máy của bạn
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {list.map((candidate) => (
              <label key={candidate.id} className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  className="accent-primary size-4"
                  name={`pfDevice-${name}`}
                  value={candidate.id}
                  checked={chosen === candidate.id}
                  onChange={() => onPick(candidate.id)}
                />
                <span>{candidate.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
