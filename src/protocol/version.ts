/**
 * Phiên bản giao thức server ↔ runner.
 *
 * Runner sống trên máy người khác, kể cả máy cá nhân của họ, nên không có ngày
 * nào mà "tất cả runner đều mới". Server phải biết nó đang nói chuyện với bản
 * nào, và nói ra khi hai bên không hiểu nhau — thay vì gửi một `JobSpec` có
 * trường mà bên kia lặng lẽ bỏ qua.
 *
 * Quy ước là semver, và ranh giới nằm ở MAJOR:
 *  - cùng major → chạy. Runner cũ hơn ở mức minor chỉ đơn giản là không biết
 *    những trường mới, và mọi trường mới phải là tuỳ chọn để điều đó an toàn.
 *  - khác major → server gửi `upgrade.required`, runner tự cập nhật rồi nối lại.
 *
 * Nói cách khác: tăng MINOR khi thêm thứ tuỳ chọn; tăng MAJOR khi đổi hoặc bỏ
 * một trường đang có, hay đổi nghĩa của nó.
 */
/**
 * 1.1.0 — thêm nhóm `control` (xem màn hình, chạm) vào mặt tiền runner.
 *
 * MINOR chứ không MAJOR: runner 1.0.x vẫn nhận mọi `JobSpec` như trước, chỉ là
 * không biết làm bốn động tác mới. Server phải chịu được câu trả lời "tôi không
 * biết việc đó" từ một runner cũ, và đó là điều kiện để tăng MINOR thay vì bắt
 * cả đội cập nhật cùng lúc.
 */
export const PROTOCOL_VERSION = '1.1.0';

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** `undefined` khi chuỗi không phải semver — người gọi quyết định xử lý sao. */
export function parseVersion(raw: string): SemVer | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Hai bên có nói chuyện được không.
 *
 * Runner MỚI hơn server ở mức minor vẫn chạy được: nó biết mọi thứ server biết,
 * cộng thêm vài thứ server chưa dùng tới. Chặn nó lại là bắt cả đội hạ cấp mỗi
 * khi một máy cập nhật sớm.
 *
 * Chuỗi phiên bản không đọc được thì KHÔNG tương thích. Đó là runner lạ hoặc
 * bản build hỏng, và đoán bừa ở đây nghĩa là gửi job thật cho nó.
 */
export function isCompatible(server: string, runner: string): boolean {
  const a = parseVersion(server);
  const b = parseVersion(runner);
  if (!a || !b) return false;
  return a.major === b.major;
}

/** Câu nói cho runner biết vì sao nó bị từ chối. Đi kèm `upgrade.required`. */
export function incompatibilityReason(server: string, runner: string): string {
  const parsed = parseVersion(runner);
  if (!parsed) {
    return `Runner báo phiên bản giao thức không đọc được: ${JSON.stringify(runner)}. `
      + `Server đang dùng ${server}.`;
  }
  return `Runner dùng giao thức ${runner}, server dùng ${server} — khác major nên không tương `
    + 'thích. Runner cần cập nhật rồi kết nối lại.';
}
