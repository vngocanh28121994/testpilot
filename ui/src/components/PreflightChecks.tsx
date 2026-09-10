import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, Settings, Terminal, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStreamJob } from '@/hooks/useStreamJob';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { IOS_TUNNEL_COMMAND } from '@/lib/tunnel';
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
            <span className="text-sm whitespace-pre-line">
              <b>{check.name}:</b> {check.detail}
            </span>
            {!check.ok && check.fix === 'appium' && <StartAppium />}
            {!check.ok && check.fix === 'ios-tunnel' && <StartIosTunnel />}
            {!check.ok && check.fix === 'ios-trust' && <OpenIosSettings />}
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

/**
 * Mở Terminal với lệnh dựng tunnel đã điền sẵn.
 *
 * Gắn vào chính dòng kiểm tra, không phải vào một màn hình cụ thể: trước đây nút
 * này chỉ có ở Local Runner, nên workflow nói đúng lý do dừng nhưng không cho
 * người dùng chỗ nào để chữa — phải nhớ ra là mở sang màn khác.
 *
 * Không hỏi mật khẩu ở đây, và đó là chủ đích: xem chú thích ở
 * openTunnelTerminal() trong src/ui/server.ts.
 */
function StartIosTunnel() {
  const client = useQueryClient();
  const [copied, setCopied] = useState(false);
  const open = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(ROUTES.prereqIosTunnel),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? 'Không mở được Terminal.');
        return;
      }
      toast.success('Đã mở Terminal. Nhập mật khẩu máy ở cửa sổ đó, rồi bấm “Kiểm tra lại”.');
      // Không tự chuyển xanh được: tunnel chỉ chạy sau khi người dùng gõ mật
      // khẩu, mà chuyện đó xảy ra ngoài tầm nhìn của tool. Dò lại một lượt để
      // ai gõ nhanh thì thấy ngay, còn lại thì nút "Kiểm tra lại" lo nốt.
      void client.invalidateQueries({ queryKey: ['preflight'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={open.isPending} onClick={() => open.mutate()}>
        <Terminal className="size-4" />
        {open.isPending ? 'Đang mở Terminal…' : 'Mở Terminal và chạy'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard
            .writeText(IOS_TUNNEL_COMMAND)
            .then(() => {
              setCopied(true);
              toast.success('Đã chép lệnh.');
            })
            .catch(() => toast.error('Trình duyệt không cho chép. Bạn chép tay giúp nhé.'));
        }}
      >
        {copied ? 'Đã chép' : 'Chép lệnh'}
      </Button>
    </div>
  );
}

/**
 * Mở sẵn Cài đặt trên chiếc iPhone đang cắm, cho bước tin cậy chứng chỉ.
 *
 * Nút này không tự chữa được — nút Tin cậy nằm trên máy và chỉ ngón tay người
 * dùng bấm được. Nó rút ngắn phần làm hộ được: cầm máy lên là đã ở Cài đặt.
 */
function OpenIosSettings() {
  const client = useQueryClient();
  const open = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(ROUTES.prereqIosTrust),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error ?? 'Không mở được Cài đặt trên máy.');
        return;
      }
      toast.success('Đã mở Cài đặt trên máy. Bấm Tin cậy xong thì dò lại giúp nhé.');
      void client.invalidateQueries({ queryKey: ['preflight'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Button size="sm" variant="outline" disabled={open.isPending} onClick={() => open.mutate()}>
      <Settings className="size-4" />
      {open.isPending ? 'Đang mở Cài đặt…' : 'Mở Cài đặt trên máy'}
    </Button>
  );
}
