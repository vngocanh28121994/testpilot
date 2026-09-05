import { stateHandlers } from './state';
import { healingHandlers } from './healing';
import { configHandlers } from './config';
import { modelsHandlers } from './models';
import { preflightHandlers } from './preflight';
import { prereqHandlers } from './prereq';
import { settingsHandlers } from './settings';
import { vocabularyHandlers } from './vocabulary';

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
  ...modelsHandlers,
  ...preflightHandlers,
  ...prereqHandlers,
  ...settingsHandlers,
  ...vocabularyHandlers,
];
