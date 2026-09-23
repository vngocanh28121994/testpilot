/**
 * Chọn kho cho ba sổ: runner, thiết bị, và quyền mượn máy.
 *
 * Vì sao cần file này: `repoFactory` đã chọn đúng giữa file và Postgres từ P0,
 * nhưng ba sổ của P3–P4 thì `server.ts` nối thẳng vào bản BỘ NHỚ ở cả hai chế
 * độ. Chúng có test, có bản Postgres, và bản Postgres chưa bao giờ được chạy —
 * kiểu nợ tệ nhất, vì mọi thứ đều xanh.
 *
 * Nó hỏng ở đâu thì chỉ chạy thật mới thấy, và nó đã hỏng thật: `job.runner_id`
 * có khoá ngoại tới bảng `runner`, nên một runner chỉ tồn tại trong RAM làm mọi
 * lệnh nhận job chết bằng `job_runner_id_fkey`. Triệu chứng nói về khoá ngoại,
 * nguyên nhân là một dòng nối dây.
 *
 * Ba sổ này KHÔNG bị giới hạn theo tổ chức lúc dựng, khác với `repoFactory`:
 * cửa quyền phải tra được token của runner TRƯỚC khi biết nó thuộc tổ chức
 * nào — chính dòng tìm được mới nói ra điều đó.
 */
import { localDeviceGrants } from './devices/memoryGrants.js';
import { localDevices } from './devices/memoryRegistry.js';
import { PgDeviceGrants } from './devices/pgGrants.js';
import { PgDeviceRegistry } from './devices/pgRegistry.js';
import { localRunners } from './runners/memoryRegistry.js';
import { PgRunnerRegistry } from './runners/pgRegistry.js';
import type { DeviceGrants } from './devices/grants.js';
import type { DeviceRegistry } from './devices/registry.js';
import type { RunnerRegistry } from './runners/registry.js';
import type { PoolProvider } from './db/pool.js';
import type { ServerMode } from './http.js';

export interface Stores {
  runners: RunnerRegistry;
  devices: DeviceRegistry;
  grants: DeviceGrants;
}

export interface StoreWiring {
  mode: ServerMode;
  pool?: PoolProvider;
  /**
   * Tổ chức mà sổ runner đọc/ghi.
   *
   * Một chỗ nhượng bộ có thật, và nói thẳng ra ở đây: `PgRunnerRegistry` bị
   * giới hạn theo tổ chức lúc dựng, còn `dispatch` thì dựng MỘT sổ cho cả
   * tiến trình. Với một bản triển khai một tổ chức — đúng hình dạng hôm nay —
   * điều đó đúng. Nhiều tổ chức là P5, và lúc ấy sổ phải dựng theo từng
   * request giống `repoFactory`.
   */
  orgId?: string;
}

export function storesFor(wiring: StoreWiring): Stores {
  // Không có pool thì dùng bản bộ nhớ, kể cả ở chế độ server: `repoFactory`
  // đã DỪNG cả tiến trình vì thiếu DB trước khi tới được đây, nên nhánh này
  // chỉ gặp trong test và trong một host tự dựng.
  if (wiring.mode !== 'server' || !wiring.pool) {
    // Các singleton dùng chung của tiến trình: `localRunners` được nạp token
    // từ biến môi trường lúc khởi động, và một bản thứ hai sẽ không có token
    // nào. Xem chú thích ở từng module.
    return { runners: localRunners, devices: localDevices, grants: localDeviceGrants };
  }

  const pool = wiring.pool;
  return {
    runners: new PgRunnerRegistry(pool, wiring.orgId ?? 'default'),
    devices: new PgDeviceRegistry(pool),
    grants: new PgDeviceGrants(pool),
  };
}
