import { useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DropdownSelect } from '@/components/DropdownSelect';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ActionProposals } from './ActionProposals';
import { ScenarioPlan } from './ScenarioPlan';
import { appendScenario, extractScenario, featureFileName, formatGherkin, hasOneScenario, newFeatureContent, replaceScenario } from './gherkin';
import type { FeatureMutationResponse, FeatureSaveRequest, FeatureSummary, NormalizeResponse, VocabularyResponse } from '@core/ui/contracts.js';

const NEW_FILE = '__new__';
type EditorTarget = { feature: FeatureSummary; scenarioName: string } | null;

export function ScenarioEditor({
  target,
  features,
  mode,
  onClose,
}: {
  target: EditorTarget;
  features: FeatureSummary[];
  mode: 'edit' | 'create';
  onClose: () => void;
}) {
  const client = useQueryClient();
  const initial = target ? extractScenario(target.feature.content, target.scenarioName) : formatGherkin('Scenario: Nhập tên kịch bản\nGiven I open the app');
  const [content, setContent] = useState(initial);
  const [file, setFile] = useState(target?.feature.name ?? '');
  const [newTitle, setNewTitle] = useState('');
  const [normalization, setNormalization] = useState<NormalizeResponse | null>(null);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [syntaxVersion, setSyntaxVersion] = useState(0);
  const [syntaxQuery, setSyntaxQuery] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const creating = mode === 'create';
  const filename = file === NEW_FILE ? featureFileName(newTitle.trim()) : file;
  const selectedFeature = target?.feature ?? null;

  const vocabulary = useQuery({
    queryKey: ['vocabulary', syntaxVersion],
    queryFn: () => api.get<VocabularyResponse>(ROUTES.vocabulary),
    enabled: syntaxOpen,
    staleTime: 0,
  });
  const normalize = useMutation({
    mutationFn: (draft: string) => api.post<NormalizeResponse>(ROUTES.featureNormalize, { content: draft }),
    onSuccess: (result) => {
      setContent(formatGherkin(result.content));
      setNormalization(result);
      if (!result.valid) toast.warning(result.actionProposals.length ? `AI đề xuất ${result.actionProposals.length} action cần duyệt.` : result.error ?? 'Kịch bản chưa hợp lệ.');
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const save = useMutation({
    mutationFn: (body: FeatureSaveRequest) => api.put<FeatureMutationResponse>(ROUTES.feature, body),
    onSuccess: (result) => {
      for (const warning of result.pomWarnings ?? []) toast.message(warning);
      if (result.pomWarning) toast.message(result.pomWarning);
      toast.success(creating ? 'Đã thêm kịch bản; đang chờ duyệt.' : 'Đã lưu kịch bản; đang chờ duyệt lại.');
      void client.invalidateQueries({ queryKey: ['state'] });
      onClose();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const normalizeDraft = async (): Promise<NormalizeResponse | null> => {
    try {
      const result = await normalize.mutateAsync(content);
      return result;
    } catch {
      return null;
    }
  };
  const saveDraft = async () => {
    if (!filename) return toast.error('Hãy nhập tên feature hợp lệ.');
    const result = normalization?.content === content ? normalization : await normalizeDraft();
    if (!result?.valid) return;
    const block = formatGherkin(result.content).trim();
    if (!hasOneScenario(block)) return toast.error('Mỗi lần chỉ thêm hoặc sửa một kịch bản.');
    const scenarioName = block.match(/^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/im)?.[1]?.trim();
    if (!scenarioName || scenarioName === 'Nhập tên kịch bản') return toast.error('Hãy nhập tên kịch bản cụ thể trước khi lưu.');
    const base = creating ? (file === NEW_FILE ? newFeatureContent(newTitle.trim()) : targetFeatureContent(filename)) : selectedFeature?.content ?? '';
    const duplicate = base.match(/^\s*Scenario(?: Outline)?:\s*(.+?)\s*$/gim)?.some((line) => line.replace(/^\s*Scenario(?: Outline)?:\s*/i, '').trim().toLocaleLowerCase() === scenarioName.toLocaleLowerCase());
    if (duplicate && (creating || scenarioName !== target?.scenarioName)) return toast.error(`Feature này đã có kịch bản “${scenarioName}”.`);
    const next = creating ? appendScenario(base, block) : replaceScenario(base, target!.scenarioName, block);
    save.mutate({ filename, content: next, ...(creating && file === NEW_FILE ? { create: true } : {}), ...(!creating ? { baseRevision: selectedFeature?.revision } : {}) });
  };
  function targetFeatureContent(name: string): string {
    return target?.feature.name === name ? target.feature.content : features.find((feature) => feature.name === name)?.content ?? '';
  }

  const insert = (snippet: string, inline = false) => {
    const node = editor.current;
    if (!node) return;
    const caret = node.selectionStart ?? content.length;
    const start = inline ? caret : (node.selectionEnd ?? caret);
    const end = inline ? (node.selectionEnd ?? caret) : start;
    const before = content.slice(0, start);
    const after = content.slice(end);
    let text = snippet;
    if (!inline) {
      const lineStart = before === '' || before.endsWith('\n');
      text = `${lineStart ? '' : '\n'}    And ${snippet}${after.startsWith('\n') ? '' : '\n'}`;
    }
    const next = before + text + after;
    setContent(next);
    setNormalization(null);
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(start + text.length, start + text.length); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const node = event.currentTarget;
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const start = node.selectionStart;
    const end = node.selectionEnd;
    const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const lineEndAt = content.indexOf('\n', end);
    const lineEnd = lineEndAt < 0 ? content.length : lineEndAt;
    const block = content.slice(lineStart, lineEnd);
    const changed = event.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
    const before = event.shiftKey ? block.slice(0, start - lineStart).length - changed.slice(0, start - lineStart).length : changed.slice(0, start - lineStart + 2).length - block.slice(0, start - lineStart).length;
    const delta = changed.length - block.length;
    setContent(content.slice(0, lineStart) + changed + content.slice(lineEnd));
    requestAnimationFrame(() => node.setSelectionRange(Math.max(lineStart, start + (event.shiftKey ? -before : before)), Math.max(lineStart, end + delta)));
  };

  const query = syntaxQuery.toLocaleLowerCase();
  const forms = vocabulary.data?.forms.filter((item) => !query || `${item.doc} ${item.hint}`.toLocaleLowerCase().includes(query)) ?? [];
  const actions = vocabulary.data?.actions.filter((item) => !query || `${item.label} ${item.phraseTemplate}`.toLocaleLowerCase().includes(query)) ?? [];
  const elements = vocabulary.data?.elements.filter((item) => !query || `${item.id} ${item.label} ${item.screen}`.toLocaleLowerCase().includes(query)) ?? [];
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{creating ? 'Thêm kịch bản' : target?.scenarioName}</SheetTitle>
          <SheetDescription>{creating ? 'Mỗi lần chỉ tạo một kịch bản.' : `Sửa riêng kịch bản trong ${target?.feature.name}.`}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          {creating && <label className="block text-sm font-medium">Feature đích
            <DropdownSelect
              ariaLabel="Feature đích"
              className="mt-1"
              value={file}
              onValueChange={(value) => { setFile(value); setNormalization(null); }}
              options={[
                { value: '', label: 'Chọn feature…' },
                ...features.map((feature) => ({ value: feature.name, label: feature.name })),
                { value: NEW_FILE, label: '＋ Feature mới…' },
              ]}
            />
          </label>}
          {creating && file === NEW_FILE && <label className="block text-sm font-medium">Tên feature<Input className="mt-1" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Ví dụ: Chuyển tiền nội bộ" /></label>}
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">Dùng Tab / Shift+Tab để thụt lề. IME tiếng Việt được giữ nguyên.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setSyntaxOpen((open) => !open); setSyntaxVersion((value) => value + 1); }}><BookOpen /> Cú pháp</Button>
          </div>
          <Collapsible open={syntaxOpen} onOpenChange={setSyntaxOpen}>
            <CollapsibleTrigger className="sr-only">Bảng cú pháp</CollapsibleTrigger>
            <CollapsibleContent>
              <Card><CardContent className="space-y-2 p-3">
                <Input value={syntaxQuery} onChange={(event) => setSyntaxQuery(event.target.value)} placeholder="Tìm câu chạy được…" aria-label="Tìm cú pháp" />
                {vocabulary.isLoading && <p className="text-muted-foreground text-xs">Đang tải vocabulary…</p>}
                {[...forms.map((item) => ({ key: `form-${item.id}`, label: item.doc, detail: item.hint, value: item.doc, inline: false })), ...actions.map((item) => ({ key: `action-${item.id}`, label: item.label, detail: item.phraseTemplate, value: actionExample(item.phraseTemplate, item.parameters), inline: false })), ...elements.map((item) => ({ key: `element-${item.id}`, label: item.label, detail: `${item.screen} · ${item.id}`, value: `"${item.id}"`, inline: true }))].map((item) => <button key={item.key} type="button" className="hover:bg-muted block w-full rounded p-2 text-left text-xs" onClick={() => insert(firstVariant(item.value), item.inline)}><strong>{item.label}</strong>{item.detail && <span className="text-muted-foreground ms-2">{item.detail}</span>}</button>)}
              </CardContent></Card>
            </CollapsibleContent>
          </Collapsible>
          <Textarea ref={editor} value={content} onChange={(event) => { setContent(event.target.value); setNormalization(null); }} onKeyDown={onKeyDown} className="min-h-80 font-mono text-xs" aria-label="Nội dung kịch bản" />
          <Button type="button" variant="outline" disabled={normalize.isPending || save.isPending} onClick={() => void normalizeDraft()}><Sparkles /> {normalize.isPending ? 'Đang chuẩn hoá…' : 'Chuẩn hoá'}</Button>
          {normalization?.scenarioPlan && <ScenarioPlan plan={normalization.scenarioPlan} />}
          {normalization && <ActionProposals proposals={normalization.actionProposals} onReviewed={() => void normalizeDraft()} />}
          {normalization && !normalization.valid && <p className="text-destructive text-sm">Kịch bản chưa hợp lệ; hãy giải quyết action đề xuất trước khi lưu.</p>}
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>Huỷ</Button>
          <Button onClick={() => void saveDraft()} disabled={save.isPending || normalize.isPending || normalization?.valid === false}>{save.isPending ? 'Đang lưu…' : creating ? 'Thêm kịch bản' : 'Lưu thay đổi'}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function firstVariant(value: string) { return value.split('|')[0]?.trim() ?? value; }
function actionExample(template: string, parameters: Array<{ name: string; example: string }>) { return parameters.reduce((value, parameter) => value.replaceAll(`{{${parameter.name}}}`, parameter.example), template); }
