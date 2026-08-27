import type { ReactNode } from 'react';

/**
 * Ô nhập kèm nhãn và chú thích.
 *
 * Chú thích nằm NGOÀI <label>. Nhét vào trong thì tên khả truy cập của ô trở
 * thành "Gemini API keyĐang dùng Anthropic dự phòng…" — trình đọc màn hình đọc
 * cả câu đó mỗi lần focus, và getByLabelText cũng không tìm ra ô nữa.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        {children}
      </label>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

export const inputClass =
  'border-border bg-background w-full rounded-md border px-2 py-1.5 text-sm';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-border max-w-2xl rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-medium">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
