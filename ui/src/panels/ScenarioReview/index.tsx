import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { Pagination } from '@/components/Pagination';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/StatusPill';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { useAppState } from '@/hooks/useAppState';
import type {
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

export default function ScenarioReviewPanel({ search }: { search: ScenarioSearch }) {
  const state = useAppState((s) => s);
  if (!state.data) return <AppShell title="Kịch bản"><p className="text-muted-foreground">{state.isError ? (state.error as Error).message : 'Đang tải kịch bản…'}</p></AppShell>;
  return <ReviewBody state={state.data} search={search} />;
}

function ReviewBody({ state, search }: { state: StateResponse; search: ScenarioSearch }) {
  const navigate = useNavigate({ from: '/scenarios' });
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const refresh = () => void client.invalidateQueries({ queryKey: ['state'] });
  const review = useMutation({ mutationFn: (body: FeatureReviewRequest) => api.post<FeatureMutationResponse>(ROUTES.featureReview, body), onSuccess: () => { toast.success('Đã lưu quyết định.'); refresh(); }, onError: (error) => toast.error((error as Error).message) });
  const bulk = useMutation({ mutationFn: (body: FeatureReviewBulkRequest) => api.post<FeatureMutationResponse>(ROUTES.featureReviewBulk, body), onSuccess: (data) => { setSelected([]); toast.success(`Đã duyệt ${data.reviewed ?? 0} kịch bản.`); refresh(); }, onError: (error) => toast.error((error as Error).message) });
  const save = useMutation({ mutationFn: (body: FeatureSaveRequest) => api.put<FeatureMutationResponse>(ROUTES.feature, body), onSuccess: () => { setEditing(null); toast.success('Đã lưu feature; kịch bản cần được duyệt lại.'); refresh(); }, onError: (error) => toast.error((error as Error).message) });

  const rows = useMemo(() => state.features.flatMap((feature) => feature.scenarios.map((scenario) => ({ feature, scenario }))).filter(({ feature, scenario }) => {
    const haystack = `${feature.name} ${scenario.name} ${scenario.tags.join(' ')}`.toLowerCase();
    return (!search.q || haystack.includes(search.q.toLowerCase())) && (!search.file || feature.name === search.file) && (!search.status || scenario.review?.status === search.status) && (!search.tags?.length || search.tags.every((tag) => scenario.tags.includes(tag)));
  }), [state.features, search]);
  const tagOptions = useMemo(() => [...new Set(state.features.flatMap((feature) => feature.scenarios.flatMap((scenario) => scenario.tags)))].sort(), [state.features]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(Math.max(search.page ?? 1, 1), pageCount);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedItems = rows.filter(({ feature, scenario }) => selected.includes(idFor(feature.name, scenario.name))).map(({ feature, scenario }) => ({ filename: feature.name, scenarioName: scenario.name }));
  const toggle = (id: string) => setSelected((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  const applyFilters = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const tag = String(data.get('tag') || '');
    void navigate({ search: { q: String(data.get('q') || '') || undefined, file: String(data.get('file') || '') || undefined, status: (String(data.get('status') || '') || undefined) as ScenarioSearch['status'], tags: tag ? [tag] : undefined, page: undefined } });
  };
  const selectPage = (checked: boolean) => setSelected((items) => checked ? [...new Set([...items, ...pageRows.map(({ feature, scenario }) => idFor(feature.name, scenario.name))])] : items.filter((id) => !pageRows.some(({ feature, scenario }) => id === idFor(feature.name, scenario.name))));
  const goToPage = (nextPage: number) => void navigate({ search: { ...search, page: nextPage === 1 ? undefined : nextPage } });

  return <AppShell title="Kịch bản" actions={<Link to="/scenarios" search={{}} className="text-xs underline">Xoá bộ lọc</Link>}>
    <form className="border-border grid gap-2 rounded-lg border p-4 md:grid-cols-5" onSubmit={(event) => { event.preventDefault(); applyFilters(event.currentTarget); }}>
      <input name="q" defaultValue={search.q} className="input mt-0" placeholder="Tìm kịch bản…" />
      <select name="file" defaultValue={search.file ?? ''} className="input mt-0"><option value="">Tất cả file</option>{state.features.map((feature) => <option key={feature.name}>{feature.name}</option>)}</select>
      <select name="status" defaultValue={search.status ?? ''} className="input mt-0"><option value="">Tất cả trạng thái</option><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Không duyệt</option></select>
      <select name="tag" defaultValue={search.tags?.[0] ?? ''} aria-label="Lọc theo tag" className="input mt-0"><option value="">Tất cả tag</option>{tagOptions.map((tag) => <option key={tag}>{tag}</option>)}</select>
      <Button type="submit">Lọc</Button>
    </form>
    {selectedItems.length > 0 && <div className="mt-3 flex gap-2"><button className="bg-primary text-primary-foreground rounded px-2 py-1 text-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ items: selectedItems, decision: 'approve' })}>Duyệt đã chọn ({selectedItems.length})</button><button className="bg-destructive text-white rounded px-2 py-1 text-sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ items: selectedItems, decision: 'reject' })}>Không duyệt đã chọn</button></div>}
    <div className="border-border mt-4 overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr className="text-muted-foreground text-left"><th className="p-2"><input aria-label="Chọn tất cả trang này" type="checkbox" checked={pageRows.length > 0 && pageRows.every(({ feature, scenario }) => selected.includes(idFor(feature.name, scenario.name)))} onChange={(event) => selectPage(event.target.checked)} /></th><th className="p-2">Feature file</th><th className="p-2">Kịch bản</th><th className="p-2">Tags</th><th className="p-2 text-right">Bước</th><th className="p-2">Trạng thái</th><th className="p-2" /></tr></thead><tbody>
      {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center">Không có kịch bản khớp bộ lọc.</td></tr>}
      {pageRows.map(({ feature, scenario }) => {
        const id = idFor(feature.name, scenario.name);
        return <Fragment key={id}><tr className="border-border border-t"><td className="p-2"><input aria-label={`Chọn ${scenario.name}`} type="checkbox" checked={selected.includes(id)} onChange={() => toggle(id)} /></td><td className="p-2 font-mono text-xs">{feature.name}</td><td className="p-2"><b>{scenario.name}</b></td><td className="p-2">{scenario.tags.join(' ') || '—'}</td><td className="p-2 text-right">{scenario.steps}</td><td className="p-2"><StatusPill status={scenario.review?.status ?? 'pending'} /></td><td className="p-2 whitespace-nowrap"><button className="text-primary underline" disabled={review.isPending} onClick={() => review.mutate({ filename: feature.name, scenarioName: scenario.name, decision: 'approve' })}>Duyệt</button><button className="text-destructive ms-2 underline" disabled={review.isPending} onClick={() => review.mutate({ filename: feature.name, scenarioName: scenario.name, decision: 'reject' })}>Không duyệt</button><button className="ms-2 underline" onClick={() => { setEditing(id); setDraft(feature.content); }}>Sửa file</button></td></tr>
        {editing === id && <tr><td colSpan={7} className="bg-muted p-3"><textarea className="border-border bg-background h-72 w-full rounded border p-2 font-mono text-xs" value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="mt-2 flex gap-2"><button className="bg-primary text-primary-foreground rounded px-2 py-1 text-sm" disabled={save.isPending} onClick={() => save.mutate({ filename: feature.name, content: draft, baseRevision: feature.revision })}>{save.isPending ? 'Đang lưu…' : 'Lưu feature'}</button><button className="button" onClick={() => setEditing(null)}>Huỷ</button></div></td></tr>}
        </Fragment>;
      })}
    </tbody></table></div>
    <Pagination page={page} pageCount={pageCount} onPageChange={goToPage} />
  </AppShell>;
}

function idFor(filename: string, scenarioName: string): string {
  return `${filename}::${scenarioName}`;
}
