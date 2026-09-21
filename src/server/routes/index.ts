/**
 * Bảng route của control plane — một nguồn duy nhất.
 *
 * `server.ts` và bài test cùng đọc từ đây. Lúc đầu mỗi bên tự gộp lấy, và
 * chuyện xảy ra đúng như phải xảy ra: chuyển thêm ba nhóm route thì test vẫn
 * gộp theo danh sách cũ, thấy tổng số route hụt đi 5 và báo đỏ vì một lý do
 * không có thật. Một danh sách, hai nơi đọc.
 */
import { actionsRoutes } from './actions.js';
import { buildsRoutes } from './builds.js';
import { catalogRoutes } from './catalog.js';
import { configRoutes } from './config.js';
import { featureRoutes } from './feature.js';
import { healingRoutes } from './healing.js';
import { historyRoutes } from './history.js';
import { prereqRoutes } from './prereq.js';
import { runRoutes } from './run.js';
import { studioRoutes } from './studio.js';
import { mergeTables, type RouteTable } from './types.js';

export const allRoutes: RouteTable = mergeTables(
  actionsRoutes,
  buildsRoutes,
  catalogRoutes,
  configRoutes,
  featureRoutes,
  healingRoutes,
  historyRoutes,
  prereqRoutes,
  runRoutes,
  studioRoutes,
);
