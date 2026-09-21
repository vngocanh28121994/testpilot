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

export interface Runner {
  prereq: RunnerPrereqApi;
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
};

export type { PrereqAndroidDevice };
