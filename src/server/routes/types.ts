/**
 * Hình dạng của một route sau khi tách khỏi `switch` khổng lồ trong
 * `src/ui/server.ts`.
 *
 * Bảng `Record<"METHOD /path", handler>` chứ không phải một router có regex:
 * hôm nay `handle()` so khớp chuỗi `"GET /api/state"` y như thế, nên giữ đúng
 * cách so khớp ấy là giữ đúng hành vi. Thêm một router mới vào giữa lúc đang
 * chuyển route là thay hai thứ cùng lúc rồi không biết cái nào làm hỏng.
 *
 * Route chuyển dần: `handle()` tra bảng trước, không thấy thì rơi vào `switch`
 * cũ. Nhờ vậy mỗi commit chuyển được vài route mà bản đang chạy không gián
 * đoạn. Xem [FARM-ROUTE-MAP.md](../../../FARM-ROUTE-MAP.md).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Identity } from '../auth/roles.js';
import type { Repos } from '../db/repo.js';
import type { DeviceRegistry } from '../devices/registry.js';
import type { DeviceGrants } from '../devices/grants.js';
import type { RunnerRegistry } from '../runners/registry.js';

/**
 * Thứ một handler cần mà nó không tự dựng được.
 *
 * Cố tình nhỏ. Mỗi trường thêm vào đây là một sợi dây buộc route với phần còn
 * lại của server, và mục đích của P1 là cắt bớt những sợi dây ấy — không phải
 * đổi chỗ chúng.
 */
export interface RouteContext {
  /** Cấu hình của user đang chạy; xem `personalConfig.ts`. */
  configFile: string;
  /**
   * Danh tính của hồ sơ cấu hình — ai đang chạy, và cấu hình đến từ đâu.
   *
   * Đường dẫn tuyệt đối KHÔNG nằm ở đây, và đó là chủ ý cũ: nó không bao giờ
   * rời khỏi server.
   */
  configProfile: { owner: string; source: 'personal' | 'environment' };
  /**
   * Ai đang gọi, sau khi đã qua cửa quyền.
   *
   * Handler không phải kiểm tra lại vai — `dispatch` đã làm. Cái nó cần là
   * `orgId` (để đọc đúng dữ liệu của tổ chức, từ P5) và `userId` (để ghi
   * `updated_by` và audit log). Ở chế độ embedded đây là `LOCAL_IDENTITY`.
   */
  identity: Identity;
  /**
   * Kho dữ liệu dùng chung, đã chọn sẵn theo chế độ và theo tổ chức.
   *
   * Handler không tự dựng lấy, và đó là điểm chính: ở chế độ embedded đây là
   * các file JSON, ở chế độ server là Postgres của ĐÚNG tổ chức người gọi. Một
   * handler tự `Registry.load()` sẽ đọc file trên đĩa server kể cả khi đang
   * phục vụ một tổ chức khác — và nó sẽ chạy, chỉ là trả nhầm dữ liệu.
   */
  repos: Repos;
  /**
   * Sổ runner — máy nào được phép nhận job, và của ai.
   *
   * Nằm cạnh `repos` chứ không nằm trong, vì nó KHÔNG bị giới hạn theo tổ
   * chức lúc dựng: cửa quyền phải tra được token trước khi biết runner ấy
   * thuộc tổ chức nào. Route thì chỉ thấy sổ của tổ chức người gọi.
   */
  runners: RunnerRegistry;
  /**
   * Sổ thiết bị — máy nào đang cắm ở đâu, và ai được nhìn thấy.
   *
   * Nguồn là báo cáo từ runner, không phải server tự hỏi `adb`: ở chế độ
   * server máy chủ web không cắm thiết bị nào.
   */
  devices: DeviceRegistry;
  /**
   * Ai được mượn chiếc máy riêng của ai.
   *
   * Đứng cạnh `devices` chứ không nằm trong, và lý do là tuổi thọ: sổ thiết bị
   * là ảnh chụp mười giây một lần, dựng lại được từ báo cáo của runner. Một
   * quyết định cho mượn thì không dựng lại được từ đâu — mất nó nghĩa là người
   * đang mượn máy bỗng thôi nhìn thấy nó, giữa buổi làm việc.
   */
  grants: DeviceGrants;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
) => Promise<void> | void;

/** Khoá là `"METHOD /path"`, đúng chuỗi mà `handle()` dựng ra. */
export type RouteTable = Record<string, RouteHandler>;

/**
 * Gộp các bảng, và ném khi có route trùng.
 *
 * Trùng khoá trong object literal là lỗi im lặng: bản sau thắng, và một route
 * biến mất mà không ai biết cho tới khi ai đó gọi nó.
 */
export function mergeTables(...tables: RouteTable[]): RouteTable {
  const merged: RouteTable = {};
  for (const table of tables) {
    for (const [route, handler] of Object.entries(table)) {
      if (merged[route]) throw new Error(`Route khai báo hai lần: ${route}`);
      merged[route] = handler;
    }
  }
  return merged;
}
