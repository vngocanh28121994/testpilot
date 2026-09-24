import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Play, Settings, Terminal, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStreamJob } from '@/hooks/useStreamJob';
import { STREAM_ROUTES } from '@/api/routes';
import { IOS_TUNNEL_COMMAND } from '@/lib/tunnel';
import type { PreflightCheck } from '@core/ui/contracts.js';

/**
 * Danh sách kết quả kiểm tra môi trường, dùng chung cho Studio và Local Runner.
 *
 * Trước đây hai trang tự vẽ hai kiểu cho cùng một dữ liệu: một bên ✓/✗ bằng ký
 * tự, một bên bằng icon; chữ và khoảng cách cũng khác nhau. Cùng một câu trả lời
 * từ cùng một endpoint mà trông như hai thứ khác nhau.
 */
/**
 * Máy nào sẽ làm các nút "sửa" — chiếc đang cắm thiết bị.
 *
 * Trước đây các nút luôn gọi vào máy chủ: ngồi ở laptop có iPhone cắm vào mà
 * bấm "Mở Terminal" thì Terminal bật lên ở máy chủ, phòng khác. Giờ máy chủ
 * tự chọn đúng máy (xem `POST /api/prereq/fix`), và màn hình nói trước là máy
 * nào để không ai phải đoán.
 */
export interface FixTarget {
  platform?: string;
  /** Id hoặc udid của thiết bị đang kiểm. */
  device?: string;
  host?: { name: string; remote: boolean; tunnelService?: boolean };
}

export function PreflightChecks({ checks, target }: { checks: PreflightCheck[]; target?: FixTarget }) {
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
            {!check.ok && check.fix === 'appium' && <FixButton op="start_appium" target={target} />}
            {!check.ok && check.fix === 'ios-tunnel' && <StartIosTunnel target={target} />}
            {!check.ok && check.fix === 'ios-trust' && <FixButton op="ios_trust" target={target} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

type FixOp = 'start_appium' | 'ios_tunnel' | 'ios_trust';

const FIX_TEXT: Record<FixOp, { idle: string; busy: string; done: string; Icon: typeof Play }> = {
  start_appium: {
    idle: 'Khởi động Appium', busy: 'Đang khởi động Appium…',
    done: 'Appium đã chạy.', Icon: Play,
  },
  ios_tunnel: {
    idle: 'Mở Terminal và chạy', busy: 'Đang mở Terminal…',
    done: 'Đã mở Terminal. Nhập mật khẩu máy ở cửa sổ đó, rồi dò lại môi trường ở trên.', Icon: Terminal,
  },
  ios_trust: {
    idle: 'Mở Cài đặt trên máy', busy: 'Đang mở Cài đặt…',
    done: 'Đã mở Cài đặt trên máy. Bấm Tin cậy xong thì dò lại giúp nhé.', Icon: Settings,
  },
};

/** Máy chủ chưa cài dịch vụ tunnel: nói thẳng việc admin làm MỘT lần. */
const TUNNEL_SERVICE_HINT = 'sudo bash scripts/install-ios-tunnel-service.sh';

/**
 * Chữ của nút tunnel theo tình huống THẬT của máy đang cắm iPhone.
 *
 * Máy có dịch vụ tunnel: không ai phải gõ mật khẩu — kể cả khi mọi người làm
 * việc từ xa. Máy chủ chưa có: bấm là mở Terminal ở máy chủ, nơi thường không
 * có ai; nói ra điều đó và cách để không bao giờ phải làm thế nữa.
 */
function tunnelText(host?: FixTarget['host']): { idle: string; note?: string; done: string } {
  if (host?.tunnelService) {
    return {
      idle: 'Khởi động lại tunnel',
      note: `Tunnel trên ${host.name} chạy như dịch vụ — khởi động lại được, không cần mật khẩu.`,
      done: 'Đã khởi động lại tunnel. Dò lại môi trường ở trên sau vài giây.',
    };
  }
  const done = 'Đã mở Terminal. Nhập mật khẩu máy ở cửa sổ đó, rồi dò lại môi trường ở trên.';
  if (!host) return { idle: 'Mở Terminal và chạy', done };
  if (host.remote) {
    return {
      idle: 'Mở Terminal và chạy',
      note: `Terminal sẽ mở trên ${host.name} — máy đang cắm iPhone. Người ngồi ở máy đó nhập mật khẩu.`,
      done,
    };
  }
  return {
    idle: 'Mở Terminal trên máy chủ',
    note: `Tunnel trên ${host.name} chưa được cài làm dịch vụ, nên nút này mở Terminal ở máy ấy và `
      + 'cần người ngồi đó nhập mật khẩu. Admin cài một lần trên máy chủ để không ai phải làm vậy '
      + `nữa: ${TUNNEL_SERVICE_HINT}`,
    done,
  };
}

/** "Làm trên: …" — nói TRƯỚC khi bấm, vì chỗ việc xảy ra có thể là máy khác. */
function WhereNote({ target, op }: { target?: FixTarget; op: FixOp }) {
  const host = target?.host;
  if (!host) return null;
  const text = op === 'ios_tunnel' ? tunnelText(host).note : `Làm trên ${host.name} — máy đang cắm thiết bị.`;
  return text ? <span className="text-muted-foreground text-xs">{text}</span> : null;
}

/**
 * Một nút sửa, chạy trên ĐÚNG máy cắm thiết bị. Xong thì dò lại, để dòng đỏ
 * tự chuyển xanh — không bắt người dùng đoán rồi tự bấm "Kiểm tra lại".
 */
function FixButton({ op, target }: { op: FixOp; target?: FixTarget }) {
  const job = useStreamJob(`preflight-fix-${op}`, STREAM_ROUTES.prereqFix);
  const client = useQueryClient();
  const text = op === 'ios_tunnel'
    ? { ...FIX_TEXT.ios_tunnel, ...tunnelText(target?.host) }
    : FIX_TEXT[op];

  useEffect(() => {
    if (job.status !== 'done') return;
    if (op !== 'start_appium') toast.success(text.done);
    void client.invalidateQueries({ queryKey: ['preflight'] });
  }, [job.status, client, op, text.done]);

  const running = job.status === 'running';
  return (
    <div className="flex flex-col items-start gap-1.5">
      <WhereNote target={target} op={op} />
      <Button
        size="sm"
        variant="outline"
        disabled={running}
        onClick={() => job.start({ op, platform: target?.platform, device: target?.device })}
      >
        <text.Icon className="size-4" />
        {running ? text.busy : text.idle}
      </Button>
      {job.status === 'error' && (
        <span className="text-destructive text-xs">{job.error ?? 'Không làm được việc này.'}</span>
      )}
      {/* Dòng log cuối, không phải cả khối: đủ biết đang tới đâu. */}
      {running && job.logs.length > 0 && (
        <span className="text-muted-foreground text-xs">{job.logs[job.logs.length - 1]}</span>
      )}
    </div>
  );
}

/**
 * Mở Terminal với lệnh dựng tunnel đã điền sẵn — trên máy đang cắm iPhone.
 *
 * Không hỏi mật khẩu ở đây, và đó là chủ đích: xem chú thích ở
 * openTunnelTerminal() trong src/runner/prereq.ts. Kèm nút chép lệnh, cho ai
 * đang ngồi ngay ở máy ấy muốn tự chạy.
 */
function StartIosTunnel({ target }: { target?: FixTarget }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <FixButton op="ios_tunnel" target={target} />
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
