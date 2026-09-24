/**
 * Một job mang snapshot chạy trên ĐÚNG snapshot ấy, trong một thư mục riêng.
 *
 * `JobSpec.snapshot` sinh ra để mỗi job "mang theo bản sao chứ không phải con
 * trỏ" — nhưng trước file này runner chưa từng đọc nó. Hậu quả có thật: một
 * workflow Studio sinh file feature trên MÁY CHỦ, còn chiếc điện thoại cắm ở
 * laptop người khác, và runner trên laptop ấy chỉ biết đọc thư mục `features/`
 * của chính nó — nơi file vừa sinh không hề tồn tại. Registry cũng vậy: bản
 * trên máy runner là "bản sao để chạy", và không có gì làm mới nó trước job.
 *
 * Cách làm: dựng `features/` và `registry/` từ snapshot vào một thư mục của
 * riêng job, rồi viết một config dẫn xuất trỏ ba đường dẫn vào đó. Mọi đường
 * dẫn khác giữ nguyên, vì `loadConfig` không đổi gốc đường dẫn theo vị trí
 * file config — chúng vẫn tính theo thư mục làm việc của runner, nên thư mục
 * `runs/`, bản build, file bí mật đều là của runner như thường.
 *
 * Vì sao cách ly thay vì chép thẳng vào `features/` của runner:
 *
 * - Cơ sở duyệt kịch bản coi file MỚI là đã duyệt hết, nhưng một file TRÙNG
 *   TÊN đã có mục cũ thì bị so hash, và kịch bản vừa sửa rơi về "chờ duyệt" —
 *   tức bị bỏ khỏi lượt chạy mà không ai để ý. Cơ sở duyệt riêng cho job thì
 *   không có mục cũ nào để so.
 * - Máy runner là laptop của một người. Một file lạ mọc ra trong thư mục của
 *   họ giữa lúc họ đang làm việc là thứ không ai nhờ.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JobSnapshot } from '../protocol/messages.js';

/** Nơi các thư mục job nằm, tính theo thư mục làm việc của runner. */
const JOBS_ROOT = '.testpilot/jobs';

export interface JobWorkspace {
  dir: string;
  /** Config dẫn xuất — truyền cho `run.ts` qua `--config`. */
  configFile: string;
  /** Tên file feature đã đặt vào workspace, theo thứ tự trong snapshot. */
  features: string[];
  /** Xoá thư mục job. Gọi trong `finally`; hỏng khi xoá không được làm hỏng job. */
  cleanup(): Promise<void>;
}

/**
 * Tên file an toàn để ghi — hoặc ném.
 *
 * Tên tới từ mạng. `../../.ssh/authorized_keys` là một "tên feature" hợp lệ
 * về mặt chuỗi, và ghi nó ra đĩa theo lệnh của control plane là trao cho bất
 * cứ ai chiếm được control plane quyền ghi file tuỳ ý lên máy của người khác.
 * Nên chỉ nhận đúng tên trần, đúng đuôi `.feature`, và không nhận gì khác.
 */
export function safeFeatureName(name: string): string {
  const base = path.basename(name);
  if (base !== name || !/^[\w.-]+\.feature$/.test(base) || base.startsWith('.')) {
    throw new Error(`Tên feature trong snapshot không hợp lệ: "${name}".`);
  }
  return base;
}

/** Mã job cũng đi vào đường dẫn, nên cùng một phép chặn. */
function safeJobDir(jobId: string): string {
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`Mã job không hợp lệ cho thư mục: "${jobId}".`);
  return jobId;
}

export async function prepareJobWorkspace(opts: {
  jobId: string;
  snapshot: JobSnapshot;
  /** Config thường của runner — nền để dẫn xuất. */
  configFile: string;
  /** Để test đặt vào thư mục tạm. */
  root?: string;
}): Promise<JobWorkspace> {
  const dir = path.resolve(opts.root ?? JOBS_ROOT, safeJobDir(opts.jobId));
  const featuresDir = path.join(dir, 'features');
  const registryDir = path.join(dir, 'registry');
  // Kiểm MỌI tên trước khi ghi byte nào: dừng giữa chừng là để lại nửa thư
  // mục job, và nửa thư mục thì không ai dọn.
  const names = opts.snapshot.features.map((feature) => safeFeatureName(feature.name));

  await rm(dir, { recursive: true, force: true });
  await mkdir(featuresDir, { recursive: true });
  await mkdir(registryDir, { recursive: true });

  await Promise.all(opts.snapshot.features.map((feature, i) =>
    writeFile(path.join(featuresDir, names[i]!), feature.content, 'utf8')));
  await writeFile(
    path.join(registryDir, 'elements.json'),
    JSON.stringify(opts.snapshot.registry ?? {}, null, 2) + '\n',
    'utf8',
  );

  // Đọc config THÔ rồi chỉ ghi đè ba đường dẫn. Parse qua schema rồi ghi lại
  // sẽ điền mọi giá trị mặc định vào file dẫn xuất — vô hại hôm nay, và là
  // một bản sao của các mặc định sẽ lệch ngay khi ai đó đổi chúng.
  const raw = JSON.parse(await readFile(path.resolve(opts.configFile), 'utf8')) as {
    paths?: Record<string, string>;
  };
  const derived = {
    ...raw,
    paths: {
      ...raw.paths,
      features: featuresDir,
      registry: path.join(registryDir, 'elements.json'),
      // Cơ sở duyệt RIÊNG, trống: file trong snapshot đã chỉ chứa kịch bản
      // được duyệt ở máy chủ, và một cơ sở trống coi mọi kịch bản mới là đã
      // duyệt. Dùng cơ sở của runner thì một file trùng tên cũ sẽ kéo kịch bản
      // vừa sửa về "chờ duyệt" — và chúng biến khỏi lượt chạy không một lời.
      scenarioReviewDb: path.join(registryDir, 'scenario-review.json'),
    },
  };
  const configFile = path.join(dir, 'testpilot.config.json');
  await writeFile(configFile, JSON.stringify(derived, null, 2) + '\n', 'utf8');

  return {
    dir,
    configFile,
    features: names,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined),
  };
}
