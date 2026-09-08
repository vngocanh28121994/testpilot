import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useStreamJob } from '@/hooks/useStreamJob';
import type { PrereqXcodeResponse } from '@core/ui/contracts.js';

/**
 * Những việc sửa môi trường mà preflight không tự trả lời được.
 *
 * Trước đây đây là một thẻ riêng, "Yêu cầu trước khi chạy", nằm cạnh thẻ
 * "Kiểm tra trước khi chạy". Hai thẻ cùng liệt kê Appium, thiết bị và driver,
 * bằng hai cách vẽ khác nhau, và chỉ một trong hai là thứ thật sự khoá nút chạy
 * — nên không thẻ nào trả lời dứt khoát được câu "chạy được chưa". Nay chỉ còn
 * một thẻ, và phần này là cái đuôi công cụ của nó: chỉ chứa hành động, không
 * lặp lại kết luận.
 *
 * Cài driver ở đây chứ không phải một dòng kiểm tra, vì không có endpoint nào
 * hỏi được "driver đã cài chưa" — chỉ có lệnh cài. Một dòng trạng thái không
 * kiểm được thì không nên tồn tại.
 */
export function PrereqTools({ platform }: { platform: 'android' | 'ios' }) {
  const client = useQueryClient();
  const restart = useStreamJob('prereq-appium-restart', STREAM_ROUTES.prereqAppiumRestart);
  const driver = platform === 'android' ? 'uiautomator2' : 'xcuitest';
  const install = useStreamJob(`prereq-driver-${driver}`, STREAM_ROUTES.prereqDriver);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <span className="text-sm font-medium">Công cụ</span>

      <div className="flex flex-wrap items-center gap-2">
        {/* Khởi động lại luôn bấm được, kể cả khi Appium đang chạy: đó chính là
            lúc cần nó — một Appium còn sống nhưng đã treo phiên cũ. */}
        <Button
          size="sm"
          variant="outline"
          disabled={restart.status === 'running'}
          onClick={() => {
            restart.start();
            toast.info('Đang khởi động lại Appium…');
          }}
        >
          {restart.status === 'running' ? 'Đang khởi động lại…' : 'Khởi động lại Appium'}
        </Button>
        <code className="text-muted-foreground text-xs">appium</code>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={install.status === 'running'}
          onClick={() => {
            install.start({ driver });
            toast.info(`Đang cài driver ${driver}…`);
          }}
        >
          {install.status === 'running' ? 'Đang cài…' : `Cài driver ${driver}`}
        </Button>
        {/* Câu lệnh tương đương hiện ra để việc màn hình vừa làm là thứ kiểm
            chứng lại được, chứ không phải một hộp đen bấm rồi tin. */}
        <code className="text-muted-foreground text-xs">appium driver install {driver}</code>
      </div>

      {platform === 'ios' && <XcodeRow />}

      {(restart.logs.length > 0 || install.logs.length > 0) && (
        <pre className="console mt-0 max-h-40 overflow-auto text-xs">
          {[...restart.logs, ...install.logs].join('\n')}
        </pre>
      )}

      {/* Sau khi sửa xong thì dò lại, để kết luận ở trên tự đổi. */}
      {(restart.status === 'done' || install.status === 'done') && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => void client.invalidateQueries({ queryKey: ['preflight'] })}
        >
          Kiểm tra lại sau khi sửa
        </Button>
      )}
    </div>
  );
}

/**
 * Xcode: preflight chỉ nhắc tới nó khi `xcrun` gãy, mà "Command Line Tools là
 * không đủ" là thứ phải nói trước, không phải sau khi một lượt chạy đã hỏng.
 */
function XcodeRow() {
  const xcode = useQuery({
    queryKey: ['prereq-xcode'],
    queryFn: () => api.get<PrereqXcodeResponse>(ROUTES.prereqXcode),
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={xcode.isFetching}
          onClick={() => void xcode.refetch()}
        >
          Kiểm tra Xcode
        </Button>
        <code className="text-muted-foreground text-xs">xcodebuild -version</code>
      </div>
      <span className="text-muted-foreground text-xs">
        Command Line Tools là không đủ — cần Xcode đầy đủ.
      </span>
      {xcode.data && (
        <pre className="console mt-0 max-h-32 overflow-auto text-xs">
          {xcode.data.ok
            ? [xcode.data.version, xcode.data.path, xcode.data.sdk].filter(Boolean).join('\n')
            : (xcode.data.reason ?? 'Chưa dùng được.')}
        </pre>
      )}
    </div>
  );
}
