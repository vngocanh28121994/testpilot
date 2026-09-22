/**
 * Runner tự cập nhật khi giao thức lệch major.
 *
 * Vì sao cần: runner sống trên máy người khác — phòng lab ở tầng dưới, laptop
 * của một người đang đi công tác. Nâng server lên `2.x` mà mỗi máy phải có
 * người vào cập nhật tay nghĩa là ngày nâng cấp là ngày cả đội dừng chạy test,
 * và một chiếc máy bị quên sẽ nằm im nhiều tuần mà không ai nhận ra — nó không
 * báo lỗi, nó chỉ thôi nhận job.
 *
 * **Server KHÔNG đọc cho runner biết phải chạy lệnh gì.** Nó chỉ nói phiên bản
 * giao thức của mình; runner tự quyết định cài gì, từ tên gói nằm trong cấu
 * hình CỦA CHÍNH NÓ. Ranh giới ấy là cả điểm của file này: một server bị chiếm
 * mà sai khiến được câu lệnh cài đặt trên hai mươi chiếc máy có Xcode và
 * keychain thì đã không còn là chuyện cập nhật nữa.
 *
 * Và nó KHÔNG tự khởi động lại chính mình. Nó cài xong rồi thoát với mã 75
 * (`EX_TEMPFAIL`), để bộ giám sát — systemd `Restart=always`, launchd
 * `KeepAlive` — dựng lại bản vừa cài. Tự `exec` lấy nghe gọn hơn và hỏng theo
 * những cách rất khó gỡ từ xa: tiến trình cũ còn giữ cổng, bản mới chết ngay
 * lúc khởi động và không còn ai dựng nó dậy nữa.
 */
import { spawn } from 'node:child_process';

/** Mã thoát "cài xong rồi, dựng tôi dậy". Không phải lỗi — xem chú thích trên. */
export const EXIT_UPDATED = 75;

export interface UpdatePlan {
  /** Gói npm cần cài. Từ cấu hình của runner, KHÔNG từ server. */
  packageName: string;
  /** Thẻ hoặc phiên bản. Mặc định `latest`. */
  tag: string;
}

/**
 * Runner này có tự cập nhật được không, và bằng gói nào.
 *
 * Không cấu hình gói thì trả `undefined` — và đó là mặc định. Một runner chạy
 * từ mã nguồn (`npm run runner` trong thư mục dự án) mà tự `npm install -g`
 * lên chính nó sẽ cài đè bản đang phát triển bằng bản đã phát hành, và người
 * ngồi đó sẽ mất một buổi để hiểu vì sao sửa mã không có tác dụng.
 */
export function planUpdate(env: NodeJS.ProcessEnv = process.env): UpdatePlan | undefined {
  const packageName = env.TESTPILOT_RUNNER_PACKAGE?.trim();
  if (!packageName) return undefined;
  return { packageName, tag: env.TESTPILOT_RUNNER_CHANNEL?.trim() || 'latest' };
}

export interface UpdateOutcome {
  ok: boolean;
  /** Câu để in ra log — thứ duy nhất người gỡ lỗi từ xa đọc được. */
  message: string;
}

/**
 * Cài bản mới.
 *
 * `install` tiêm được để test không phải gọi npm thật. Bản mặc định chạy đúng
 * một lệnh, với tên gói và thẻ đã qua phép kiểm ở dưới.
 */
export async function applyUpdate(
  plan: UpdatePlan,
  install: (plan: UpdatePlan) => Promise<number> = npmInstall,
): Promise<UpdateOutcome> {
  if (!SAFE_NAME.test(plan.packageName)) {
    return { ok: false, message: `Tên gói không hợp lệ: ${JSON.stringify(plan.packageName)}.` };
  }
  if (!SAFE_TAG.test(plan.tag)) {
    return { ok: false, message: `Thẻ phiên bản không hợp lệ: ${JSON.stringify(plan.tag)}.` };
  }

  const code = await install(plan).catch(() => -1);
  return code === 0
    ? { ok: true, message: `Đã cài ${plan.packageName}@${plan.tag}. Thoát để bộ giám sát dựng lại.` }
    : { ok: false, message: `Cài ${plan.packageName}@${plan.tag} hỏng (mã ${code}).` };
}

/**
 * Tên gói npm hợp lệ, kể cả scope. Kiểm dù nó đến từ biến môi trường của chính
 * máy này: biến môi trường của một dịch vụ nền được sinh ra từ file cấu hình,
 * và file cấu hình được sinh ra từ script của người khác.
 */
const SAFE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const SAFE_TAG = /^[\w.-]+$/;

function npmInstall(plan: UpdatePlan): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', `${plan.packageName}@${plan.tag}`], {
      stdio: 'inherit',
    });
    child.on('error', () => resolve(-1));
    child.on('close', (code) => resolve(code ?? -1));
  });
}
