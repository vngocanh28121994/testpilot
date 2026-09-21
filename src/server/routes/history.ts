/**
 * Lịch sử workflow.
 *
 * `recentRuns()` ở đây thay vì trong `server.ts` vì nó là cách đọc sổ lịch sử,
 * và P2.4 sẽ đổi nó sang bảng `job` — lúc ấy chỉ một file phải sửa. `state()`
 * cũng gọi nó, nên nó được export.
 */
import { History, stagesDone } from '../../core/history.js';
import type { HistoryResponse, RunHistoryEntry } from '../../ui/contracts.js';
import { json } from '../http.js';
import type { RouteTable } from './types.js';

export async function recentRuns(): Promise<RunHistoryEntry[]> {
  const history = await History.load();
  return history.list().map((r) => ({ ...r, stagesDone: stagesDone(r) }));
}

export const historyRoutes: RouteTable = {
  'GET /api/history': async (_req, res) => {
    const body: HistoryResponse = { runs: await recentRuns() };
    return json(res, 200, body);
  },
};
