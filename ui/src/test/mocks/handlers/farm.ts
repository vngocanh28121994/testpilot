import { http, HttpResponse } from 'msw';
import type { AwsStatus } from '@core/ui/contracts.js';
import { ROUTES } from '@/api/routes';

/**
 * Bốn trạng thái AWS mà thẻ "Kết nối AWS" phải phân biệt được.
 *
 * Trước đây cả ba trạng thái hỏng đều rơi vào cùng một ngõ cụt trên màn hình:
 * một câu lỗi tiếng Anh của SDK và một nút "Kiểm tra lại" bấm mãi vẫn ra đúng
 * câu đó. Fixture tách chúng ra để test giữ được sự khác biệt đó.
 */
export const awsFixtures = {
  /** Có phiên để đăng nhập, nhưng máy chưa cài AWS CLI. */
  cliMissing: {
    ok: false,
    canLogin: false,
    source: '~/.aws hoặc IAM role của máy',
    reason: 'Could not load credentials from any providers',
    login: { kind: 'legacy', command: 'aws login --region us-west-2', cliFound: false },
  },
  /** Sẵn sàng: nút đăng nhập phải hiện, và phải nói ra lệnh nó sắp chạy. */
  ready: {
    ok: false,
    canLogin: true,
    source: 'profile "tcbs"',
    reason: 'The SSO session associated with this profile has expired',
    login: {
      kind: 'sso',
      command: 'aws sso login --profile tcbs',
      cliFound: true,
      profile: 'tcbs',
    },
  },
  /** Credential từ biến môi trường: không có phiên nào để đăng nhập ở đây. */
  noSession: {
    ok: false,
    canLogin: false,
    source: 'biến môi trường',
    reason: 'The security token included in the request is expired',
  },
  /** Kết nối được, nhưng credential sắp hết hạn giữa chừng một lượt chạy. */
  expiringSoon: {
    ok: true,
    canLogin: true,
    source: 'profile "tcbs"',
    keyHint: 'ASIA',
    expiresAt: '2026-08-28T10:00:00.000Z',
    expiresInMinutes: 7,
    login: { kind: 'sso', command: 'aws sso login --profile tcbs', cliFound: true },
  },
  /** Access key tĩnh: không có hạn dùng để nói. */
  stable: {
    ok: true,
    canLogin: false,
    source: 'biến môi trường',
    keyHint: 'AKIA',
  },
} satisfies Record<string, AwsStatus>;

export const farmHandlers = [
  http.get(ROUTES.aws, () => HttpResponse.json(awsFixtures.cliMissing)),
];
