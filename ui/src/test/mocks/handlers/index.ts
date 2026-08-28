import { stateHandlers } from './state';
import { healingHandlers } from './healing';
import { configHandlers } from './config';
import { prereqHandlers } from './prereq';
import { settingsHandlers } from './settings';
import { workflowHandlers } from './workflow';
import { farmHandlers } from './farm';

/**
 * Handler mặc định cho các route mà test thường chạm tới.
 *
 * Test nào cần hành vi khác thì `server.use()` ngay trong test đó — mỗi
 * `afterEach` đều gọi `resetHandlers()` nên override không rò sang test sau.
 *
 * Phase 4 bổ sung dần theo từng PR trang: farm, builds, scenario, workflow,
 * secrets. DoD của mỗi trang đã có ô "MSW handler cho mọi route trang đó gọi".
 */
export const handlers = [
  ...stateHandlers,
  ...healingHandlers,
  ...configHandlers,
  ...prereqHandlers,
  ...settingsHandlers,
  ...workflowHandlers,
  ...farmHandlers,
];
