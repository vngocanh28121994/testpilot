import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStreamJob } from '@/hooks/useStreamJob';
import { STREAM_ROUTES } from '@/api/routes';
import type { PreflightCheck } from '@core/ui/contracts.js';

/**
 * Danh sách kết quả kiểm tra môi trường, dùng chung cho Studio và Local Runner.
 *
 * Trước đây hai trang tự vẽ hai kiểu cho cùng một dữ liệu: một bên ✓/✗ bằng ký
 * tự, một bên bằng icon; chữ và khoảng cách cũng khác nhau. Cùng một câu trả lời
 * từ cùng một endpoint mà trông như hai thứ khác nhau.
 */
export function PreflightChecks({ checks }: { checks: PreflightCheck[] }) {
  return (
    <ul className="flex flex-col divide-y">
      {checks.map((check) => (
        <li key={check.name} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
          {check.ok ? (
            <CheckCircle2 className="text-status-pass mt-0.5 size-4 shrink-0" />
          ) : (
            <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />
          )}
          <div className="flex min-w-0 flex-col items-start gap-1.5">
            <span className="text-sm">
              <b>{check.name}:</b> {check.detail}
            </span>
            {!check.ok && check.fix === 'appium' && <StartAppium />}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Bật Appium ngay tại chỗ báo là nó chưa chạy.
 *
 * Công cụ này bật được Appium — nó có sẵn endpoint làm đúng việc đó. Bảo người
 * dùng đi mở một terminal khác là đẩy sang cho họ một việc mà mình làm được,
 * ngay tại màn hình đã biết chính xác thứ đang thiếu là gì.
 */
function StartAppium() {
  const job = useStreamJob('preflight-appium', STREAM_ROUTES.prereqAppium);
  const client = useQueryClient();

  // Bật xong thì dò lại, để dòng đỏ ở trên tự chuyển sang xanh — chứ không bắt
  // người dùng đoán xem đã xong chưa rồi tự bấm "Kiểm tra lại".
  useEffect(() => {
    if (job.status === 'done') void client.invalidateQueries({ queryKey: ['preflight'] });
  }, [job.status, client]);

  const running = job.status === 'running';

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button size="sm" variant="outline" disabled={running} onClick={() => job.start()}>
        <Play className="size-4" />
        {running ? 'Đang khởi động Appium…' : 'Khởi động Appium'}
      </Button>
      {/* Dòng log cuối, không phải cả khối log: đủ để biết nó đang tới đâu mà
          không biến một dòng kiểm tra thành một cửa sổ terminal. */}
      {job.status === 'error' && (
        <span className="text-destructive text-xs">{job.error ?? 'Không khởi động được Appium.'}</span>
      )}
      {running && job.logs.length > 0 && (
        <span className="text-muted-foreground text-xs">{job.logs[job.logs.length - 1]}</span>
      )}
    </div>
  );
}
