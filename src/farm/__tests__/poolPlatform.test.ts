/**
 * Ba lượt farm liên tiếp chết ở cùng một chỗ, mỗi lượt sau khi đã dựng gói,
 * nén, upload APK, upload test package và upload testspec:
 *
 *   Không máy nào trong device pool chạy được APK này (1 máy đều không tương thích):
 *     - Apple iPhone 12: Android application requires an Android device.
 *
 * Config giữ `devicePools.android` trỏ tới một pool tên "ios-iphone12": chọn
 * pool lúc để iOS rồi chuyển sang Android, ô pool giữ nguyên ARN cũ và lượt
 * chạy ghi đè nó vào đúng khoá android.
 *
 * Nền tảng của pool vốn đã đọc được từ trước — listDevicePools phải giải các
 * ARN trong rules ra bảng thiết bị mới biết được. Dữ liệu có sẵn, chỉ là chưa
 * ai hỏi trước khi upload.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { poolPlatformMismatch } from '../target.js';

/** Nguyên văn từ project của người dùng. */
const pools = [
  { arn: 'arn:top', name: 'Top Devices', platforms: [] },
  { arn: 'arn:one', name: 'Only one device', platforms: ['android'] },
  { arn: 'arn:ios', name: 'ios-iphone12', platforms: ['ios'] },
];

describe('pool có khớp nền tảng không', () => {
  it('pool iOS mà chạy android thì từ chối, kèm tên pool', () => {
    const problem = poolPlatformMismatch(pools, 'arn:ios', 'android');
    assert.match(problem!, /"ios-iphone12" chỉ có máy ios/);
    assert.match(problem!, /Tạo pool từ thiết bị đã chọn/);
  });

  it('pool đúng nền tảng thì cho qua', () => {
    assert.equal(poolPlatformMismatch(pools, 'arn:one', 'android'), undefined);
    assert.equal(poolPlatformMismatch(pools, 'arn:ios', 'ios'), undefined);
  });

  /**
   * Không đọc được nền tảng thì KHÔNG chặn: mất mạng hay thiếu quyền không nên
   * biến thành một lời từ chối chạy.
   */
  it('pool không rõ nền tảng thì cho qua', () => {
    assert.equal(poolPlatformMismatch(pools, 'arn:top', 'android'), undefined);
  });

  it('không tìm thấy pool thì cũng cho qua, để lỗi thật nói sau', () => {
    assert.equal(poolPlatformMismatch(pools, 'arn:khong-co', 'android'), undefined);
  });
});
