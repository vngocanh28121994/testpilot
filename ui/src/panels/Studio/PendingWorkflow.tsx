import { Link } from '@tanstack/react-router';
import { FileCheck2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBanner } from '@/components/StatusBanner';
import { WorkflowCompletion } from '@/components/WorkflowCompletion';
import { useRecentRuns } from '@/hooks/useAppState';

/**
 * Workflow đang chờ người, hiện ngay tại chỗ đã khởi động nó.
 *
 * Workflow là MỘT việc liền mạch: khởi động ở đây, dừng lại chờ duyệt, rồi chạy
 * tiếp. Trước đây Studio không nói gì về lần dừng đó, nên sau khi log sinh kịch
 * bản chạy hết, màn hình chỉ còn một khung log đã chết — người dùng không biết
 * mình đã xong hay còn phải làm gì, và cái nút cần bấm thì nằm ở màn khác.
 *
 * Đây là LỐI VÀO, không phải bản thứ hai của cổng duyệt: nó đọc cùng một nguồn
 * (lượt chạy đang chờ trong state) và không tự quyết gì cả.
 */
export function PendingWorkflow() {
  const runs = useRecentRuns();
  const run = (runs.data ?? []).find(
    (item) => item.status === 'waiting_review' || item.status === 'waiting_input',
  );

  // Đang chạy tiếp thì phần tiến trình tự lo; không có gì chờ thì không nói gì.
  if (!run) return <WorkflowCompletion />;

  const reviewing = run.status === 'waiting_review';
  const count = run.generated?.scenarios;

  return (
    <div className="flex flex-col gap-3">
      <StatusBanner
        tone="warn"
        title={reviewing ? 'Kịch bản chờ duyệt' : 'Workflow đang chờ bạn trả lời'}
        detail={
          reviewing
            ? `${count ?? ''} kịch bản vừa sinh xong. Duyệt hoặc chỉnh sửa rồi cho chạy tiếp.`.trim()
            : 'Có câu hỏi cần trả lời trước khi workflow chạy tiếp.'
        }
        actions={
          <Button asChild size="sm">
            {/*
              Lọc sẵn theo đúng file vừa sinh.
              Màn Kịch bản liệt kê MỌI kịch bản của mọi feature — hàng chục cái
              đã duyệt từ trước. Mở ra mà không lọc thì tám kịch bản mới nằm lẫn
              trong đó, và người duyệt phải tự tìm xem cái nào là cái vừa sinh.
            */}
            <Link to="/scenarios" search={{ file: run.generatedFile, status: 'pending' }}>
              <FileCheck2 className="size-4" />
              {reviewing ? 'Mở màn duyệt để xem/sửa' : 'Mở màn duyệt để trả lời'}
            </Link>
          </Button>
        }
      />
      <WorkflowCompletion />
    </div>
  );
}
