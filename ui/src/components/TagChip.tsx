import { useAppState } from '@/hooks/useAppState';
import { cn } from '@/lib/utils';

/**
 * Màu theo NHÓM tag, không theo từng tag.
 *
 * Mục đích là quét bằng mắt: ưu tiên là một chuyện, nền tảng là chuyện khác, và
 * một bảng ba mươi kịch bản toàn chip xám như nhau thì không đọc được gì. Bốn
 * nhóm bốn tông, tag lạ thì trung tính.
 */
const CATEGORY: Record<string, string> = {
  priority: 'bg-status-fail/10 text-status-fail',
  suite: 'bg-status-running/10 text-status-running',
  type: 'bg-status-pass/10 text-status-pass',
  platform: 'bg-status-flaky/10 text-status-flaky',
  operation: 'bg-muted text-muted-foreground',
};

/**
 * Một tag của kịch bản, kèm nghĩa của nó.
 *
 * `@p0` không tự giải thích được nó là gì. Hệ thống đã có sẵn nhãn và mô tả
 * tiếng Việt cho từng tag trong tagTaxonomy — "P0 · Luồng trọng yếu", "Happy
 * path hoặc mục tiêu nghiệp vụ quan trọng nhất" — nhưng cả bản cũ lẫn bản React
 * đều chỉ in ra chuỗi thô, và dùng taxonomy duy nhất cho việc gợi ý lúc sửa tag.
 * Người đọc bảng không có cách nào biết `@p0` khác `@p1` ở chỗ nào.
 */
export function TagChip({ tag, className }: { tag: string; className?: string }) {
  const taxonomy = useAppState((s) => s.tagTaxonomy);
  // Alias được quy về tên chuẩn trước khi tra, vì cùng một ý nghĩa có thể được
  // viết bằng nhiều tên trong các file feature cũ.
  const canonical = taxonomy.data?.aliases?.[tag] ?? tag;
  const def = taxonomy.data?.definitions?.find((item) => item.name === canonical);

  return (
    <span
      // Tag lạ vẫn hiện, chỉ là không có nghĩa kèm theo: giấu nó đi thì người
      // viết feature không bao giờ biết mình vừa gõ sai một cái tên.
      title={def ? `${def.label} — ${def.description}` : `${tag} (không có trong danh mục tag)`}
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        def ? (CATEGORY[def.category] ?? CATEGORY.operation) : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {tag}
    </span>
  );
}
