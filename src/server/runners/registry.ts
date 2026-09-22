/**
 * Sổ runner: máy nào được phép nhận job, và của ai.
 *
 * P3.4 dùng MỘT token cho cả tổ chức. Nó đủ cho một phòng lab mà người quản
 * trị tự cắm máy, và hỏng ngay khi tới việc của P4: người dùng cắm điện thoại
 * vào laptop CỦA HỌ. Một bí mật dùng chung nghĩa là không thu hồi được một máy
 * mà không làm chết mọi máy khác, và không biết được job nào chạy trên máy nào
 * ngoài cái tên mà chính máy ấy tự khai.
 *
 * Nên mỗi runner có token riêng, và server chỉ giữ **hash**. Token hiện đúng
 * một lần lúc tạo; mất thì đổi cái mới chứ không đọc lại được. Đó là điều kiện
 * để câu "server bị đọc trộm CSDL" không kéo theo "mọi máy cá nhân bị chiếm".
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PrereqByPlatform } from '../../runner/prereqReport.js';

export type RunnerMode = 'embedded' | 'lab' | 'personal' | 'farm';
export type RunnerVisibility = 'shared' | 'private';
export type RunnerState = 'online' | 'offline' | 'draining';

export interface RunnerRecord {
  id: string;
  orgId: string;
  name: string;
  mode: RunnerMode;
  /** Chủ sở hữu — có với runner `personal`, rỗng với runner của tổ chức. */
  ownerUserId?: string;
  visibility: RunnerVisibility;
  state: RunnerState;
  lastSeenAt?: string;
  createdAt: string;
  /**
   * Máy này chạy được nền tảng nào, và vì sao không.
   *
   * Do chính runner ĐO và báo lên, không phải server suy ra: server không cắm
   * thiết bị nào và không có Appium. Cùng phép đo mà worker dùng để từ chối
   * job, nên màn hình và lời từ chối không thể nói hai chuyện khác nhau.
   *
   * Vắng mặt nghĩa là CHƯA ĐO, không phải "hỏng" — một runner farm không đo gì
   * cả, và một runner vừa khởi động thì chưa kịp.
   */
  prereq?: PrereqByPlatform;
}

export interface NewRunner {
  orgId: string;
  name: string;
  mode: RunnerMode;
  ownerUserId?: string;
  visibility: RunnerVisibility;
}

/**
 * Token sinh ra bằng 32 byte ngẫu nhiên của hệ điều hành.
 *
 * Không dùng `Math.random()` và không dựng từ thời gian: cả hai đoán được, và
 * thứ token này mở ra là quyền chạy lệnh trên máy của một người.
 */
export function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RunnerRegistry {
  /** Tạo runner và trả token **một lần duy nhất**. */
  create(runner: NewRunner): Promise<{ runner: RunnerRecord; token: string }>;
  /** Tra runner theo token. `undefined` nghĩa là không có hoặc đã thu hồi. */
  findByToken(token: string): Promise<RunnerRecord | undefined>;
  find(id: string): Promise<RunnerRecord | undefined>;
  list(): Promise<RunnerRecord[]>;
  /** Đổi token. Token cũ chết ngay lập tức. */
  rotate(id: string): Promise<string | undefined>;
  /**
   * Thu hồi: máy ấy không nhận job được nữa.
   *
   * KHÔNG xoá dòng: `job.runner_id` trỏ vào đây, và lịch sử "job này chạy ở
   * máy nào" là thứ người ta đọc sau sự cố. Xoá nó đi là xoá đúng câu trả lời
   * mà một cuộc điều tra cần.
   */
  revoke(id: string): Promise<boolean>;
  /** Runner vừa nói chuyện. Dùng để biết máy nào còn sống. */
  touch(id: string, at?: Date): Promise<void>;
  /** Runner báo tình trạng môi trường của máy nó. Xem `RunnerRecord.prereq`. */
  reportPrereq(id: string, prereq: PrereqByPlatform): Promise<void>;
  /** Đánh dấu `offline` những runner im lặng quá lâu. Trả về số đã đổi. */
  reapSilent(olderThanMs: number, now?: Date): Promise<number>;
}
