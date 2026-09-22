/**
 * Mặt tiền của runner — danh sách ĐÓNG những việc control plane được phép nhờ.
 *
 * Vì sao không để server gọi thẳng `prereq.ts`: ở chế độ `server`, phía bên
 * kia không còn là một lời gọi hàm mà là một thông điệp đi qua mạng, tới máy
 * của người khác. Nếu server quen gọi thẳng thì ranh giới ấy không tồn tại
 * trong code, và mỗi lần ai đó cần "chỉ một lệnh nữa thôi" thì nó lại mở rộng
 * ra một chút — cho tới khi server chạy được lệnh tuỳ ý trên máy người dùng.
 *
 * Một người cài runner lên máy làm việc của họ chấp nhận cho nó chạy NHỮNG VIỆC
 * NÀY, không phải chạy bất cứ thứ gì server gửi xuống. Danh sách dưới đây là
 * lời hứa ấy, viết bằng kiểu dữ liệu. Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md)
 * mục 5 và 12.
 *
 * `InProcessTransport` của P1.4 sẽ nhận đúng interface này; bản WebSocket cũng
 * vậy. Nên chỗ duy nhất phải sửa khi runner đi ra máy khác là hiện thực, không
 * phải nơi gọi.
 */
import type { TestPilotConfig } from '../config.js';
import { readAppVersion } from './appInfo.js';
import { runOnFarm } from './farm.js';
import {
  isNamedDevice,
  parseDeviceToken,
  runSuite,
  runSuiteParallel,
  stopSuite,
  type PickedDevice,
} from './execute.js';
import {
  controlDevices,
  pressKey,
  screenSize,
  startScreenStream,
  swipe,
  tap,
  typeText,
  type ControlDevice,
  type ScreenStreamSink,
} from './control.js';
import type { ControlTarget } from '../protocol/control.js';
import type { PrereqAndroidDevice } from './prereq.js';
import {
  iosDeviceNames,
  openIosSettings,
  openTunnelTerminal,
  prereqAdb,
  prereqAppium,
  prereqAppiumStatus,
  prereqInstallDriver,
  prereqIosDevices,
  prereqXcode,
  restartAppium,
} from './prereq.js';

/** Một dòng log chảy ngược về người bấm nút. Tương ứng `JobEvent` kind `log`. */
export type LogSink = (line: string) => void;

/**
 * Chín việc, không hơn.
 *
 * Thêm một việc vào đây là một quyết định kiến trúc — nó mở rộng thứ mà một
 * server bị chiếm có thể làm trên máy người dùng. Đó là lý do danh sách này
 * nằm trong một interface đặt tên rõ ràng chứ không phải một object tiện tay.
 */
export interface RunnerPrereqApi {
  /** Trạng thái Appium: đang chạy chưa, do ai khởi động, lần thoát gần nhất. */
  appiumStatus(): ReturnType<typeof prereqAppiumStatus>;
  /** Khởi động Appium nếu chưa chạy; log chảy về theo từng dòng. */
  startAppium(log: LogSink): Promise<void>;
  /** Giết rồi khởi động lại — dùng khi Appium còn sống nhưng đã lú. */
  restartAppium(log: LogSink): Promise<void>;
  /** Máy Android đang cắm, theo `adb devices`. */
  androidDevices(): ReturnType<typeof prereqAdb>;
  /** Xcode có đủ để build cho iOS không, và thiếu ở mức nào. */
  xcode(): ReturnType<typeof prereqXcode>;
  /** Máy iOS đang cắm: udid, máy nào dùng được, tên hiển thị. */
  iosDevices(): ReturnType<typeof prereqIosDevices>;
  /** Chỉ tên máy iOS — rẻ hơn `iosDevices()` khoảng 30 lần. */
  iosNames(): ReturnType<typeof iosDeviceNames>;
  /** Mở Terminal của máy với lệnh dựng tunnel điền sẵn. KHÔNG tự chạy sudo. */
  openTunnelTerminal(): ReturnType<typeof openTunnelTerminal>;
  /** Mở app Cài đặt trên chính chiếc iPhone đang cắm, để người dùng bấm Tin cậy. */
  openIosSettings(cfg: TestPilotConfig): ReturnType<typeof openIosSettings>;
  /** Cài một driver Appium theo tên đã kiểm tra. */
  installDriver(driver: string, log: LogSink): Promise<void>;
}

/**
 * Chạy và dừng một lượt test. Ở chế độ `server` đây là chỗ job đi qua mạng.
 *
 * `parseDeviceToken` nằm chung ở đây dù nó chỉ là phân tích chuỗi: cách đọc
 * `platform:id` là một phần của hợp đồng giữa hai bên, và để hai bên tự đoán
 * cách đọc là cách cũ để một chiếc điện thoại bị hiểu nhầm thành chiếc khác.
 */
export interface RunnerRunApi {
  startSuite(...args: Parameters<typeof runSuite>): ReturnType<typeof runSuite>;
  startParallel(...args: Parameters<typeof runSuiteParallel>): ReturnType<typeof runSuiteParallel>;
  /** Dừng mọi lượt đang chạy, và hạ WebDriverAgent nếu nó còn sống. */
  stop(): ReturnType<typeof stopSuite>;
  /** Thiết bị này có tên trong config không — quyết định thư mục lượt chạy. */
  isNamedDevice(picked: PickedDevice, configFile: string): Promise<boolean>;
  parseDeviceToken(token: string): PickedDevice | null;
}

