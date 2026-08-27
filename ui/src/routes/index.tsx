import { createFileRoute } from '@tanstack/react-router';

// Trang giữ chỗ của Phase 1. Phase 2 thay bằng layout thật (Header + Sidebar
// 14 mục + Main), Phase 4 thay tiếp bằng Dashboard.
export const Route = createFileRoute('/')({
  component: () => (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3">
      <h1 className="text-2xl font-semibold">TestPilot</h1>
      <p className="text-muted-foreground text-sm">
        Khung app mới đã chạy. Sidebar và các trang sẽ đến ở Phase 2–4.
      </p>
      <code className="text-muted-foreground rounded bg-muted px-2 py-1 text-xs">
        base = {import.meta.env.BASE_URL}
      </code>
    </main>
  ),
});
