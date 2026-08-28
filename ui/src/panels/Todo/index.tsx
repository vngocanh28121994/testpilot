import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <AppShell title={label} description={item?.why}>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
          <CardDescription>Hạng mục này đang được chuẩn bị trong lộ trình TestPilot.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Chưa có dữ liệu hoặc thao tác khả dụng cho mục này.
        </CardContent>
      </Card>
    </AppShell>
  );
}
