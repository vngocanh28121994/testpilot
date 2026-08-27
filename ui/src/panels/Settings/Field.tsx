import type { ReactNode } from 'react';

/**
 * Ô nhập kèm nhãn và chú thích.
 *
 * Chú thích nằm NGOÀI <label>. Nhét vào trong thì tên khả truy cập của ô trở
 * thành "Gemini API keyĐang dùng Anthropic dự phòng…" — trình đọc màn hình đọc
 * cả câu đó mỗi lần focus, và getByLabelText cũng không tìm ra ô nữa.
 *
 * Dùng <label> bọc thay vì <Label htmlFor>: liên kết ngầm không cần id, mà
 * mọi ô ở trang này đều là ô đơn nên không mất gì.
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
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm leading-none font-medium select-none">{label}</span>
        {children}
      </label>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card text-card-foreground max-w-2xl rounded-xl border p-6 shadow-sm">
      <h2 className="mb-4 font-medium">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
