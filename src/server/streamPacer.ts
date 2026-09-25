/**
 * Nhịp gửi luồng hình cho MỘT người xem: nhận không kịp thì bỏ bớt, không dồn.
 *
 * Nhiều người xem dùng chung một luồng từ máy (xem androidControl/iosControl),
 * và mỗi người nhận một bản sao qua kết nối của riêng họ. Trước file này, mọi
 * khung đều được `write` bất kể người xem có nhận kịp không. Một kết nối chậm
 * hơn tốc độ phát thì phần dư nằm lại trong bộ nhớ của máy chủ, mỗi giây một
 * nhiều hơn — màn hình trễ dần rồi trông như đứng hẳn. Đo được thật: hai máy
 * con cùng xem một iPhone (luồng ~1,7 MB/s), một máy nhận bình thường, máy kia
 * có hàng chờ gửi đầy 128 KB và "màn hình không phản hồi gì".
 *
 * Chú thích cũ ghi "8 KB/s không làm đầy được bộ đệm" — đúng thời
 * `screenrecord`, sai từ khi luồng iOS lên 20 khung/giây.
 *
 * Cách bỏ phụ thuộc vào loại ảnh:
 * - MJPEG (iOS): mỗi khung là một ảnh trọn vẹn — bỏ khung nào cũng được, và
 *   lúc bắt kịp thì gửi ngay ảnh MỚI NHẤT, để màn hình không đứng ở ảnh cũ.
 * - H.264 (Android): khung sau dựa vào khung trước, bỏ một mảnh là hỏng hình.
 *   Nên lúc bắt kịp thì báo `restart` (người xem dựng lại bộ giải mã) rồi gửi
 *   phần đầu luồng HIỆN TẠI — cấu hình và khung khoá gần nhất.
 *
 * Người xem có mạng tốt không bị ảnh hưởng: nhịp là của riêng từng kết nối.
 */

/** Hàng chờ gửi quá mức này thì coi như người xem nhận không kịp. */
export const BACKLOG_LIMIT_BYTES = 512 * 1024;

export interface PacerDeps {
  mode: 'mjpeg' | 'h264';
  /** Gửi một mảnh cho người xem (đã mã hoá theo cách của route). */
  write(chunk: Buffer): void;
  /** Báo người xem dựng lại bộ giải mã — chỉ H.264 cần. */
  restart(): void;
  /** Số byte còn nằm chờ gửi trên kết nối này. */
  backlog(): number;
  /** Gọi `fn` MỘT lần khi hàng chờ đã gửi hết. */
  onDrain(fn: () => void): void;
  /** Phần đầu luồng tại thời điểm gọi — xem `ScreenStreamHandle.resync`. */
  resync?(): Buffer | undefined;
  limitBytes?: number;
}

export interface Pacer {
  push(chunk: Buffer): void;
  /** Số mảnh đã bỏ cho người xem này — để đo, và để test. */
  dropped(): number;
}

export function streamPacer(deps: PacerDeps): Pacer {
  const limit = deps.limitBytes ?? BACKLOG_LIMIT_BYTES;
  let waiting = false;
  let latest: Buffer | undefined;
  let needResync = false;
  let dropped = 0;

  const hold = (chunk: Buffer): void => {
    dropped += 1;
    if (deps.mode === 'mjpeg') latest = chunk;
    else needResync = true;
  };

  const resume = (): void => {
    waiting = false;
    if (deps.mode === 'mjpeg') {
      const frame = latest;
      latest = undefined;
      if (frame) deps.write(frame);
      return;
    }
    if (needResync) {
      needResync = false;
      deps.restart();
      const head = deps.resync?.();
      if (head) deps.write(head);
    }
  };

  return {
    push(chunk) {
      if (waiting) {
        hold(chunk);
        return;
      }
      if (deps.backlog() > limit) {
        waiting = true;
        hold(chunk);
        deps.onDrain(resume);
        return;
      }
      deps.write(chunk);
    },
    dropped: () => dropped,
  };
}
