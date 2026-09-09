import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogView } from '@/components/LogView';
import { Button } from '@/components/ui/button';
import { api } from '@/api/client';
import { ROUTES, STREAM_ROUTES } from '@/api/routes';
import { useStreamJob } from '@/hooks/useStreamJob';
import type { PrereqAdbResponse, PrereqIosDevicesResponse, PrereqXcodeResponse } from '@core/ui/contracts.js';

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
      <DevicesRow platform={platform} />

      {(restart.logs.length > 0 || install.logs.length > 0) && (
        <LogView
          logs={[...restart.logs, ...install.logs]}
          className="max-h-40"
          label="Log công cụ"
        />
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
/**
 * Số SDK là phần đáng đọc nhất, và là phần v2 từng bỏ đi.
 *
 * Bản cũ chỉ đổ ra ba dòng thô — version, path, sdk — trong khi thứ quyết định
 * được hay không là: SDK cao nhất build được tới iOS mấy. Một iPhone mới hơn
 * con số đó sẽ từ chối cài WebDriverAgent dù mọi thứ khác đều đúng, và lỗi
 * hiện ra lúc chạy là `xcodebuild failed with code 65` — không ai đọc câu đó
 * ra thành "Xcode cũ quá".
 */
export function xcodeReport(data: { version?: string; path?: string; sdk?: string }): string {
  const major = Number(/iphoneos([0-9]+)/.exec(data.sdk ?? '')?.[1] ?? 0);
  return [
    data.version,
    data.path,
    data.sdk ? `SDK cao nhất: ${data.sdk} → build được cho iOS ≤ ${major}.x` : '',
    major && major < 17
      ? `⚠ iPhone chạy iOS > ${major} sẽ không cài được WebDriverAgent — cần nâng Xcode.`
      : '',
  ].filter(Boolean).join('\n');
}

/**
 * Danh sách thiết bị hệ điều hành đang thấy.
 *
 * Hai endpoint này đã có sẵn từ đầu nhưng v2 chưa màn nào gọi tới, nên thông
 * tin quyết định nhất bị mất: một iPhone nằm ở mục `== Devices Offline ==` là
 * máy đã ghép đôi mà chưa dùng được — preflight chỉ nói gọn "chưa dùng được",
 * còn ở đây thấy được cả tên, phiên bản iOS và nó đang nằm ở mục nào.
 */
function DevicesRow({ platform }: { platform: 'android' | 'ios' }) {
  const devices = useQuery({
    queryKey: ['prereq-devices', platform],
    enabled: false,
    queryFn: async () =>
      platform === 'ios'
        ? (await api.get<PrereqIosDevicesResponse>(ROUTES.prereqIosDevices)).devices
        : (await api.get<PrereqAdbResponse>(ROUTES.prereqAdb)).devices.map(
            (d) => [d.id, d.state, d.model, d.androidVersion && `Android ${d.androidVersion}`, d.kind].filter(Boolean).join('  ·  '),
          ),
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={devices.isFetching}
          onClick={() => void devices.refetch()}
        >
          Xem thiết bị hệ thống thấy
        </Button>
        <code className="text-muted-foreground text-xs">
          {platform === 'ios' ? 'xcrun xctrace list devices' : 'adb devices -l'}
        </code>
      </div>
      {platform === 'ios' && (
        <span className="text-muted-foreground text-xs">
          Máy nằm ở mục “Devices Offline” là đã ghép đôi nhưng chưa dùng được — thường do đang khoá,
          chưa bật Developer Mode, hoặc chưa bấm Tin tưởng máy tính này.
        </span>
      )}
      {devices.data && (
        <LogView
          className="max-h-48"
          label={`Thiết bị ${platform}`}
          logs={devices.data.length > 0 ? devices.data : ['Không thấy thiết bị nào.']}
        />
      )}
    </div>
  );
}

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
        <LogView
          className="max-h-32"
          label="Kết quả kiểm tra Xcode"
          logs={xcode.data.ok ? xcodeReport(xcode.data) : (xcode.data.reason ?? 'Chưa dùng được.')}
        />
      )}
    </div>
  );
}
