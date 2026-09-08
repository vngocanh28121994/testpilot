import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

/**
 * Lối đi tới report của MỘT lượt chạy cụ thể.
 *
 * Hai điều dễ sai và đã sai:
 *
 * 1. Link không mang id thì trang chi tiết mở report MỚI NHẤT — mà "mới nhất"
 *    không nhất thiết là "vừa rồi". Người dùng bấm "Xem report" của lượt vừa
 *    chạy và nhận về một lượt khác, trông y như thật.
 * 2. Lượt chạy dừng trước lúc kịp ghi report thì `runDirs` rỗng. Không có gì để
 *    xem thì phải NÓI là không có, chứ không mời bấm rồi đưa đại một cái khác.
 */
export function ReportAction({ runDirs }: { runDirs?: string[] }) {
  const reportId = runDirs?.[0];
  if (!reportId) {
    return (
      <span className="text-muted-foreground text-xs">Lượt chạy này không sinh được report.</span>
    );
  }
  return (
    <Button asChild size="sm" variant="outline">
      <Link to="/runner/history" search={{ runId: reportId }}>
        Xem report
      </Link>
    </Button>
  );
}
