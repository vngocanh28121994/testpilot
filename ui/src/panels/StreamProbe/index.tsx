import { useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStreamJob } from '@/hooks/useStreamJob';
import { useJobStore } from '@/stores/jobStore';
import { STREAM_ROUTES } from '@/api/routes';

/**
 * Bàn thử của tầng stream — CHỈ chạy ở dev.
 *
 * Tồn tại để nghiệm thu R3 (proxy không buffer) và R10 (job sống sót qua điều
 * hướng) bằng thao tác thật, trước khi Phase 4 dựng Local Runner. Khi trang
 * Local Runner (Phase 4 #7) hoàn thành, xoá panel này và route của nó.
 */
export default function StreamProbePanel() {
  const job = useStreamJob('probe', STREAM_ROUTES.prereqAppium);

  // Chỉ ở dev: cho phép lái store từ bên ngoài để test R10 có tính xác định.
  // Không lọt vào bản build production — import.meta.env.DEV là hằng lúc build.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __jobStore?: unknown }).__jobStore = useJobStore;
    }
  }, []);

  return (
    <AppShell title="Stream probe (dev)" description="Nghiệm thu luồng log trực tiếp trong môi trường phát triển.">
      <section className="max-w-4xl space-y-6" aria-label="Stream probe">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Điều khiển probe</CardTitle>
            <CardDescription>Chạy hoặc dừng tác vụ kiểm tra stream của Appium.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              data-testid="start"
              onClick={() => job.start()}
            >
              Bắt đầu
            </Button>
            <Button
              type="button"
              data-testid="abort"
              variant="outline"
              onClick={job.abort}
            >
              Dừng
            </Button>
            <p className="text-muted-foreground text-sm">
              Trạng thái: <b data-testid="status" className="text-foreground">{job.status}</b> · số dòng log:{' '}
              <b data-testid="count" className="text-foreground">{job.logs.length}</b>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log trực tiếp</CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              data-testid="log"
              className="border-border bg-muted max-h-96 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap"
            >
              {job.logs.join('\n')}
            </pre>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
