/**
 * Artifact của một lượt chạy: report, ảnh, video, trace, log.
 *
 * Hôm nay chúng nằm trên đĩa của máy chạy test, trong `runs/`. Với một người
 * trên một máy thì đó là chỗ đúng — file nằm cạnh thứ sinh ra nó, và mở bằng
 * trình duyệt là xong.
 *
 * Với runner ở máy khác thì không: file nằm trên máy của người chạy, còn người
 * đọc report ngồi ở chỗ khác. Nên artifact phải đi lên một kho dùng chung, và
 * kho ấy là S3 (hoặc MinIO, nói đúng cùng API).
 *
 * Hai điều quyết định hình dạng của interface này:
 *
 *  1. **Khoá mang `orgId` ở đầu.** Không phải để cho đẹp: nó là thứ khiến một
 *     lỗi phân quyền ở tầng trên vẫn không cho tổ chức A đọc file của B, vì
 *     đường dẫn đơn giản là không trỏ tới đó.
 *  2. **Đọc bằng link có hạn, không bằng cách đẩy file qua server.** Video một
 *     lượt chạy dài hàng chục MB; đẩy qua server là trả tiền băng thông hai
 *     lần và giữ một kết nối mở suốt thời gian đó.
 */
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ArtifactRef {
  /** `<orgId>/<jobId>/<đường dẫn>` — org đứng đầu, có chủ ý. */
  key: string;
  bytes?: number;
  contentType?: string;
}

export interface ArtifactStore {
  put(key: string, body: Buffer | Readable, contentType?: string): Promise<ArtifactRef>;
  /** Link đọc trực tiếp, hết hạn sau `ttlSeconds`. */
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
  list(prefix: string): Promise<ArtifactRef[]>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export interface S3Options {
  bucket: string;
  region: string;
  /** MinIO hoặc S3 tương thích. Bỏ trống khi dùng AWS S3 thật. */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export function s3OptionsFromEnv(env = process.env): S3Options | undefined {
  const bucket = env.TESTPILOT_S3_BUCKET?.trim();
  if (!bucket) return undefined;
  return {
    bucket,
    region: env.TESTPILOT_S3_REGION?.trim() || 'us-east-1',
    ...(env.TESTPILOT_S3_ENDPOINT?.trim() ? { endpoint: env.TESTPILOT_S3_ENDPOINT.trim() } : {}),
    ...(env.TESTPILOT_S3_ACCESS_KEY?.trim() ? { accessKeyId: env.TESTPILOT_S3_ACCESS_KEY.trim() } : {}),
    ...(env.TESTPILOT_S3_SECRET_KEY?.trim() ? { secretAccessKey: env.TESTPILOT_S3_SECRET_KEY.trim() } : {}),
  };
}

/** Hạn mặc định của link đọc: đủ xem một video dài, không đủ để phát tán. */
export const DEFAULT_URL_TTL_SECONDS = 15 * 60;

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      // MinIO phục vụ bucket theo ĐƯỜNG DẪN (`/bucket/key`), không theo tên
      // miền con như S3. Thiếu cờ này thì SDK gọi `http://bucket.localhost` —
      // một tên miền không phân giải được, và lỗi báo về là DNS chứ không phải
      // S3, nên người đọc đi tìm sai chỗ.
      ...(opts.endpoint ? { forcePathStyle: true } : {}),
      ...(opts.accessKeyId && opts.secretAccessKey
        ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } }
        : {}),
    });
  }

  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<ArtifactRef> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.opts.bucket,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    }));
    return { key, ...(contentType ? { contentType } : {}) };
  }

  async signedUrl(key: string, ttlSeconds = DEFAULT_URL_TTL_SECONDS): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  async list(prefix: string): Promise<ArtifactRef[]> {
    const out: ArtifactRef[] = [];
    let token: string | undefined;
    do {
      // Phân trang thật, không lấy 1000 cái đầu rồi thôi: một lượt chạy dài có
      // hàng nghìn ảnh, và "thiếu ảnh cuối" là kiểu hỏng không ai báo cáo vì
      // không ai biết nó thiếu.
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.opts.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }));
      for (const item of page.Contents ?? []) {
        if (item.Key) out.push({ key: item.Key, ...(item.Size != null ? { bytes: item.Size } : {}) });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.opts.bucket,
      Key: key,
    }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as Readable) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks);
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}

/**
 * Đường dẫn của một artifact.
 *
 * Một hàm thay vì ghép chuỗi tại chỗ, vì thứ tự các đoạn LÀ mô hình bảo mật:
 * `orgId` đứng đầu nên mọi tiền tố liệt kê đều bị giới hạn trong một tổ chức.
 * Ghép tay ở mười chỗ thì chỉ cần một chỗ đảo thứ tự là mất tính chất ấy, và
 * không có gì báo.
 */
export function artifactKey(orgId: string, jobId: string, relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '');
  if (!orgId || !jobId) throw new Error('artifactKey cần cả orgId và jobId.');
  return `${orgId}/${jobId}/${clean}`;
}

/** Đọc `orgId` từ một khoá — để kiểm tra trước khi phát link. */
export function orgOfKey(key: string): string | undefined {
  const [orgId] = key.split('/');
  return orgId || undefined;
}

/**
 * Người này có được đọc khoá kia không.
 *
 * Phép kiểm cuối cùng trước khi phát một link có chữ ký. Link ấy bỏ qua mọi
 * tầng phân quyền phía trên — đó là điểm của nó — nên chỗ này là nơi duy nhất
 * còn có thể nói không.
 */
export function mayReadArtifact(orgId: string, key: string): boolean {
  return Boolean(orgId) && orgOfKey(key) === orgId;
}
