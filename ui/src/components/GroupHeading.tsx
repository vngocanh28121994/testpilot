import type { ReactNode } from 'react';

/**
 * Tiêu đề + mô tả đứng trên một nhóm thẻ.
 *
 * Theo khuôn section của sen/frontend (`panels/Settings/index.tsx`): mỗi nhóm
 * thẻ mở đầu bằng một <h3> và một dòng muted nói nhóm đó làm gì, để người đọc
 * không phải suy ra quan hệ giữa các thẻ từ vị trí của chúng.
 */
export function GroupHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}
