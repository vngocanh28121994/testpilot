import { X } from 'lucide-react';

/**
 * Một điều kiện đang có hiệu lực, bỏ được bằng một cú bấm.
 *
 * Bỏ từng cái một quan trọng hơn vẻ ngoài của nó: khi bảng trống, thứ người
 * dùng cần không phải là "xoá hết bộ lọc" mà là "bỏ đúng cái đang siết quá
 * chặt" — và để làm được thế thì trước hết phải nhìn thấy có những cái gì.
 */
export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li>
      <span className="bg-muted/60 inline-flex items-center gap-1 rounded-full border py-0.5 pe-1 ps-2.5 text-xs">
        <span className="max-w-60 truncate">{label}</span>
        <button
          type="button"
          aria-label={`Bỏ lọc ${label}`}
          className="hover:bg-muted-foreground/20 rounded-full p-0.5"
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      </span>
    </li>
  );
}
