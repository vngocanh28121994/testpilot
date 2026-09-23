/**
 * Artifact đi lên kho dùng chung, và đi ra bằng link có hạn.
 *
 * Ba route, và hình dạng của chúng đến từ một ràng buộc duy nhất: **runner
 * chạy trên laptop của một người.** Đưa khoá bucket cho từng chiếc laptop là
 * hai mươi bản sao của một bí mật ghi được vào kho của cả tổ chức, và không
 * thu lại được cái nào khi một máy bị mất. Nên server phát link có chữ ký cho
 * ĐÚNG những khoá nó tự dựng, runner ghi thẳng lên S3 bằng link ấy, rồi báo
 * lại nó đã ghi được gì.
 *
 * Đường ĐỌC cũng không đi qua server: video một lượt chạy dài hàng chục MB, và
 * đẩy nó qua server là trả tiền băng thông hai lần rồi giữ một kết nối mở suốt
 * thời gian đó. Server chỉ ký rồi chuyển hướng.
 *
 * Ở chế độ `embedded` cả ba route này TỪ CHỐI, và đó là câu trả lời đúng: file
 * đã nằm trên chính chiếc máy đang phục vụ trang web, và đẩy nó lên một kho ở
 * localhost để đọc lại từ đó là chép dữ liệu qua lại không vì gì cả.
 */
import { allows } from '../auth/roles.js';
import {
  artifactKey,
  mayReadArtifact,
  DEFAULT_URL_TTL_SECONDS,
} from '../storage/artifacts.js';
import { kindOf, type NewArtifact } from '../storage/artifactRepo.js';
import { contentTypeOf } from '../storage/upload.js';
import { json, readJson } from '../http.js';
import type { RouteTable } from './types.js';

/** Một lần xin tối đa ngần này link. Một lượt chạy dài xin nhiều lô. */
const MAX_FILES_PER_REQUEST = 500;

export const artifactRoutes: RouteTable = {
  /**
   * Runner xin link để ghi.
   *
   * Server dựng khoá, không nhận khoá. Đó là toàn bộ điểm: runner gửi đường
   * dẫn TƯƠNG ĐỐI trong thư mục lượt chạy, và `artifactKey()` gắn `orgId` với
   * `jobId` vào đầu. Nhận khoá do runner tự đặt nghĩa là một runner bị chiếm
   * ghi đè được report của tổ chức khác.
   */
  'POST /api/runner/artifacts/sign': async (req, res, _url, ctx) => {
    if (!ctx.artifacts) {
      return json(res, 501, {
        error: 'Server này chưa cấu hình kho artifact (TESTPILOT_S3_BUCKET).',
      });
    }
    const body = await readJson<{ jobId?: string; files?: string[] }>(req);
    const jobId = body.jobId?.trim();
    const files = (body.files ?? []).filter((file) => typeof file === 'string' && file.length > 0);
    if (!jobId || files.length === 0) {
      return json(res, 400, { error: 'Cần `jobId` và danh sách `files`.' });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      return json(res, 400, {
        error: `Một lần xin tối đa ${MAX_FILES_PER_REQUEST} file; hãy chia lô.`,
      });
    }

    // Job phải TỒN TẠI và phải là job của chính runner này. Thiếu phép kiểm
    // ấy thì một runner hợp lệ xin được link ghi vào thư mục của mọi job khác.
    const job = await ctx.repos.queue.find(jobId);
    if (!job) return json(res, 404, { error: 'Không tìm thấy job.' });
    if (job.runnerId && job.runnerId !== ctx.identity.userId) {
      return json(res, 403, { error: 'Job này do runner khác giữ.' });
    }

    const uploads = await Promise.all(files.map(async (file) => {
      const key = artifactKey(ctx.identity.orgId, jobId, file);
      const contentType = contentTypeOf(file);
      return {
        file,
        key,
        contentType,
        url: await ctx.artifacts!.store.signedPutUrl(key, contentType),
      };
    }));
    return json(res, 200, { uploads });
  },

  /**
   * Runner báo nó đã ghi xong những gì.
   *
   * Tách khỏi lúc xin link, cố ý: xin link không có nghĩa là ghi được. Mạng
   * rớt giữa chừng, đĩa đầy, S3 từ chối — và một hàng trong sổ nói "có file
   * này" trong khi kho không có gì là thứ tệ hơn không có hàng nào, vì màn
   * hình sẽ vẽ ra một liên kết hỏng.
   */
  'POST /api/runner/artifacts/done': async (req, res, _url, ctx) => {
    if (!ctx.artifacts) {
      return json(res, 501, { error: 'Server này chưa cấu hình kho artifact.' });
    }
    const body = await readJson<{
      jobId?: string; files?: Array<{ key?: string; bytes?: number }>;
    }>(req);
    const jobId = body.jobId?.trim();
    if (!jobId) return json(res, 400, { error: 'Cần `jobId`.' });

    const job = await ctx.repos.queue.find(jobId);
    if (!job) return json(res, 404, { error: 'Không tìm thấy job.' });
    if (job.runnerId && job.runnerId !== ctx.identity.userId) {
      return json(res, 403, { error: 'Job này do runner khác giữ.' });
    }

    const rows: NewArtifact[] = [];
    for (const file of body.files ?? []) {
      const key = file.key?.trim();
      // Khoá phải nằm trong tổ chức của chính runner. Nó do server phát ở
      // bước trước, nhưng "do ta phát" không phải là thứ kiểm được ở đây —
      // kiểm được là tiền tố.
      if (!key || !mayReadArtifact(ctx.identity.orgId, key)) continue;
      rows.push({
        jobId,
        orgId: ctx.identity.orgId,
        kind: kindOf(key),
        storageKey: key,
        ...(typeof file.bytes === 'number' ? { bytes: file.bytes } : {}),
      });
    }

    const recorded = await ctx.artifacts.repo.record(rows);
    return json(res, 200, { recorded });
  },

  /**
   * Mở một artifact: 302 sang link có chữ ký.
   *
   * `mayReadArtifact` là phép kiểm CUỐI CÙNG trước khi phát link, và nó là nơi
   * duy nhất còn nói không được: link ấy bỏ qua mọi tầng phân quyền phía trên
   * — đó chính là điểm của nó.
   */
  'GET /api/artifact': async (_req, res, url, ctx) => {
    if (!ctx.artifacts) {
      return json(res, 501, { error: 'Server này chưa cấu hình kho artifact.' });
    }
    const key = url.searchParams.get('key')?.trim();
    if (!key) return json(res, 400, { error: 'Cần `key`.' });

    if (!mayReadArtifact(ctx.identity.orgId, key)) {
      // 404 chứ không 403: phân biệt "file của tổ chức khác" với "file không
      // có thật" là nói cho người lạ biết tổ chức nào có lượt chạy nào.
      return json(res, 404, { error: 'Không có artifact này.' });
    }

    const ttl = allows(ctx.identity.role, 'maintainer')
      ? DEFAULT_URL_TTL_SECONDS
      // Người chỉ xem nhận link ngắn hơn: họ mở để đọc ngay, không để dán đi
      // chỗ khác. Link càng sống lâu thì càng dễ rời khỏi tay người được cấp.
      : Math.round(DEFAULT_URL_TTL_SECONDS / 3);

    const signed = await ctx.artifacts.store.signedUrl(key, ttl);
    res.writeHead(302, { location: signed, 'cache-control': 'no-store' });
    res.end();
  },
};
