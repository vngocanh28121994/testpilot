/**
 * "Cắm máy mới thì làm gì" — trên giao diện, để không ai phải đi hỏi lại.
 *
 * Mỗi lần cắm một chiếc điện thoại mới, người ta cần đúng một danh sách việc:
 * phần lớn nằm trên chính điện thoại (không lệnh nào ở máy tính đọc lại được),
 * phần còn lại chỉ làm một lần cho máy tính cắm máy. Trước đây danh sách ấy
 * nằm rải trong README, trong màn Local Runner, và trong đầu người đã từng làm.
 *
 * Thẻ tự mở khi có việc: chưa máy nào cắm, hoặc có máy cắm mà chưa dùng được.
 * Lý do cụ thể của từng máy vẫn nằm ngay dưới tên máy ở bảng Thiết bị; thẻ này
 * là toàn bộ trình tự, cho người muốn làm đúng từ đầu.
 */
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ControlDeviceView } from '@core/ui/contracts.js';

type Platform = 'android' | 'ios';

export function NewDeviceGuide({ devices }: { devices: ControlDeviceView[] | undefined }) {
  const pending = (devices ?? []).filter((device) => device.unavailable);
  // Chưa tải xong thì chưa biết có việc hay không: đóng, để thẻ không bật mở
  // rồi đóng lại ngay khi danh sách về.
  const needsHelp = devices !== undefined && (devices.length === 0 || pending.length > 0);

  // Người dùng đã bấm thì theo người dùng; chưa bấm thì theo tình trạng máy.
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const [tab, setTab] = useState<Platform | undefined>(undefined);
  const shown = open ?? needsHelp;
  const Icon = shown ? ChevronDown : ChevronRight;

  return (
    <Card aria-labelledby="new-device-title">
      <CardHeader>
        <button
          type="button"
          aria-expanded={shown}
          aria-controls="new-device-body"
          onClick={() => setOpen(!shown)}
          className="flex items-center gap-1.5 text-left"
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <CardTitle id="new-device-title">Cắm máy mới</CardTitle>
        </button>
        <CardDescription>
          {pending.length > 0
            ? `${pending.length} máy đang cắm mà chưa dùng được — việc cần làm ghi ngay dưới tên máy ở bảng Thiết bị. Trình tự đầy đủ ở đây.`
            : 'Những việc cần làm một lần cho mỗi điện thoại mới, để nó chạy được như các máy cũ.'}
        </CardDescription>
      </CardHeader>
      {shown && (
        <CardContent id="new-device-body">
          <Tabs
            value={tab ?? pending[0]?.platform ?? 'android'}
            onValueChange={(value) => setTab(value as Platform)}
          >
            <TabsList>
              <TabsTrigger value="android">Android</TabsTrigger>
              <TabsTrigger value="ios">iPhone / iPad</TabsTrigger>
            </TabsList>
            <TabsContent value="android">
              <AndroidSteps />
            </TabsContent>
            <TabsContent value="ios">
              <IosSteps />
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}

function AndroidSteps() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Trên điện thoại">
        <Steps>
          <Item title="Bật Tuỳ chọn nhà phát triển">
            <Path>Cài đặt › Giới thiệu về điện thoại</Path> → bấm 7 lần vào <b>Số bản dựng</b>{' '}
            (Samsung: <Path>Thông tin phần mềm › Số hiệu bản tạo</Path>; Xiaomi:{' '}
            <Path>Phiên bản MIUI / HyperOS</Path>).
          </Item>
          <Item title="Bật Gỡ lỗi USB">
            <Path>Cài đặt › Tuỳ chọn nhà phát triển › Gỡ lỗi USB</Path>.
            <Note>
              Xiaomi / Redmi / POCO: bật thêm <b>Gỡ lỗi USB (Cài đặt bảo mật)</b> và{' '}
              <b>Cài đặt qua USB</b> — thiếu hai mục này thì Appium không cài được app phụ và không
              chạm được vào màn hình. Oppo / Realme / Vivo: tắt <b>Giám sát quyền</b> nếu có.
            </Note>
          </Item>
          <Item title="Cắm cáp và bấm Cho phép">
            Mở khoá điện thoại, bấm <b>Cho phép</b> ở hộp thoại “Cho phép gỡ lỗi USB?” và tick{' '}
            <b>Luôn cho phép từ máy tính này</b>.
            <Note>
              Không thấy hộp thoại thì rút cáp cắm lại khi máy đang mở khoá. Cáp chỉ sạc (không
              truyền dữ liệu) cũng làm máy không hiện.
            </Note>
          </Item>
          <Item title="Nên bật: Không khoá màn hình khi sạc">
            <Path>Tuỳ chọn nhà phát triển › Không khóa màn hình (Stay awake)</Path>. Máy tự khoá giữa
            lượt chạy là một kiểu hỏng khó đoán.
          </Item>
        </Steps>
      </Section>
      <Done />
    </div>
  );
}

function IosSteps() {
  return (
    <div className="flex flex-col gap-4">
      <Section title="Trên iPhone">
        <IosPhoneSettings />
      </Section>

      <Section title="Trên web — một lần cho mỗi máy">
        <Steps>
          <Item title="Thêm máy vào danh sách">
            Mở <Link to="/runner" className="text-primary underline">Local Runner</Link>, chọn iOS. Máy
            mới hiện ở phần <b>Trước khi chạy</b> kèm nút thêm máy — bấm để máy có tên trong danh sách
            và chọn được.
          </Item>
          <Item title="Cho tunnel nhận máy (iOS 17+)">
            Mỗi máy Mac chỉ có MỘT tunnel, giữ mọi iPhone cắm vào nó. Khi tunnel đang chạy, Appium chỉ
            tìm iPhone trong tunnel — máy chưa vào tunnel thì mọi thứ với máy đó hỏng, kể cả màn Điều
            khiển. Tunnel chỉ nhận những iPhone cắm sẵn lúc nó khởi động. Tunnel đã cài làm dịch vụ thì{' '}
            <b>tự khởi động lại</b> trong khoảng một phút sau khi cắm — nhưng chỉ lúc không có lượt iOS
            nào đang chạy trên máy đó, vì khởi động lại làm đứt lượt ấy. Chưa cài dịch vụ thì dòng{' '}
            <b>Tunnel iOS</b> ở <b>Trước khi chạy</b> đỏ, và màn Điều khiển báo “Appium không thấy
            chiếc iPhone này” — bấm nút ở một trong hai chỗ đó.
          </Item>
          <Item title="Cài WebDriverAgent lên máy">
            Vẫn ở <b>Trước khi chạy</b>, chọn iPhone này. Dòng <b>WebDriverAgent trên máy</b> đỏ thì bấm{' '}
            <b>Cài WebDriverAgent lên máy</b>. Tool tự đăng ký máy với tài khoản Apple (máy mới chưa có
            trong profile), ký và cài — 1–4 phút, giữ iPhone mở khoá suốt lúc đó.
          </Item>
          <Item title="Tin cậy chứng chỉ nhà phát triển">
            Cài xong, trên iPhone: <Path>Cài đặt › Cài đặt chung › VPN &amp; Quản lý thiết bị</Path> →
            chọn Apple ID nhà phát triển → <b>Tin cậy</b>. Mỗi máy một lần. Dòng kiểm tra sẽ nhắc nếu
            còn thiếu bước này.
          </Item>
          <Item title="App cần test (file .ipa)">
            IPA ký development hoặc ad-hoc chỉ cài được lên máy có trong profile của nó. Gửi{' '}
            <b>UDID</b> (dòng xám dưới tên máy ở bảng Thiết bị) cho người build app để thêm vào rồi
            build lại. TestPilot không tự làm được bước này.
          </Item>
          <Item title="Apple ID miễn phí: làm lại sau 7 ngày">
            Profile hết hạn thì dòng <b>WebDriverAgent trên máy</b> lại đỏ — bấm lại nút cài như trên.
          </Item>
        </Steps>
      </Section>

      <Section title="Một lần cho máy tính cắm iPhone (không phải mỗi máy)">
        <Steps>
          <Item title="Xcode đầy đủ">
            Command Line Tools là không đủ — driver phải build WebDriverAgent. Xcode phải đăng nhập Apple
            ID của team ký (<Path>Xcode › Settings › Accounts</Path>): đó là tài khoản dùng để đăng ký
            máy mới.
          </Item>
          <Item title="Tunnel iOS (app hybrid, iOS 17+)">
            Cần để Appium thấy WebView của app hybrid. Nên cài làm dịch vụ, một lần: <code>sudo bash scripts/install-ios-tunnel-service.sh</code>.
            Khi đó tunnel tự chạy lúc bật máy, và nút <b>Khởi động lại tunnel</b> chạy không cần mật khẩu
            — cần cho mỗi lần cắm thêm iPhone. Chưa cài thì nút mở Terminal và phải có người ngồi đó gõ
            mật khẩu máy Mac.
          </Item>
          <Item title="Cho phép “TestPilot Screen Capture” dùng camera">
            Để màn Điều khiển có hình 30 khung/giây qua cáp. Lỡ từ chối thì bật lại ở{' '}
            <Path>Cài đặt hệ thống › Quyền riêng tư &amp; Bảo mật › Camera</Path>.
          </Item>
        </Steps>
      </Section>
      <Done />
    </div>
  );
}

/**
 * Bốn thiết lập nằm trên chính cái iPhone.
 *
 * Không lệnh nào trên máy tính đọc lại được hết chúng, nên chúng được NÊU RA
 * — và chúng là lý do thường gặp nhất khiến một bộ cài đúng vẫn hỏng: Appium
 * báo một lỗi về WebDriverAgent, còn nguyên nhân thật nằm ở một công tắc trong
 * Cài đặt mà không ai nghĩ tới. Dùng chung ở màn Local Runner.
 */
export function IosPhoneSettings() {
  return (
    <Steps>
      <Item title="Tin cậy máy tính">
        Cắm cáp, mở khoá máy, bấm <b>Tin cậy</b> rồi nhập mật mã.
        <Note>
          Hộp thoại chỉ hiện khi máy đang mở khoá. Lỡ bấm “Không tin cậy”:{' '}
          <Path>
            Cài đặt › Cài đặt chung › Chuyển hoặc Đặt lại iPhone › Đặt lại › Đặt lại Vị trí &amp;
            Quyền riêng tư
          </Path>
          , rồi cắm lại.
        </Note>
      </Item>
      <Item title="Chế độ nhà phát triển (iOS 16+)">
        <Path>Cài đặt › Quyền riêng tư &amp; Bảo mật › Chế độ nhà phát triển</Path> → bật → máy
        khởi động lại → xác nhận <b>Bật</b>.
        <Note>
          Mục này chỉ xuất hiện sau khi máy đã cắm vào máy Mac có Xcode một lần, hoặc đã cài một app
          ký bằng chứng chỉ dev. Máy mới sẽ chưa thấy dòng đó.
        </Note>
      </Item>
      <Item title="Tự động hoá giao diện">
        <Path>Cài đặt › Nhà phát triển › Tự động hoá giao diện (UI Automation)</Path> → bật.
        <Note>
          Chưa bật thì máy hỏi mật mã ở MỖI lượt chạy — cắm năm máy là năm lần, mỗi lượt. Bật rồi thì
          chỉ còn đúng một lần cho mỗi máy.
        </Note>
      </Item>
      <Item title="Web Inspector">
        <Path>Cài đặt › Safari › Nâng cao › Web Inspector</Path>.
        <Note>
          Chỉ cần khi <code>ios.hybrid = true</code>. Không bật thì Appium không thấy WebView nào, và
          app hybrid trông như một màn hình rỗng.
        </Note>
      </Item>
    </Steps>
  );
}

/** Bước cuối chung: biết thế nào là xong. */
function Done() {
  return (
    <Section title="Kiểm tra">
      <Steps>
        <Item title="Máy hiện ở bảng Thiết bị với trạng thái Rảnh">
          Bấm <b>Tìm lại</b> ở bảng Thiết bị. Có dòng chữ vàng dưới tên máy thì làm đúng việc dòng ấy
          nói. Máy rảnh thì bấm <b>Điều khiển</b> để thử chạm vài cái.
        </Item>
        <Item title="Chạy ở màn Local Runner (không qua máy chủ)">
          Máy mới chưa có trong danh sách thiết bị của cấu hình: phần <b>Trước khi chạy</b> hiện nút
          thêm máy (hoặc chạy <code>npm run devices:sync</code>). Chạy qua runner hay máy chủ thì
          không cần — runner tự nhận máy đang cắm.
        </Item>
      </Steps>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">{children}</ol>;
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <b>{title}</b>
      <div className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{children}</div>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="mt-0.5">{children}</div>;
}

/** Đường đi trong Cài đặt — tô đậm hơn chữ quanh nó, vì đó là thứ người ta dò theo. */
function Path({ children }: { children: ReactNode }) {
  return <span className="text-foreground">{children}</span>;
}
