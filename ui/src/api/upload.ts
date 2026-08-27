import type { UploadBuildQuery, UploadBuildResponse } from '@core/ui/contracts.js';
import { ApiRequestError } from './client';
import { ROUTES } from './routes';
import { qs } from './client';

/**
 * Tải một bản build lên.
 *
 * HAI điều dễ làm sai, cả hai đều im lặng cho tới lúc Appium từ chối file:
 *
 * 1. Đây KHÔNG phải multipart. Server làm `pipeline(req, createWriteStream())`
 *    (server.ts:558) — body thô của request CHÍNH LÀ nội dung file. Bọc vào
 *    FormData sẽ ghi cả boundary `------WebKitFormBoundary...` vào đầu file
 *    .apk/.ipa, và thông báo lỗi sau đó không nhắc gì tới nguyên nhân.
 *
 * 2. Tham số đi ở query string, không phải trong body.
 *
 * Dùng XMLHttpRequest chứ không phải fetch: `fetch` với body là File KHÔNG có
 * sự kiện tiến trình, mà một file .ipa vài trăm MB sẽ trông y như bị treo.
 * Đây là màn hình duy nhất cần XHR, và cái giá là ~25 dòng.
 */
export function uploadBuild(
  file: File,
  params: Omit<UploadBuildQuery, 'filename'>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadBuildResponse> {
  const url = `${ROUTES.appUpload}${qs({ ...params, filename: file.name })}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.responseType = 'text';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };

    xhr.onload = () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText) as unknown;
      } catch {
        /* server luôn trả JSON; nếu không thì rơi xuống nhánh lỗi bên dưới */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as UploadBuildResponse);
      } else {
        const e = data as { error?: string; issues?: string[] };
        const issues = Array.isArray(e.issues) ? e.issues : [];
        reject(
          new ApiRequestError(
            issues.length ? issues.join('\n') : (e.error ?? xhr.statusText),
            url,
            xhr.status,
            issues,
          ),
        );
      }
    };

    xhr.onerror = () => reject(new ApiRequestError('Mất kết nối khi tải lên.', url, 0));
    xhr.onabort = () => reject(new ApiRequestError('Đã huỷ tải lên.', url, 0));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    // File là BodyInit hợp lệ — KHÔNG bọc FormData (xem ghi chú 1 ở trên).
    xhr.send(file);
  });
}
