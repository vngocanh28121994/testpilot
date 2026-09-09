import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Check, FileCode, Filter, MoreHorizontal, Pencil, Plus, TriangleAlert, X } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { Dropdown } from '@/components/Dropdown';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field } from '@/components/Field';
import { Pagination } from '@/components/Pagination';
import { StatusPill } from '@/components/StatusPill';
import { TagChip } from '@/components/TagChip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import { WorkflowGate } from './WorkflowGate';
import { ScenarioEditor, type CreateTarget } from './ScenarioEditor';
import {
  appendScenario,
  extractScenario,
  featureFileName,
  newFeatureContent,
  replaceScenario,
  scenarioNames,
} from '@/lib/gherkin';
import type {
  KnownIssueRequest,
  KnownIssueResponse,
  FeatureMutationResponse,
  FeatureReviewBulkRequest,
  FeatureReviewRequest,
  FeatureSaveRequest,
  StateResponse,
} from '@core/ui/contracts.js';

export interface ScenarioSearch {
  q?: string;
  file?: string;
  status?: 'pending' | 'approved' | 'rejected';
  tags?: string[];
  page?: number;
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
  /**
   * Phiên sửa đang mở, hoặc null. Giữ cả tên file và tên kịch bản vì lúc lưu
   * phải ghép khối đã sửa trở lại đúng chỗ trong nội dung file mới nhất.
   */
  const [editing, setEditing] = useState<{
    filename: string;
    scenarioName: string;
    block: string;
  } | null>(null);
  /** Chỉ khác null khi đang thêm kịch bản mới. */
  const [creating, setCreating] = useState<{ block: string; target: CreateTarget } | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ['state'] });
  const review = useMutation({
    mutationFn: (body: FeatureReviewRequest) =>
      api.post<FeatureMutationResponse>(ROUTES.featureReview, body),
    onSuccess: () => {
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
      toast.success(`Đã duyệt ${data.reviewed ?? 0} kịch bản.`);
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  /**
   * Nhãn Known issue: kịch bản đỏ vì sản phẩm chưa đáp ứng, không phải vì test
   * hỏng. Chỉ con người gắn được — không có đường nào cho máy tự gắn.
   */
  const knownIssue = useMutation({
    mutationFn: (body: KnownIssueRequest) =>
      api.post<KnownIssueResponse>(ROUTES.featureKnownIssue, body),
    onSuccess: (data) => {
      toast.success(data.removed ? 'Đã gỡ nhãn Known issue.' : 'Đã gắn nhãn Known issue.');
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const save = useMutation({
    mutationFn: (body: FeatureSaveRequest) =>
      api.put<FeatureMutationResponse>(ROUTES.feature, body),
    onSuccess: () => {
      setEditing(null);
      setCreating(null);
      toast.success('Đã lưu kịch bản; nó cần được duyệt lại.');
      refresh();
    },
    onError: (error) => toast.error((error as Error).message),
  });

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
  const applyFilters = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const tag = String(data.get('tag') || '');
    void navigate({
      search: {
        q: String(data.get('q') || '') || undefined,
        file: String(data.get('file') || '') || undefined,
        status: (String(data.get('status') || '') || undefined) as ScenarioSearch['status'],
        tags: tag ? [tag] : undefined,
        page: undefined,
      },
    });
  };
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
        <Link to="/scenarios" search={{}} className="text-xs underline">
          Xoá bộ lọc
        </Link>
      }
    >
      <section aria-label="Duyệt kịch bản" className="flex flex-1 flex-col gap-6">
        {/* Trên cùng, không dưới bảng: một workflow đang dừng là việc cần làm
            ngay, còn bộ lọc thì lúc nào cũng ở đó. */}
        <WorkflowGate runs={state.runs} />

        <Card aria-labelledby="filter-title">
          <CardHeader>
            <CardTitle id="filter-title">Bộ lọc</CardTitle>
            <CardDescription>Các điều kiện dưới đây được AND với nhau.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid items-end gap-4 md:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters(event.currentTarget);
              }}
            >
              <Field label="Từ khoá">
                <Input name="q" defaultValue={search.q} placeholder="Tìm kịch bản…" />
              </Field>
              <Field label="Feature file">
                <Dropdown
                  name="file"
                  aria-label="Feature file"
                  defaultValue={search.file ?? ''}
                  className="mt-0"
                  options={[
                    { value: '', label: 'Tất cả file' },
                    ...state.features.map((feature) => ({
                      value: feature.name,
                      label: feature.name,
                    })),
                  ]}
                />
              </Field>
              <Field label="Trạng thái">
                <Dropdown
                  name="status"
                  aria-label="Trạng thái"
                  defaultValue={search.status ?? ''}
                  className="mt-0"
                  options={[
                    { value: '', label: 'Tất cả trạng thái' },
                    { value: 'pending', label: 'Chờ duyệt' },
                    { value: 'approved', label: 'Đã duyệt' },
                    { value: 'rejected', label: 'Không duyệt' },
                  ]}
                />
              </Field>
              <Field label="Tag">
                <Dropdown
                  name="tag"
                  aria-label="Lọc theo tag"
                  defaultValue={search.tags?.[0] ?? ''}
                  className="mt-0"
                  options={[
                    { value: '', label: 'Tất cả tag' },
                    ...tagOptions.map((tag) => ({ value: tag, label: tag })),
                  ]}
                />
              </Field>
              <Button type="submit">
                <Filter className="size-4" />
                Lọc
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card aria-labelledby="scenarios-title">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1.5">
                <CardTitle id="scenarios-title">Kịch bản</CardTitle>
                <CardDescription>
                  {rows.length} kịch bản khớp bộ lọc. Sửa kịch bản thì nó phải được duyệt lại.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setCreating({
                    block: ['  Scenario: Nhập tên kịch bản', '    Given I open the app'].join('\n'),
                    target: {
                      filename: state.features[0]?.name ?? '',
                      newTitle: '',
                    },
                  })
                }
              >
                <Plus className="size-4" />
                Thêm kịch bản
              </Button>
            </div>
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
                    // Sửa kịch bản làm đổi contentHash, và syncFile() đưa entry
                    // về `pending` ngay lúc đó — nên `approved` ở đây luôn có
                    // nghĩa "đã duyệt VÀ còn đúng nội dung này". Không còn gì
                    // để duyệt nữa.
                    const status = scenario.review?.status ?? 'pending';
                    return (
                      <Fragment key={id}>
                        <tr className="border-t">
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
                                  <TagChip key={tag} tag={tag} />
                                ))}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2 text-right tabular-nums">{scenario.steps}</td>
                          <td className="p-2">
                            {/* Known issue là một TRẠNG THÁI của kịch bản, nên
                                nó đứng cạnh trạng thái duyệt chứ không nằm lẫn
                                trong cột hành động. `whitespace-nowrap` vì hai
                                chữ bị bẻ làm hai dòng trông như một lỗi hiển
                                thị, mà cột này vốn hẹp. */}
                            <div className="flex flex-wrap items-center gap-1">
                              <StatusPill status={scenario.review?.status ?? 'pending'} />
                              {scenario.knownIssue && (
                                <span
                                  title={scenario.knownIssue.note}
                                  className="bg-status-flaky/15 text-status-flaky inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                                >
                                  <TriangleAlert className="size-3 shrink-0" />
                                  Known issue
                                </span>
                              )}
                              {scenario.knownIssueStale && (
                                <span
                                  title="Kịch bản đã đổi kể từ khi gắn nhãn, nên nhãn hết hiệu lực."
                                  className="text-muted-foreground text-xs whitespace-nowrap"
                                >
                                  nhãn cũ
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2">
                            {/* Một hành động chính, phần còn lại nằm trong menu.
                                Bốn nút bày hết ra hàng thì mỗi hàng thành một
                                thanh công cụ: mắt phải đọc lại cùng bốn nhãn ở
                                mỗi dòng, và cột hành động nuốt mất chỗ của
                                chính nội dung kịch bản. Bản cũ chỉ để nút Duyệt
                                cộng một nút "⋯". */}
                            <div className="flex items-center justify-end gap-1">
                              {/* Kịch bản đã duyệt thì không mời duyệt nữa. Nút
                                  đứng đó không làm gì, và tệ hơn: nó khiến một
                                  hàng đã xong trông y hệt hàng còn phải xử lý,
                                  đúng thứ mà cột Trạng thái vừa nói ngược lại.
                                  Đã "không duyệt" thì duyệt lại vẫn có nghĩa,
                                  nên hàng đó giữ nút. */}
                              {status !== 'approved' && (
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
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" aria-label={`Hành động khác cho "${scenario.name}"`}>
                                    <MoreHorizontal className="size-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      setEditing({
                                        filename: feature.name,
                                        scenarioName: scenario.name,
                                        block: extractScenario(feature.content, scenario.name),
                                      })
                                    }
                                  >
                                    <Pencil className="size-4" />
                                    Sửa kịch bản
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      if (scenario.knownIssue) {
                                        knownIssue.mutate({ scenarioId: scenario.id, remove: true });
                                        return;
                                      }
                                      // Lý do là bắt buộc: một nhãn không kèm lý
                                      // do thì năm sau không ai giải thích được
                                      // vì sao kịch bản này được miễn.
                                      const note = window.prompt(
                                        `Vì sao "${scenario.name}" đỏ do sản phẩm chưa đáp ứng?`,
                                      );
                                      if (!note?.trim()) return;
                                      knownIssue.mutate({ scenarioId: scenario.id, note });
                                    }}
                                  >
                                    <TriangleAlert className="size-4" />
                                    {scenario.knownIssue ? 'Gỡ nhãn Known issue' : 'Đánh dấu Known issue'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  {status !== 'rejected' && (
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() =>
                                        review.mutate({
                                          filename: feature.name,
                                          scenarioName: scenario.name,
                                          decision: 'reject',
                                        })
                                      }
                                    >
                                      <X className="size-4" />
                                      Không duyệt
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                        {/* Ô soạn thảo khoá theo id của HÀNG, không theo tên file:
                            một file có nhiều kịch bản, khoá theo tên file thì một
                            cú bấm mở ô ở mọi hàng của file đó. */}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Pagination page={page} pageCount={pageCount} onPageChange={goToPage} />
          </CardContent>
        </Card>
      </section>

      {creating && (
        <ScenarioEditor
          open
          title="Thêm kịch bản"
          filename={
            creating.target.filename ||
            featureFileName(creating.target.newTitle) ||
            'Feature mới'
          }
          block={creating.block}
          tagSuggestions={(state.tagTaxonomy?.definitions ?? []).map((item) => item.name)}
          saving={save.isPending}
          featureNames={state.features.map((item) => item.name)}
          target={creating.target}
          onTargetChange={(target) => setCreating((prev) => (prev ? { ...prev, target } : prev))}
          onClose={() => setCreating(null)}
          onSave={(block) => {
            const { filename, newTitle } = creating.target;
            const existing = state.features.find((item) => item.name === filename);
            const name = scenarioNames(block)[0]?.trim() ?? '';
            if (!name || name === 'Nhập tên kịch bản') {
              toast.error('Hãy nhập tên kịch bản cụ thể trước khi lưu.');
              return;
            }
            // Tên trùng thì kịch bản mới không thay thế kịch bản cũ mà nằm cạnh
            // nó, và từ đó mọi thứ gọi kịch bản theo tên đều mơ hồ.
            const taken = scenarioNames(existing?.content ?? '');
            if (taken.some((item) => item.toLowerCase() === name.toLowerCase())) {
              toast.error(`Feature này đã có kịch bản “${name}”.`);
              return;
            }
            const target = filename || featureFileName(newTitle);
            if (!target) {
              toast.error('Hãy đặt tên cho feature mới trước khi lưu.');
              return;
            }
            const base = existing ? existing.content : newFeatureContent(newTitle.trim());
            save.mutate({
              filename: target,
              content: appendScenario(base, block),
              // File mới chưa có revision nào để so; gửi một chuỗi rỗng là nói
              // dối server rằng ta đang sửa một file đã tồn tại.
              ...(existing ? { baseRevision: existing.revision } : {}),
            });
          }}
        />
      )}

      {editing && (
        <ScenarioEditor
          open
          title={editing.scenarioName}
          filename={editing.filename}
          block={editing.block}
          tagSuggestions={(state.tagTaxonomy?.definitions ?? []).map((item) => item.name)}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={(block) => {
            const feature = state.features.find((item) => item.name === editing.filename);
            if (!feature) return;
            // Ghép vào nội dung file MỚI NHẤT từ server, không phải bản đã chụp
            // lúc mở panel: `baseRevision` đi kèm sẽ chặn nếu file đổi trong lúc
            // sửa, nhưng ghép vào bản cũ thì diff sẽ gồm cả những dòng không ai đụng.
            save.mutate({
              filename: editing.filename,
              content: replaceScenario(feature.content, editing.scenarioName, block),
              baseRevision: feature.revision,
            });
          }}
        />
      )}
    </AppShell>
  );
}

function idFor(filename: string, scenarioName: string): string {
  return `${filename}::${scenarioName}`;
}
