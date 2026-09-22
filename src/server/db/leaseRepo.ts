/**
 * Lease ở chế độ `embedded`: giữ trong bộ nhớ của chính tiến trình server.
 *
 * Vì sao không phải một file JSON như registry: lease chỉ có nghĩa trong lúc
 * tiến trình còn sống. Một lease ghi xuống đĩa rồi tiến trình chết là một chiếc
 * máy bị giữ bởi một người không còn tồn tại, và lần khởi động sau phải đi dọn
 * — thêm một bước dọn cho một thứ đáng ra tự mất.
 *
 * Nhưng ngữ nghĩa thì GIỮ NGUYÊN, không nới lỏng: một máy vẫn chỉ một người
 * giữ, hết hạn vẫn bị thu hồi. Bản local có hai tab trình duyệt là đủ để hai
 * bên tranh nhau một chiếc điện thoại, nên "một người dùng thì khỏi cần loại
 * trừ" là một giả định sai. Nhờ giữ nguyên ngữ nghĩa, test parity so được bản
 * này với bản Postgres.
 */
import { randomUUID } from 'node:crypto';
import {
  LEASE_TTL_MS,
  LeaseTakenError,
  type Lease,
  type LeaseHolder,
  type LeaseRepo,
} from './repo.js';

function sameHolder(a: LeaseHolder, b: LeaseHolder): boolean {
  if (a.kind === 'job' && b.kind === 'job') return a.jobId === b.jobId;
  if (a.kind === 'human' && b.kind === 'human') return a.userId === b.userId;
  return false;
}

export class MemoryLeaseRepo implements LeaseRepo {
  /** Khoá theo `deviceId`, không theo `leaseId`: chính nó là phép loại trừ. */
  private readonly byDevice = new Map<string, Lease>();

  constructor(private readonly orgId = 'local') {}

  async acquire(deviceId: string, holder: LeaseHolder, now = new Date()): Promise<Lease> {
    await this.reap(now);
    const current = this.byDevice.get(deviceId);
    // Người đang giữ bấm lại thì coi như gia hạn, không phải xung đột: một cú
    // F5 không nên làm mất quyền điều khiển của chính người vừa lấy nó.
    if (current && !sameHolder(current.holder, holder)) throw new LeaseTakenError(current);

    const lease: Lease = {
      id: current?.id ?? randomUUID(),
      deviceId,
      orgId: this.orgId,
      holder,
      acquiredAt: current?.acquiredAt ?? now.toISOString(),
      expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
      renewedAt: current ? now.toISOString() : undefined,
    };
    this.byDevice.set(deviceId, lease);
    return lease;
  }

  async renew(leaseId: string, holder: LeaseHolder, now = new Date()): Promise<Lease | undefined> {
    await this.reap(now);
    for (const [deviceId, lease] of this.byDevice) {
      if (lease.id !== leaseId) continue;
      if (!sameHolder(lease.holder, holder)) return undefined;
      const next: Lease = {
        ...lease,
        expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
        renewedAt: now.toISOString(),
      };
      this.byDevice.set(deviceId, next);
      return next;
    }
    return undefined;
  }

  async release(leaseId: string, holder?: LeaseHolder): Promise<boolean> {
    for (const [deviceId, lease] of this.byDevice) {
      if (lease.id !== leaseId) continue;
      // `holder` rỗng là cưỡng chế nhả. Quyền gọi được việc đó kiểm ở route,
      // không ở đây — kho không biết vai, và không nên biết.
      if (holder && !sameHolder(lease.holder, holder)) return false;
      this.byDevice.delete(deviceId);
      return true;
    }
    return false;
  }

  async list(now = new Date()): Promise<Lease[]> {
    await this.reap(now);
    return [...this.byDevice.values()];
  }

  async find(deviceId: string, now = new Date()): Promise<Lease | undefined> {
    await this.reap(now);
    return this.byDevice.get(deviceId);
  }

  /**
   * Thu hồi lúc ĐỌC, không bằng một vòng lặp nền.
   *
   * Hệ quả đo được: một chiếc máy mà người giữ đã gập laptop trở lại rỗi ngay ở
   * lần có người hỏi tới nó — không phải chờ tới nhịp quét kế tiếp. Vòng lặp
   * nền vẫn cần cho việc chuyển job sang `interrupted` (P3.2), nhưng tính rỗi
   * thì không cần chờ nó.
   */
  async reap(now = new Date()): Promise<number> {
    let removed = 0;
    for (const [deviceId, lease] of this.byDevice) {
      if (Date.parse(lease.expiresAt) <= now.getTime()) {
        this.byDevice.delete(deviceId);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * MỘT bản duy nhất cho cả tiến trình.
 *
 * `fileRepos()` được dựng lại ở MỖI request (xem `repos:` trong
 * [src/ui/server.ts](../../ui/server.ts)), nên một `MemoryLeaseRepo` mới mỗi
 * lần nghĩa là không request nào thấy lease của request trước: lấy máy xong,
 * hỏi lại thì máy rỗi. Chạy thật mới lộ ra — mọi test đơn lẻ đều xanh, vì
 * chúng dùng một repo cho cả bài.
 *
 * Đây là lần thứ hai cùng một lỗi trong dự án: `OrphanTracker` từng bị dựng
 * hai bản sau khi tách route, và bản sau ghi đè bản trước. Bài học viết thành
 * một dòng code: thứ giữ trạng thái trong bộ nhớ thì có đúng một bản, và bản
 * ấy phải ở tầm module — cùng cách `sessions` trong
 * [auth/state.ts](../auth/state.ts) tồn tại.
 */
export const localLeases = new MemoryLeaseRepo();
