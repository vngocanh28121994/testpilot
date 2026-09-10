import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckedAt } from '@/components/CheckedAt';
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
  const [rechecking, setRechecking] = useState(false);
  const restart = useStreamJob('prereq-appium-restart', STREAM_ROUTES.prereqAppiumRestart);
  const driver = platform === 'android' ? 'uiautomator2' : 'xcuitest';
  const install = useStreamJob(`prereq-driver-${driver}`, STREAM_ROUTES.prereqDriver);

  // Xcode đứng ĐẦU cho iOS: driver phải build WebDriverAgent, nên thiếu nó thì
  // mọi bước sau chưa kiểm được. Thứ tự này là nội dung, không phải trang trí.
  let n = 0;

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-3">
      <span className="text-sm font-medium">Yêu cầu trước khi chạy</span>

      {platform === 'ios' && (
        <Step
          n={(n += 1)}
          title="Xcode — driver phải build WebDriverAgent"
          command="xcodebuild -version"
          note="Command Line Tools là không đủ; cần Xcode đầy đủ."
        >
          <XcodeRow />
        </Step>
      )}

      <Step n={(n += 1)} title="Appium server" command="appium">
        <div>
          {/* Khởi động lại luôn bấm được, kể cả khi Appium đang chạy: đó chính
              là lúc cần nó — một Appium còn sống nhưng đã treo phiên cũ. */}
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
        </div>
      </Step>

      <Step
        n={(n += 1)}
        title={platform === 'ios' ? 'Kết nối iPhone/iPad hoặc bật Simulator' : 'Kết nối máy Android hoặc bật emulator'}
        command={platform === 'ios' ? 'xcrun xctrace list devices' : 'adb devices -l'}
      >
        <DevicesRow platform={platform} />
      </Step>

      {platform === 'ios' && (
        <Step
          n={(n += 1)}
          title="Chuẩn bị trên chính iPhone/iPad"
          note="Ba thiết lập này nằm trên máy, không lệnh nào ở đây đọc lại được — nên chúng được nêu ra thay vì kiểm tra. Đây là lý do thường gặp nhất khiến một bộ cài đúng vẫn hỏng."
        >
          <IosDeviceSetup />
        </Step>
      )}

      {platform === 'ios' && (
        <Step
          n={(n += 1)}
          title="Tunnel cho WebView (iOS 17+)"
          note="Chỉ cần khi app là hybrid. Từ iOS 17, Appium chỉ với tới Web Inspector qua tunnel này; thiếu nó thì mọi kịch bản hybrid hỏng ngay bước đầu dù máy, app và WebDriverAgent đều đúng."
        >
          <TunnelCommand />
        </Step>
      )}

      <Step n={(n += 1)} title="Appium driver" command={`appium driver install ${driver}`}>
        <div>
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
        </div>
      </Step>
      {(restart.logs.length > 0 || install.logs.length > 0) && (
        <LogView
          logs={[...restart.logs, ...install.logs]}
          className="max-h-40"
          label="Log công cụ"
        />
      )}

      {/* Nút này từng là ca tệ nhất trong cả màn hình.
          `variant="ghost"` làm nó trông như chữ thường, và thứ nó thay đổi —
          kết luận preflight — nằm ở một THẺ KHÁC phía trên, có thể đang ngoài
          tầm nhìn. Đứng ở đáy thẻ này bấm thì đúng là không thấy gì xảy ra.
          Nay nó trông ra nút, tự khoá trong lúc chạy, và kéo luôn kết quả vào
          tầm mắt thay vì đổi một thứ ở nơi khác rồi im lặng. */}
      {(restart.status === 'done' || install.status === 'done') && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={rechecking}
          onClick={async () => {
            setRechecking(true);
            try {
              await client.invalidateQueries({ queryKey: ['preflight'] });
              document
                .querySelector('[aria-labelledby="preflight-title"]')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              toast.success('Đã kiểm tra lại môi trường.');
            } finally {
              setRechecking(false);
            }
          }}
        >
          {rechecking ? 'Đang kiểm tra…' : 'Kiểm tra lại sau khi sửa'}
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
        <CheckedAt at={devices.dataUpdatedAt || undefined} busy={devices.isFetching} />
      </div>
      {platform === 'ios' && (
        <span className="text-muted-foreground text-xs">
          Máy ở mục “Devices Offline” là đã ghép đôi nhưng chưa dùng được.
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

/**
 * Một bước, có số.
 *
 * Khu này là một TRÌNH TỰ, không phải một rổ nút: không có Xcode thì không
 * build được WebDriverAgent, nên mọi thứ sau đó chưa kiểm được. Đánh số nói ra
 * điều đó; một danh sách nút phẳng thì không.
 */
/**
 * Lệnh dựng tunnel, kèm nút chép.
 *
 * Không có nút "chạy": lệnh cần sudo, mà server không có mật khẩu máy và cũng
 * không nên có. Việc duy nhất giao diện làm được tử tế là đưa đúng lệnh sang
 * clipboard để người dùng dán vào Terminal của họ — và nói rõ phải giữ cửa sổ
 * đó mở, vì tunnel chết theo tiến trình.
 */
function TunnelCommand() {
  const [copied, setCopied] = useState(false);
  const command = 'sudo appium driver run xcuitest tunnel-creation';

  // Mở Terminal chứ không tự chạy sudo. Hỏi mật khẩu máy trên giao diện là đẩy
  // nó qua trình duyệt, qua HTTP, rồi qua một tiến trình đang ghi log xuống
  // đĩa — trong khi để macOS tự hỏi trong Terminal thì tool không hề chạm vào.
  // Kèm một lợi ích thật: tunnel chạy ngoài server nên restart server không
  // giết nó.
  const open = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(ROUTES.prereqIosTunnel),
    onSuccess: (result: { ok: boolean; error?: string }) => {
      if (result.ok) toast.success('Đã mở Terminal. Nhập mật khẩu máy ở cửa sổ đó, rồi bấm “Kiểm tra lại”.');
      else toast.error(result.error ?? 'Không mở được Terminal.');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={open.isPending} onClick={() => open.mutate()}>
          {open.isPending ? 'Đang mở Terminal…' : 'Mở Terminal và chạy'}
        </Button>
        <code className="bg-muted rounded px-2 py-1 text-xs">{command}</code>
        {/* Đường lui cho máy chặn AppleScript, và cho ai muốn tự chạy chỗ khác. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard
              .writeText(command)
              .then(() => {
                setCopied(true);
                toast.success('Đã chép lệnh. Dán vào Terminal và để cửa sổ đó chạy.');
              })
              .catch(() => toast.error('Trình duyệt không cho chép. Bạn chép tay giúp nhé.'));
          }}
        >
          {copied ? 'Đã chép' : 'Chép lệnh'}
        </Button>
      </div>
      <ol className="text-muted-foreground flex list-decimal flex-col gap-1 ps-4 text-xs">
        <li>
          Bấm <b className="text-foreground">Mở Terminal và chạy</b> — lệnh được điền sẵn, bạn không
          phải gõ gì.
        </li>
        <li>
          Nhập mật khẩu đăng nhập máy Mac <b className="text-foreground">trong cửa sổ Terminal</b>{' '}
          (gõ không hiện ký tự). Tool không hỏi và không thấy mật khẩu đó.
        </li>
        <li>
          <b className="text-foreground">Để nguyên cửa sổ đó</b> suốt buổi test. Đóng cửa sổ là
          tunnel tắt theo.
        </li>
        <li>
          Quay lại đây bấm <b className="text-foreground">Kiểm tra lại</b>: dòng “Tunnel cho WebView”
          phải chuyển sang xanh.
        </li>
      </ol>
    </div>
  );
}

function Step({
  n,
  title,
  command,
  note,
  children,
}: {
  n: number;
  title: string;
  command?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{title}</span>
          {command && <code className="text-muted-foreground text-xs">{command}</code>}
        </div>
        {note && <span className="text-muted-foreground text-xs">{note}</span>}
        {children}
      </div>
    </div>
  );
}

/**
 * Bốn thiết lập nằm trên chính cái điện thoại.
 *
 * Không lệnh nào trên máy tính này đọc lại được, nên chúng được NÊU RA thay vì
 * kiểm tra — và chúng là lý do thường gặp nhất khiến một bộ cài đúng vẫn hỏng:
 * Appium báo một lỗi về WebDriverAgent, còn nguyên nhân thật nằm ở một công tắc
 * trong Cài đặt mà không ai nghĩ tới.
 */
function IosDeviceSetup() {
  return (
    <ol className="text-muted-foreground flex list-decimal flex-col gap-2 ps-4 text-xs">
      <li>
        <b className="text-foreground">Tin cậy máy tính</b> — cắm cáp, mở khoá máy, bấm “Tin cậy”
        rồi nhập mật mã.
        <div className="mt-0.5">
          Hộp thoại chỉ hiện khi máy đang mở khoá. Lỡ bấm “Không tin cậy”:{' '}
          <span className="text-foreground">
            Cài đặt › Cài đặt chung › Chuyển hoặc Đặt lại iPhone › Đặt lại › Đặt lại Vị trí &amp; Quyền riêng tư
          </span>
          , rồi cắm lại.
        </div>
      </li>
      <li>
        <b className="text-foreground">Chế độ nhà phát triển</b> (iOS 16+) —{' '}
        <span className="text-foreground">
          Cài đặt › Quyền riêng tư &amp; Bảo mật › Chế độ nhà phát triển
        </span>{' '}
        → bật → khởi động lại máy → xác nhận.
        <div className="mt-0.5">
          Mục này chỉ xuất hiện sau khi máy đã cắm vào Xcode một lần, hoặc đã cài một app ký bằng
          chứng chỉ dev. Máy mới sẽ không thấy dòng đó.
        </div>
      </li>
      <li>
        <b className="text-foreground">Tự động hoá giao diện</b> —{' '}
        <span className="text-foreground">
          Cài đặt › Nhà phát triển › Tự động hoá giao diện (UI Automation)
        </span>{' '}
        → bật.
        <div className="mt-0.5">
          Đây là công tắc quyết định chuyện máy có hỏi mật mã ở MỖI lượt chạy hay không. Chưa bật thì
          iOS coi từng phiên XCUITest là một lần cấp quyền riêng, và người chạy phải gõ mật mã giữa
          chừng — cắm năm máy là năm lần, mỗi lượt. Bật rồi thì chỉ còn đúng một lần cho mỗi máy,
          lúc cài đặt.
        </div>
      </li>
      <li>
        <b className="text-foreground">Web Inspector</b> —{' '}
        <span className="text-foreground">Cài đặt › Safari › Nâng cao › Web Inspector</span>.
        <div className="mt-0.5">
          Chỉ cần khi <code>ios.hybrid = true</code>. Không bật thì Appium không thấy WebView context
          nào, và app hybrid trông như một màn hình rỗng.
        </div>
      </li>
    </ol>
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
        <CheckedAt at={xcode.dataUpdatedAt || undefined} busy={xcode.isFetching} />
      </div>
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
