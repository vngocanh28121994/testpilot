import { AppShell } from '@/components/layout/AppShell';
import { PLACEHOLDERS } from '@/lib/nav';

/**
 * Một panel phục vụ cả 6 mục NAV chưa nối.
 *
 * Giữ nguyên cách nói của bản cũ (index.html:1028): nói rõ mục này CÓ trong
 * thiết kế nhưng chưa có gì đứng sau nó, kèm lý do cụ thể. Một mục biến mất
 * mà không giải thích thì trông như tính năng bị mất.
 */
export default function TodoPanel({ slug }: { slug: string }) {
  const item = PLACEHOLDERS.get(slug);
  const label = item?.label ?? 'Mục này';

  return (
    <AppShell title={label}>
      <div className="border-border bg-card max-w-2xl rounded-lg border p-5">
        <p>
          <b>{label}</b> có trong design nhưng chưa có gì đứng sau nó trong TestPilot.
        </p>
        {item?.why && <p className="text-muted-foreground mt-2 text-sm">{item.why}</p>}
      </div>
    </AppShell>
  );
}
