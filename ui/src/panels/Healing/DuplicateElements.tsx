import { useState } from 'react';
import type { DuplicateElementView } from '@core/ui/contracts.js';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useReviewDuplicate } from './hooks/useHealing';

/**
 * Element trùng vai — hai bản ghi registry cùng mô tả một control.
 *
 * Ở đây chứ không phải trong log của `run`, vì đây là phát hiện BẢO TRÌ chứ
 * không phải thông tin của một lượt chạy: nó không đổi giữa hai lượt, và in
 * lại mỗi lần là cách nhanh nhất để người ta ngừng đọc. Quan trọng hơn, chỗ
 * này có thứ mà một dòng cảnh báo không có — một quyết định được ghi nhớ, nên
 * danh sách về được 0.
 *
 * Bảng chứ không phải danh sách thẻ: số cặp tăng theo số feature được soạn,
 * và mười cặp dưới dạng thẻ thì đẩy mọi thứ khác ra khỏi màn hình. Bảng cũng
 * cho so sánh theo cột — tỉ lệ lịch sử của các cặp nằm thẳng hàng, nên cặp
 * đáng ngờ tự lộ ra mà không phải đọc từng thẻ.
 */
const HEADERS = ['Bản ghi gốc', 'Bản ghi trùng', 'Locator cả hai cùng thắng', 'Lịch sử', ''];

export function DuplicateElements({ items }: { items: DuplicateElementView[] }) {
  const review = useReviewDuplicate();
  /**
   * Xác nhận hai bước cho "dùng chung locator", giống nút Áp dụng của bảng
   * healing và vì đúng một lý do: nó ghi thẳng vào element registry và không
   * có nút hoàn tác. Một cú bấm nhầm không được phép đủ để gây hậu quả.
   *
   * "Không phải trùng" thì không: nó chỉ ghi một quyết định vào sổ duyệt, và
   * bấm nhầm thì sửa bằng cách xoá dòng ấy trong duplicate-review.json.
   */
  const [confirming, setConfirming] = useState<string | undefined>();

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        Không có cặp nào đang chờ. Cặp đã quyết định sẽ không hiện lại.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {HEADERS.map((header, index) => (
            <TableHead key={header || `actions-${index}`} className="whitespace-nowrap">
              {header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => {
          const key = `${item.strong.id}::${item.weak.id}`;
          return (
            <TableRow key={key}>
              <ElementCell side={item.strong} />
              <ElementCell side={item.weak} />
              <TableCell className="max-w-[18rem] align-top">
                <code className="block truncate font-mono text-xs" title={item.sharedLocator}>
                  {item.sharedLocator}
                </code>
              </TableCell>
              {/* Hai tỉ lệ cạnh nhau, vì đó là con số người duyệt so sánh:
                  100% với 100% là một control, còn 40% với 100% thì đáng ngờ
                  và cần nhìn kỹ trước khi bấm. */}
              <TableCell className="align-top text-xs tabular-nums whitespace-nowrap">
                {Math.round(item.share[0] * 100)}% / {Math.round(item.share[1] * 100)}%
              </TableCell>
              <TableCell className="align-top text-right">
                <div className="flex justify-end gap-1">
                  {/* Bấm một nút không đổi gì là cách nhanh nhất làm người ta
                      mất tin vào nút. */}
                  <Button
                    size="sm"
                    disabled={review.isPending || item.weakAlreadyHasIt}
                    title={item.weakAlreadyHasIt
                      ? 'Locator này đã là candidate được duyệt ở element kia — không còn gì để mang sang.'
                      : `Đưa ${item.sharedLocator} lên primary đã duyệt cho ${item.weak.id}. Không xoá bản ghi nào.`}
                    onClick={() => {
                      if (confirming !== key) {
                        setConfirming(key);
                        return;
                      }
                      setConfirming(undefined);
                      review.mutate({ strong: item.strong.id, weak: item.weak.id, action: 'merge' });
                    }}
                  >
                    {confirming === key ? 'Xác nhận dùng chung' : 'Dùng chung locator'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() => review.mutate({
                      strong: item.strong.id,
                      weak: item.weak.id,
                      action: 'distinct',
                    })}
                  >
                    Không phải trùng
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Tên nghiệp vụ ở trên, id ở dưới — cùng cách bảng healing trình bày element. */
function ElementCell({ side }: { side: DuplicateElementView['strong'] }) {
  return (
    <TableCell className="max-w-[14rem] align-top">
      <span className="block truncate text-sm font-medium" title={side.label}>
        {side.label}
      </span>
      <code className="text-muted-foreground block truncate font-mono text-xs" title={side.id}>
        {side.id}
      </code>
      <span className="text-muted-foreground text-xs tabular-nums">
        {side.wins} lần thắng
      </span>
    </TableCell>
  );
}
