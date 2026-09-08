import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { LogView } from '@/components/LogView';
import { StatusBanner } from '@/components/StatusBanner';
import { WorkflowStages } from '@/components/WorkflowStages';
import { useStreamJob } from '@/hooks/useStreamJob';
import { STREAM_ROUTES } from '@/api/routes';

/**
 * Id của luồng "chạy tiếp sau khi duyệt".
 *
 * Cố ý là một hằng dùng chung: job store khoá theo id, nên hai màn hình cùng
 * gọi đúng chuỗi này sẽ nhìn thấy CÙNG một luồng — không phải hai luồng song
 * song, cũng không phải một bản sao chép trạng thái.
 */
export const WORKFLOW_COMPLETE_JOB = 'workflow-complete';

export function useWorkflowCompletion() {
  return useStreamJob(WORKFLOW_COMPLETE_JOB, STREAM_ROUTES.workflowComplete);
}

/**
 * Tiến trình và kết cục của lượt chạy sau khi duyệt.
 *
 * Dùng ở cả màn duyệt lẫn App Studio. Trước đây chỉ màn duyệt có, nên bấm
 * "Hoàn thành kịch bản" rồi quay về Studio là thấy một khung log đã chết từ
 * bước sinh kịch bản, trong khi test đang chạy thật.
 */
export function WorkflowCompletion({ label = 'Log chạy test' }: { label?: string }) {
  const job = useWorkflowCompletion();
  const client = useQueryClient();

  /**
   * Chạy xong thì làm mới state.
   *
   * Lượt chạy không còn ở trạng thái chờ nữa, nên mọi thứ dựa vào đó — cổng
   * duyệt, mục chờ duyệt ở Studio — phải tự biến mất thay vì nằm lại như thể
   * vẫn còn việc.
   */
  useEffect(() => {
    if (job.status === 'done' || job.status === 'error') {
      void client.invalidateQueries({ queryKey: ['state'] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.status]);

  if (job.status === 'idle' && job.logs.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {job.status === 'running' && (
        <StatusBanner tone="unknown" title="Đang chạy test" detail="Kịch bản đã duyệt đang chạy." />
      )}

      {job.status === 'done' && (
        <StatusBanner
          tone={job.run?.status === 'passed' ? 'pass' : 'warn'}
          title={
            job.run?.status === 'passed'
              ? 'Workflow đã hoàn tất'
              : 'Workflow hoàn tất nhưng có testcase fail'
          }
          detail="Report, ảnh và video đã sẵn sàng."
          actions={
            <Button asChild size="sm" variant="outline">
              <Link to="/runner/history" search={{ runId: undefined }}>
                Xem report
              </Link>
            </Button>
          }
        />
      )}

      {/* Hỏng giữa chừng cũng là một kết cục, và là kết cục cần chú ý nhất.
          Trước đây nhánh này không có băng nào: lỗi chỉ nằm ở dòng cuối khung
          log, đúng chỗ dễ trôi khỏi tầm mắt nhất. */}
      {job.status === 'error' && (
        <StatusBanner
          tone="fail"
          title="Workflow dừng giữa chừng"
          detail={job.error ?? 'Không rõ lý do — xem log bên dưới.'}
        />
      )}

      {/* Đang ở bước nào và còn mấy bước — hai câu người ta thật sự hỏi khi
          ngồi đợi, mà một khung log không trả lời được. */}
      {job.run && <WorkflowStages stages={job.run.stages} />}

      {job.logs.length > 0 && (
        <LogView logs={job.logs} dropped={job.dropped} error={job.error} label={label} />
      )}
    </div>
  );
}
