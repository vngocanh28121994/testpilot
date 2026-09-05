import type { DeviceCandidate } from '@core/ui/contracts.js';

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
  candidates: DeviceCandidate[];
  chosen?: string;
  onPick: (id: string) => void;
}) {
  return (
    <fieldset className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
      <legend className="text-xs font-medium">Chạy trên máy</legend>
      {candidates.map((candidate) => (
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
    </fieldset>
  );
}
