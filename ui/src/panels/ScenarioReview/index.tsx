import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Check, FileCode, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Pagination } from '@/components/Pagination';
import { StatusPill } from '@/components/StatusPill';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FilterChip } from '@/components/FilterChip';
import { TagFilter } from '@/components/TagFilter';
import {
  AlertDialog,
  AlertDialogActionButton,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { WorkflowGate } from './WorkflowGate';
import { ScenarioEditor } from './ScenarioEditor';
import { removeScenario } from './gherkin';
import type {
  FeatureMutationResponse,
  FeatureReviewBulkRequest,
  FeatureReviewRequest,
  FeatureSummary,
  StateResponse,
} from '@core/ui/contracts.js';

export interface ScenarioSearch {
  q?: string;
  file?: string;
  status?: 'pending' | 'approved' | 'rejected';
  tags?: string[];
  page?: number;
  /**
   * Lượt workflow mà Workflow Gate đang nói tới.
   *
   * Studio điền vào đây sau khi sinh xong (`panels/Studio`), giống hệt
   * `navigate('scenario-review', runId)` của bản cũ (app.js:903). Bỏ trống thì
   * gate tự chọn lượt đang tạm dừng gần nhất.
   */
  runId?: string;
}

const PAGE_SIZE = 25;

const PAGE_DESCRIPTION = 'Duyệt từng kịch bản trước khi workflow sinh test tự động.';

export default function ScenarioReviewPanel({ search }: { search: ScenarioSearch }) {
  const state = useAppState((s) => s);
  if (!state.data)
    return (
      <AppShell title="Kịch bản" description={PAGE_DESCRIPTION}>
        <p className="text-muted-foreground text-sm">
          {state.isError ? (state.error as Error).message : 'Đang tải kịch bản…'}
        </p>
      </AppShell>
    );
  return <ReviewBody state={state.data} search={search} />;
}

function ReviewBody({ state, search }: { state: StateResponse; search: ScenarioSearch }) {
  const navigate = useNavigate({ from: '/scenarios' });
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  // Ô từ khoá là ô DUY NHẤT giữ state cục bộ: gõ mỗi ký tự mà đẩy thẳng vào URL
  // thì mỗi phím là một lượt điều hướng. Mọi bộ lọc còn lại áp ngay, vì chúng
  // đổi theo cú bấm chứ không theo nhịp gõ.
  const [draftQuery, setDraftQuery] = useState(search.q ?? '');
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; feature: FeatureSummary; scenarioName: string } | null>(null);
  const [deleting, setDeleting] = useState<Array<{ feature: FeatureSummary; scenarioName: string }>>([]);
  const refresh = () => void client.invalidateQueries({ queryKey: ['state'] });
  const review = useMutation({
    mutationFn: (body: FeatureReviewRequest) =>
      api.post<FeatureMutationResponse>(ROUTES.featureReview, body),
    onSuccess: (data) => {
      showPomWarnings(data);
      toast.success('Đã lưu quyết định.');
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const bulk = useMutation({
    mutationFn: (body: FeatureReviewBulkRequest) =>
      api.post<FeatureMutationResponse>(ROUTES.featureReviewBulk, body),
    onSuccess: (data) => {
      setSelected([]);
      showPomWarnings(data);
      toast.success(`Đã duyệt ${data.reviewed ?? 0} kịch bản.`);
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const deleteScenarios = useMutation({
    mutationFn: async (items: Array<{ feature: FeatureSummary; scenarioName: string }>) => {
      const byFeature = new Map<string, { feature: FeatureSummary; names: string[] }>();
      for (const item of items) {
        const found = byFeature.get(item.feature.name) ?? { feature: item.feature, names: [] };
        found.names.push(item.scenarioName);
        byFeature.set(item.feature.name, found);
      }
      return Promise.all([...byFeature.values()].map(({ feature, names }) =>
        api.put<FeatureMutationResponse>(ROUTES.feature, {
          filename: feature.name,
          content: names.reduce((content, name) => removeScenario(content, name), feature.content),
          baseRevision: feature.revision,
        }),
      ));
    },
    onSuccess: (responses) => {
      setSelected([]);
      setDeleting([]);
      responses.forEach(showPomWarnings);
      toast.success('Đã xoá kịch bản; các kịch bản còn lại cần được duyệt lại.');
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const showPomWarnings = (data: FeatureMutationResponse) => {
    for (const warning of data.pomWarnings ?? []) toast.message(warning);
    if (data.pomWarning) toast.message(data.pomWarning);
  };

  const rows = useMemo(
    () =>
      state.features
        .flatMap((feature) => feature.scenarios.map((scenario) => ({ feature, scenario })))
        .filter(({ feature, scenario }) => {
          const haystack =
            `${feature.name} ${scenario.name} ${scenario.tags.join(' ')}`.toLowerCase();
          return (
            (!search.q || haystack.includes(search.q.toLowerCase())) &&
            (!search.file || feature.name === search.file) &&
            (!search.status || scenario.review?.status === search.status) &&
            (!search.tags?.length || search.tags.every((tag) => scenario.tags.includes(tag)))
          );
        }),
    [state.features, search],
  );
  const tagOptions = useMemo(
    () =>
      [
        ...new Set(
          state.features.flatMap((feature) =>
            feature.scenarios.flatMap((scenario) => scenario.tags),
          ),
        ),
      ].sort(),
    [state.features],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(search.page ?? 1, 1), pageCount);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItems = rows
    .filter(({ feature, scenario }) => selected.includes(idFor(feature.name, scenario.name)))
    .map(({ feature, scenario }) => ({ filename: feature.name, scenarioName: scenario.name }));
  const toggle = (id: string) =>
    setSelected((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    );
  /**
   * Áp một thay đổi bộ lọc vào URL.
   *
   * `replace: true` để mười lần chỉnh bộ lọc không thành mười mục lịch sử mà
   * người dùng phải bấm Back qua. `page: undefined` vì kết quả đã khác đi —
   * giữ nguyên trang 4 sau khi lọc là cách chắc chắn nhất để nhận về bảng rỗng.
   */
  const patch = (next: Partial<ScenarioSearch>) =>
    void navigate({
      replace: true,
      // Dạng hàm, KHÔNG phải `{ ...search, ...next }`. `search` là ảnh chụp của
      // lần render này; hai cú bấm nhanh hơn một lượt điều hướng thì cú thứ hai
      // đọc phải state cũ và ghi đè cú thứ nhất — tick hai tag liên tiếp trong
      // popover là mất một tag.
      search: (prev: ScenarioSearch) => ({ ...prev, page: undefined, ...next }),
    });

  /** Sửa danh sách tag trên state MỚI NHẤT của router — xem chú thích ở TagFilter. */
  const patchTags = (update: (prev: string[]) => string[]) =>
    void navigate({
      replace: true,
      search: (prev: ScenarioSearch) => {
        const tags = update(prev.tags ?? []);
        return { ...prev, page: undefined, tags: tags.length ? tags : undefined };
      },
    });

  const activeCount =
    (search.q ? 1 : 0) +
    (search.file ? 1 : 0) +
    (search.status ? 1 : 0) +
    (search.tags?.length ?? 0);
  const selectPage = (checked: boolean) =>
    setSelected((items) =>
      checked
        ? [
            ...new Set([
              ...items,
              ...pageRows.map(({ feature, scenario }) => idFor(feature.name, scenario.name)),
            ]),
          ]
        : items.filter(
            (id) =>
              !pageRows.some(({ feature, scenario }) => id === idFor(feature.name, scenario.name)),
          ),
    );
  const goToPage = (nextPage: number) =>
    void navigate({ search: { ...search, page: nextPage === 1 ? undefined : nextPage } });

  return (
    <AppShell
      title="Kịch bản"
      description={PAGE_DESCRIPTION}
      actions={
        <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
          <Plus className="size-4" /> Thêm kịch bản
        </Button>
      }
    >
      <section aria-label="Duyệt kịch bản" className="flex flex-1 flex-col gap-6">
        {/* Đứng TRÊN bộ lọc: nó là lý do người dùng đang ở màn này. */}
        <WorkflowGate state={state} runId={search.runId} />

        {/* Thanh công cụ, KHÔNG phải một thẻ có tiêu đề.
            Bộ lọc là thứ người ta liếc qua rồi chỉnh, không phải một mục nội
            dung cần được giới thiệu — hai dòng tiêu đề + mô tả ở trên bốn ô
            nhập là chi phí chrome cao hơn giá trị nó mang lại. */}
        <search
          aria-label="Bộ lọc kịch bản"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            {/* Ô tìm chiếm phần co giãn: nó là bộ lọc được dùng nhiều nhất, và
                nội dung của nó dài không đoán trước được — khác ba ô còn lại,
                vốn có tập giá trị hữu hạn và vừa trong bề rộng cố định. */}
            <div className="relative min-w-56 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                className="h-9 ps-9"
                value={draftQuery}
                aria-label="Tìm kịch bản"
                placeholder="Tìm theo tên kịch bản, feature file hoặc tag…"
                onChange={(event) => setDraftQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') patch({ q: draftQuery.trim() || undefined });
                  if (event.key === 'Escape') {
                    setDraftQuery('');
                    patch({ q: undefined });
                  }
                }}
                // Áp khi rời ô hoặc khi bấm Enter, không áp theo từng phím gõ.
                // Debounce theo nhịp gõ nghe hiện đại hơn, nhưng nó làm bảng
                // nhảy dưới tay người đang gõ dở một từ tiếng Việt có dấu.
                onBlur={() => patch({ q: draftQuery.trim() || undefined })}
              />
            </div>

            <select
              aria-label="Lọc theo feature file"
              className="input mt-0 h-9 w-auto min-w-40 max-w-56"
              value={search.file ?? ''}
              onChange={(event) => patch({ file: event.target.value || undefined })}
            >
              <option value="">Tất cả file</option>
              {state.features.map((feature) => (
                <option key={feature.name}>{feature.name}</option>
              ))}
            </select>

            <select
              aria-label="Lọc theo trạng thái duyệt"
              className="input mt-0 h-9 w-auto min-w-36"
              value={search.status ?? ''}
              onChange={(event) =>
                patch({ status: (event.target.value || undefined) as ScenarioSearch['status'] })
              }
            >
              <option value="">Mọi trạng thái</option>
              <option value="pending">Chờ duyệt</option>
              <option value="approved">Đã duyệt</option>
              <option value="rejected">Không duyệt</option>
            </select>

            <TagFilter
              value={search.tags ?? []}
              onChange={patchTags}
              taxonomy={state.tagTaxonomy}
              options={tagOptions}
            />

          </div>

          {/* Hàng chip tóm tắt: sau khi lọc xong, thứ đang có hiệu lực phải đọc
              được ở một chỗ. Nếu không, "bảng trống" và "bộ lọc quá hẹp" trông
              giống hệt nhau. */}
          {activeCount > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5">
              {search.q && (
                <FilterChip label={`Từ khoá: ${search.q}`} onRemove={() => { setDraftQuery(''); patch({ q: undefined }); }} />
              )}
              {search.file && (
                <FilterChip label={search.file} onRemove={() => patch({ file: undefined })} />
              )}
              {search.status && (
                <FilterChip
                  label={STATUS_LABELS[search.status]}
                  onRemove={() => patch({ status: undefined })}
                />
              )}
              {(search.tags ?? []).map((tag) => (
                <FilterChip
                  key={tag}
                  label={tag}
                  onRemove={() => patchTags((prev) => prev.filter((item) => item !== tag))}
                />
              ))}
              {/* Nút xoá tất cả đi CÙNG hàng chip, không nằm trên thanh lọc.
                  Ở trên thanh lọc nó phải ẩn/hiện theo trạng thái, và mỗi lần
                  bật tắt bộ lọc là cả hàng control nhảy ngang một đoạn. Hàng
                  chip vốn đã xuất hiện và biến mất nguyên khối, nên nút đi cùng
                  nó thì thanh lọc đứng yên. */}
              {/* `ms-auto`: dồn nút về sát mép phải hàng chip. Chip mọc từ trái
                  sang và số lượng thay đổi liên tục, nên nếu nút đi liền sau
                  chip cuối thì vị trí của nó nhảy theo mỗi lần thêm bớt — dính
                  mép phải là chỗ duy nhất nó đứng yên. */}
              <li className="ms-auto">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setDraftQuery('');
                    void navigate({
                      replace: true,
                      // `runId` không phải bộ lọc: xoá lọc không được làm
                      // Workflow Gate biến mất.
                      search: { runId: search.runId },
                    });
                  }}
                >
                  <X className="size-3.5" />
                  Xoá lọc ({activeCount})
                </Button>
              </li>
            </ul>
          )}
        </search>

        <Card aria-labelledby="scenarios-title">
          <CardHeader>
            <CardTitle id="scenarios-title">Kịch bản</CardTitle>
            <CardDescription>
              {rows.length} kịch bản khớp bộ lọc. Sửa file thì cả file phải được duyệt lại.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {selectedItems.length > 0 && (
              <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <span className="text-sm">Đã chọn {selectedItems.length} kịch bản</span>
                <div className="ms-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate({ items: selectedItems, decision: 'approve' })}
                  >
                    <Check className="size-4" />
                    Duyệt đã chọn ({selectedItems.length})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={bulk.isPending}
                    onClick={() => bulk.mutate({ items: selectedItems, decision: 'reject' })}
                  >
                    <X className="size-4" />
                    Không duyệt đã chọn
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleteScenarios.isPending}
                    onClick={() => setDeleting(selectedItems.flatMap((item) => {
                      const feature = state.features.find((entry) => entry.name === item.filename);
                      return feature ? [{ feature, scenarioName: item.scenarioName }] : [];
                    }))}
                  >
                    <Trash2 className="size-4" />
                    Xoá đã chọn ({selectedItems.length})
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="p-2">
                      <input
                        aria-label="Chọn tất cả trang này"
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={
                          pageRows.length > 0 &&
                          pageRows.every(({ feature, scenario }) =>
                            selected.includes(idFor(feature.name, scenario.name)),
                          )
                        }
                        onChange={(event) => selectPage(event.target.checked)}
                      />
                    </th>
                    <th className="p-2 font-medium">Feature file</th>
                    <th className="p-2 font-medium">Kịch bản</th>
                    <th className="p-2 font-medium">Tags</th>
                    <th className="p-2 text-right font-medium">Bước</th>
                    <th className="p-2 font-medium">Trạng thái</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr className="border-t">
                      <td colSpan={7} className="text-muted-foreground p-6 text-center">
                        Không có kịch bản khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                  {pageRows.map(({ feature, scenario }) => {
                    const id = idFor(feature.name, scenario.name);
                    return (
                        <tr key={id} className="border-t">
                          <td className="p-2">
                            <input
                              aria-label={`Chọn ${scenario.name}`}
                              type="checkbox"
                              className="accent-primary size-4"
                              checked={selected.includes(id)}
                              onChange={() => toggle(id)}
                            />
                          </td>
                          <td className="p-2">
                            <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                              <FileCode className="size-3.5 shrink-0" />
                              {feature.name}
                            </span>
                          </td>
                          <td className="p-2 font-medium">{scenario.name}</td>
                          <td className="p-2">
                            {scenario.tags.length > 0 ? (
                              <span className="flex flex-wrap gap-1">
                                {scenario.tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className="text-muted-foreground"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">{scenario.steps}</td>
                          <td className="p-2">
                            <StatusPill status={scenario.review?.status ?? 'pending'} />
                          </td>
                          <td className="p-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={review.isPending}
                                onClick={() =>
                                  review.mutate({
                                    filename: feature.name,
                                    scenarioName: scenario.name,
                                    decision: 'approve',
                                  })
                                }
                              >
                                Duyệt
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                disabled={review.isPending}
                                onClick={() =>
                                  review.mutate({
                                    filename: feature.name,
                                    scenarioName: scenario.name,
                                    decision: 'reject',
                                  })
                                }
                              >
                                Không duyệt
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditor({ mode: 'edit', feature, scenarioName: scenario.name });
                                }}
                              >
                                <Pencil className="size-4" />
                                Sửa kịch bản
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setDeleting([{ feature, scenarioName: scenario.name }])}
                              >
                                <Trash2 className="size-4" />
                                <span className="sr-only">Xoá {scenario.name}</span>
                              </Button>
                            </div>
                          </td>
                        </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} pageCount={pageCount} onPageChange={goToPage} />
          </CardContent>
        </Card>
        {editor && (
          <ScenarioEditor
            mode={editor.mode}
            target={editor.mode === 'edit' ? { feature: editor.feature, scenarioName: editor.scenarioName } : null}
            features={state.features}
            onClose={() => setEditor(null)}
          />
        )}
        <AlertDialog open={deleting.length > 0} onOpenChange={(open) => !open && setDeleting([])}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xoá {deleting.length} kịch bản?</AlertDialogTitle>
              <AlertDialogDescription>
                Các kịch bản bị xoá sẽ không thể khôi phục từ màn này. Thao tác sẽ ghi lại feature và đưa các kịch bản còn lại về chờ duyệt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton disabled={deleteScenarios.isPending}>Huỷ</AlertDialogCancelButton>
              <AlertDialogActionButton disabled={deleteScenarios.isPending} onClick={(event) => { event.preventDefault(); deleteScenarios.mutate(deleting); }}>
                {deleteScenarios.isPending ? 'Đang xoá…' : 'Xoá kịch bản'}
              </AlertDialogActionButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </AppShell>
  );
}

/**
 * Khoá là union hữu hạn chứ không phải `string`.
 *
 * `Record<string, …>` là index signature, và `noUncheckedIndexedAccess` khiến
 * mọi lần tra cứu trả về `| undefined` — kể cả khi khoá đã được thu hẹp. Ba
 * khoá viết thẳng ra thì phép tra cứu là toàn phần.
 */
const STATUS_LABELS: Record<NonNullable<ScenarioSearch['status']>, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Không duyệt',
};

function idFor(filename: string, scenarioName: string): string {
  return `${filename}::${scenarioName}`;
}