/** Device Farm: chỉ phần phải sinh tiến trình trên máy này (đóng gói bundle). */
export interface RunnerFarmApi {
  run(...args: Parameters<typeof runOnFarm>): ReturnType<typeof runOnFarm>;
}

/** Đọc thông tin từ file build trên máy — cần `aapt`, nên thuộc runner. */
export interface RunnerBuildsApi {
  readAppVersion(file: string): ReturnType<typeof readAppVersion>;
}

/**
 * Xem màn hình và chạm vào một chiếc máy. Sáu việc, và ranh giới ở đây gắt hơn
 * mọi nhóm khác.
 *
 * Bốn nhóm trên là những việc có KẾT QUẢ: chạy một suite, đọc phiên bản app,
 * hỏi Appium còn sống không. Nhóm này thì đưa cho phía bên kia quyền điều khiển
 * một chiếc điện thoại thật đang cắm trên máy của một con người — gõ được vào
 * ứng dụng ngân hàng đang mở, bấm được nút xác nhận. Nên nó không nhận "một
 * lệnh input bất kỳ" mà nhận đúng bốn động tác, với toạ độ đã kiểm và một danh
 * sách phím ngắn không có POWER.
 *
 * Và nó chỉ chạy khi người gọi đang GIỮ LEASE của chiếc máy ấy — phần kiểm tra
 * đó nằm ở control plane, vì lease là dữ liệu dùng chung. Xem
 * [src/server/routes/control.ts](../server/routes/control.ts).
 */
export interface RunnerControlApi {
  /** Những chiếc máy điều khiển được, cả Android lẫn iOS, trong một danh sách. */
  devices(): Promise<ControlDevice[]>;
  /** Kích thước mà toạ độ chạm đi theo — không phải luôn là kích thước vật lý. */
  screenSize(target: ControlTarget): ReturnType<typeof screenSize>;
  /**
   * Mở luồng màn hình. Nhiều người xem dùng chung một nguồn.
   *
   * Android cho ra H.264, iOS cho ra JPEG từng khung — xem `codecFor()`. Người
   * gọi phải biết mình đang nhận kiểu nào, nên control plane gửi kèm `codec`
   * trong sự kiện `meta` đầu luồng.
   */
  startScreenStream(
    target: ControlTarget,
    sink: ScreenStreamSink,
  ): ReturnType<typeof startScreenStream>;
  tap(target: ControlTarget, x: number, y: number): Promise<void>;
  swipe(
    target: ControlTarget,
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<void>;
  typeText(target: ControlTarget, text: string): Promise<void>;
  /** Chỉ phím trong danh sách cho phép của NỀN TẢNG ấy; xem `protocol/control.ts`. */
  pressKey(target: ControlTarget, key: string): Promise<void>;
}

export interface Runner {
  prereq: RunnerPrereqApi;
  run: RunnerRunApi;
  farm: RunnerFarmApi;
  builds: RunnerBuildsApi;
  control: RunnerControlApi;
}

/**
 * Runner chạy trong cùng tiến trình với server — chế độ `embedded` hôm nay.
 *
 * Đây là hiện thực duy nhất ở P1, và nó cố tình mỏng: mỗi phương thức gọi đúng
 * một hàm trong `prereq.ts`. Chỗ này không được phép có logic riêng, vì logic
 * ấy sẽ không tồn tại ở bản chạy qua mạng.
 */
export const localRunner: Runner = {
  prereq: {
    appiumStatus: () => prereqAppiumStatus(),
    startAppium: (log) => prereqAppium(log),
    restartAppium: (log) => restartAppium(log),
    androidDevices: () => prereqAdb(),
    xcode: () => prereqXcode(),
    iosDevices: () => prereqIosDevices(),
    iosNames: () => iosDeviceNames(),
    openTunnelTerminal: () => openTunnelTerminal(),
    openIosSettings: (cfg) => openIosSettings(cfg),
    installDriver: (driver, log) => prereqInstallDriver(driver, log),
  },
  run: {
    startSuite: (...args) => runSuite(...args),
    startParallel: (...args) => runSuiteParallel(...args),
    stop: () => stopSuite(),
    isNamedDevice: (picked, configFile) => isNamedDevice(picked, configFile),
    parseDeviceToken: (token) => parseDeviceToken(token),
  },
  farm: {
    run: (...args) => runOnFarm(...args),
  },
  builds: {
    readAppVersion: (file) => readAppVersion(file),
  },
  control: {
    devices: () => controlDevices(),
    screenSize: (target) => screenSize(target),
    startScreenStream: (target, sink) => startScreenStream(target, sink),
    tap: (target, x, y) => tap(target, x, y),
    swipe: (target, from, to, durationMs) => swipe(target, from, to, durationMs),
    typeText: (target, text) => typeText(target, text),
    pressKey: (target, key) => pressKey(target, key),
  },
};

export type { ControlDevice, PickedDevice, PrereqAndroidDevice, ScreenStreamSink };
