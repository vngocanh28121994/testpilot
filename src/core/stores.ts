/**
 * Thư mục `registry/` đang trộn hai thứ khác hẳn nhau, và đó là gốc của phần
 * khó nhất khi đưa TestPilot lên nhiều máy.
 *
 * Có thứ mô tả **ý định**: element nào tồn tại, kịch bản nào được duyệt, lỗi
 * nào là known issue. Chúng thuộc về cả đội, và hai người sửa cùng lúc là một
 * xung đột cần phát hiện.
 *
 * Có thứ mô tả **một chiếc máy cụ thể**: locator vừa thắng trên đúng chiếc
 * iPhone đang cắm, build nào đang nằm trên máy nào. Đồng bộ chúng lên chỗ dùng
 * chung là nói dối — locator hợp lệ trên một thiết bị không hợp lệ ở nơi khác.
 *
 * Hôm nay cả hai nằm chung một thư mục và được ghi bằng cùng một cách, nên
 * không có chỗ nào trong mã nguồn nói ra sự khác biệt ấy. File này là chỗ đó.
 *
 * Xem [FARM-ARCHITECTURE.md](../../FARM-ARCHITECTURE.md) mục 4b.
 */

/**
 * Dữ liệu này thuộc về ai.
 *
 *  - `shared`: cả tổ chức. Lên DB, ghi có kiểm tra phiên bản, runner chỉ được
 *    ĐỀ XUẤT chứ không ghi thẳng.
 *  - `device`: chiếc máy đang cắm. Ở lại trên runner, không bao giờ đồng bộ.
 *  - `derived`: tính lại được từ những cái trên. Không cần đồng bộ, không cần
 *    giải quyết xung đột — cùng lắm là tính lại.
 */
export type StoreScope = 'shared' | 'device' | 'derived';

/**
 * Ghi kiểu gì, và đây mới là phần quyết định lúc nhiều máy cùng ghi.
 *
 *  - `document`: một bản ghi có phiên bản. Ghi đè cả tệp là đúng, miễn là kèm
 *    `baseRevision` để bản thua biết mình thua.
 *  - `event-log`: chỉ thêm. Ghi đè là xoá mất việc của người khác.
 *  - `counters`: số cộng dồn. Phải gộp DELTA, không phải ghi giá trị cuối —
 *    hai runner ghi giá trị cuối là hai bên xoá số của nhau, và tính năng phát
 *    hiện flaky nói sai mà không ai biết.
 */
export type StoreShape = 'document' | 'event-log' | 'counters';

export interface StoreDescriptor {
  /** Tên ổn định, dùng làm khoá khi lên DB. */
  id: string;
  /** Khoá trong `config.paths`, hoặc đường dẫn cố định khi store chưa có khoá riêng. */
  path: { key: string } | { fixed: string };
  scope: StoreScope;
  shape: StoreShape;
  /** Vì sao nó thuộc scope ấy. Bắt buộc: một phân loại không giải thích được là một phỏng đoán. */
  note: string;
}

export const STORES: readonly StoreDescriptor[] = [
  {
    id: 'elements',
    path: { key: 'registry' },
    scope: 'shared',
    shape: 'document',
    note: 'Element và locator đã duyệt — thứ đắt nhất project có. Runner gửi đề xuất, không ghi thẳng.',
  },
  {
    id: 'features',
    path: { key: 'features' },
    scope: 'shared',
    shape: 'document',
    note: 'File .feature. Đã có `baseRevision` ở PUT /api/feature, là mẫu cho mọi store shared khác.',
  },
  {
    id: 'feature-sources',
    path: { fixed: 'registry/feature-sources.json' },
    scope: 'shared',
    shape: 'document',
    note: 'Tài liệu nguồn của từng feature. Chưa có khoá trong paths — genspec/pipeline.ts tự ghép từ thư mục của scenarioReviewDb.',
  },
  {
    id: 'scenario-review',
    path: { key: 'scenarioReviewDb' },
    scope: 'shared',
    shape: 'document',
    note: 'Phê duyệt gắn với hash của kịch bản. Quyết định của con người, cần vai maintainer.',
  },
  {
    id: 'known-issues',
    path: { key: 'knownIssuesDb' },
    scope: 'shared',
    shape: 'document',
    note: 'Kịch bản đỏ vì sản phẩm chưa đáp ứng. Quyết định của con người.',
  },
  {
    id: 'actions',
    path: { key: 'actionsDb' },
    scope: 'shared',
    shape: 'document',
    note: 'Macro hành động đã được người duyệt.',
  },
  {
    id: 'duplicate-review',
    path: { key: 'duplicateReviewDb' },
    scope: 'shared',
    shape: 'document',
    note: 'Quyết định "gộp" / "không phải trùng" cho các cặp element nghi trùng vai.',
  },
  {
    id: 'healing',
    path: { key: 'healingDb' },
    scope: 'shared',
    shape: 'event-log',
    note: 'Sổ ghi từng lần heal. Ghi đè cả tệp như hôm nay là xoá mất lần heal của runner khác.',
  },
  {
    id: 'flake',
    path: { key: 'flakeDb' },
    scope: 'shared',
    shape: 'counters',
    note: 'Số lần chạy và số lần hỏng. Phải cộng dồn delta; ghi giá trị cuối là hai runner xoá số của nhau.',
  },
  {
    id: 'history',
    path: { fixed: 'registry/history.json' },
    scope: 'shared',
    shape: 'event-log',
    note: 'Lịch sử workflow. Lên bảng job + job_event ở P2.4; đường dẫn đang cố định trong History.load().',
  },
  {
    id: 'runtime-registry',
    path: { fixed: 'registry/runtime-registry.json' },
    scope: 'device',
    shape: 'document',
    note: 'Locator vừa thắng trên ĐÚNG chiếc máy này. Đồng bộ lên chỗ dùng chung là đem một sự thật cục bộ áp cho máy khác.',
  },
  {
    id: 'device-env',
    path: { key: 'deviceEnvDb' },
    scope: 'device',
    shape: 'document',
    note: 'Máy nào đang giữ build của môi trường nào. Vô nghĩa ngoài phạm vi chiếc máy ấy — đã gitignore, đúng hướng.',
  },
  {
    id: 'coverage',
    path: { fixed: 'registry/coverage' },
    scope: 'derived',
    shape: 'document',
    note: 'Đối chiếu requirement ↔ kịch bản, tính lại được từ feature và tài liệu nguồn.',
  },
] as const;

export function storeById(id: string): StoreDescriptor | undefined {
  return STORES.find((store) => store.id === id);
}

/** Những store được phép đi lên chỗ dùng chung. Mọi đường đồng bộ phải hỏi hàm này. */
export function sharedStores(): StoreDescriptor[] {
  return STORES.filter((store) => store.scope === 'shared');
}

/** Những store ở lại trên máy chạy test, kể cả khi máy ấy là của người dùng. */
export function deviceStores(): StoreDescriptor[] {
  return STORES.filter((store) => store.scope === 'device');
}

/** Đường dẫn tệp/thư mục của store, theo `config.paths` khi store có khoá riêng. */
export function storePath(store: StoreDescriptor, paths: Record<string, string>): string {
  return 'fixed' in store.path ? store.path.fixed : paths[store.path.key] ?? '';
}
