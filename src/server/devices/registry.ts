/**
 * Sổ thiết bị: máy nào đang cắm ở runner nào, và AI ĐƯỢC NHÌN THẤY nó.
 *
 * Tới P4 câu hỏi thứ hai mới có nghĩa. Ở phòng lab, mọi chiếc máy là của
 * chung; ở đây một chiếc điện thoại cắm vào laptop của một người là **của
 * người ấy**. Nó có mặt trong hệ thống vì họ muốn dùng chung hạ tầng, không
 * phải vì họ muốn cho cả công ty mượn máy.
 *
 * Nên danh sách thiết bị không phải một danh sách — nó là một danh sách KHÁC
 * NHAU cho từng người đang nhìn. Và cái khác nhau ấy phải nằm ở tầng kho, chỗ
 * duy nhất mọi đường đọc đều đi qua: lọc ở giao diện nghĩa là một route quên
 * lọc sẽ rò rỉ mà không ai thấy.
 *
 * Nguồn của sổ là **báo cáo từ runner**, không phải server tự đi hỏi: ở chế độ
 * server, máy chủ web không cắm thiết bị nào và không chạy `adb` (xem
 * FARM-ARCHITECTURE mục 12). Runner biết, nên runner nói.
 */
export type DevicePlatform = 'android' | 'ios';
export type DeviceVisibility = 'shared' | 'private';
export type DeviceState = 'idle' | 'offline' | 'quarantined';

/** Một chiếc máy như runner nhìn thấy nó. */
export interface ReportedDevice {
  platform: DevicePlatform;
  udid: string;
  /** Tên đọc được: "Pixel 7 · Android 16 · emulator". */
  label: string;
}

export interface DeviceRecord extends ReportedDevice {
  runnerId: string;
  orgId: string;
  /** Chủ của runner, nếu runner ấy là máy cá nhân. */
  ownerUserId?: string;
  visibility: DeviceVisibility;
  state: DeviceState;
  updatedAt: string;
}

/** Ai đang nhìn. Quyết định họ thấy gì. */
export interface Viewer {
  userId: string;
  orgId: string;
  /** `admin` thấy mọi máy của tổ chức, kể cả máy riêng. */
  isAdmin: boolean;
}

/**
 * Người này có được thấy chiếc máy ấy không.
 *
 * Hàm thuần và xuất ra ngoài, vì cùng một luật phải áp ở hai chỗ: lúc liệt kê
 * danh sách, và lúc ai đó nhắm một chiếc máy cụ thể bằng tên. Hai bản chép tay
 * của cùng một luật sẽ lệch nhau, và bên lỏng hơn là bên quyết định.
 */
export function maySee(device: DeviceRecord, viewer: Viewer, granted?: Set<string>): boolean {
  // Ranh giới tổ chức là thứ DUY NHẤT không có ngoại lệ ở đây. Mọi luật phía
  // dưới đều nới thêm quyền; dòng này thì không, và nó đứng đầu để không luật
  // nào ở dưới vượt qua được nó — kể cả một quyền mượn được ghi nhầm.
  if (device.orgId !== viewer.orgId) return false;
  if (device.visibility === 'shared') return true;
  if (viewer.isAdmin) return true;
  if (device.ownerUserId === viewer.userId) return true;
  // Được mượn: chỉ THÊM quyền, và thu lại được bất cứ lúc nào. Xem `grants.ts`.
  return granted?.has(device.udid) ?? false;
}

export interface DeviceRegistry {
  /**
   * Runner báo TOÀN BỘ danh sách máy nó đang thấy.
   *
   * Cả danh sách chứ không phải phần thay đổi: một chiếc máy bị rút ra là một
   * sự VẮNG MẶT, và sự vắng mặt không có sự kiện nào để gửi. Gửi cả danh sách
   * làm "biến mất" thành một trạng thái quan sát được.
   */
  report(
    runner: { id: string; orgId: string; ownerUserId?: string; visibility: DeviceVisibility },
    devices: ReportedDevice[],
    now?: Date,
  ): Promise<void>;

  /**
   * Máy mà người này được thấy.
   *
   * `granted` là những udid người ấy được MƯỢN — tra ở `DeviceGrants` rồi
   * truyền vào, không tra bên trong. Kho thiết bị không biết gì về bảng quyền,
   * và giữ nó như thế nghĩa là phép lọc vẫn là một hàm thuần kiểm được.
   */
  list(viewer: Viewer, granted?: Set<string>): Promise<DeviceRecord[]>;

  /** Một chiếc máy theo udid, nếu người này được thấy nó. */
  find(udid: string, viewer: Viewer, granted?: Set<string>): Promise<DeviceRecord | undefined>;

  /** Runner tắt hoặc mất liên lạc: máy của nó thành `offline`, không biến mất. */
  markRunnerOffline(runnerId: string, now?: Date): Promise<number>;
}
