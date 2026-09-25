import { describe, expect, it } from 'vitest';
import { describeStop, jobIdsIn } from '../stopJobs';

const A = '0b6f1c2e-1111-4a2b-9c3d-000000000001';
const B = '0b6f1c2e-2222-4a2b-9c3d-000000000002';

describe('jobIdsIn', () => {
  it('lấy mã job từ dòng máy chủ in ra khi đặt job, kể cả có tiền tố tên máy', () => {
    expect(jobIdsIn([
      `[job] ${A} đã vào hàng đợi.`,
      'dòng log thường',
      `[laptop-binh] [job] ${B} đã vào hàng đợi.`,
      `[job] ${A} đã vào hàng đợi.`,
    ])).toEqual([A, B]);
  });

  it('không có dòng nào thì rỗng', () => {
    expect(jobIdsIn(['$ tsx src/cli/run.ts'])).toEqual([]);
  });
});

describe('describeStop', () => {
  it('job không dừng được thì cảnh báo bằng câu của máy chủ', () => {
    expect(describeStop({
      stopped: false,
      results: [{ jobId: A, outcome: 'elsewhere', message: 'Job đang chạy trên một máy khác.' }],
    })).toEqual({ tone: 'warn', text: 'Job đang chạy trên một máy khác.' });
  });

  it('đang dừng / đã huỷ / máy chủ cũ', () => {
    expect(describeStop({ stopped: true, results: [{ jobId: A, outcome: 'stopping', message: '' }] }).text)
      .toBe('Đang dừng lượt chạy.');
    expect(describeStop({ stopped: true, results: [{ jobId: A, outcome: 'cancelled', message: '' }] }).text)
      .toBe('Đã huỷ job đang chờ.');
    expect(describeStop({ stopped: true })).toEqual({ tone: 'ok', text: 'Đã gửi yêu cầu dừng test.' });
  });
});
