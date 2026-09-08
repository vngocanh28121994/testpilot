import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ReportAction } from '@/components/ReportAction';
import { StatusBanner } from '@/components/StatusBanner';
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
 * Kết cục của lượt chạy sau khi duyệt.
 *
 * Chỉ băng kết quả — log KHÔNG nằm ở đây. Log của lượt chạy tiếp phải nối vào
 * đuôi log sinh kịch bản thành một dòng chảy liên tục, chứ không phải một khối
 * thứ hai đặt cạnh: đó là cùng một workflow, và người đọc theo dõi nó theo thời
 * gian. Nơi duy nhất ghép được hai nguồn ấy là màn hình chứa cả hai.
 *
 * Dùng ở cả màn duyệt lẫn App Studio. Trước đây chỉ màn duyệt có, nên bấm
 * "Hoàn thành kịch bản" rồi quay về Studio là thấy một khung log đã chết từ
 * bước sinh kịch bản, trong khi test đang chạy thật.
 */
export function WorkflowCompletion() {
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
    <div
      className="flex flex-col gap-3"
      // Kéo kết cục vào tầm nhìn đúng lúc nó xuất hiện. Một lượt chạy dài vài
      // phút thì người ta không ngồi nhìn màn hình suốt, và khung log vừa cuộn
      // xuống đáy có thể đẩy băng này ra ngay dưới mép dưới.
      ref={(node) => {
        if (node && (job.status === 'done' || job.status === 'error')) {
          node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }}
    >
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
          actions={<ReportAction runDirs={job.run?.runDirs} />}
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

    </div>
  );
}
