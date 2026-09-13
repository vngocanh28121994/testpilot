import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dropdown } from '@/components/Dropdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GherkinEditor } from '@/components/GherkinEditor';
import { featureFileName, tagsOf, withTags } from '@/lib/gherkin';
import { cn } from '@/lib/utils';
import { NormalizePanel } from './NormalizePanel';
import { SyntaxHelp } from './SyntaxHelp';

const NEW_FEATURE = '\u0000new';

export interface CreateTarget {
  filename: string;
  newTitle: string;
}

function newFileHint(title: string, taken: string[]): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Nhập tên feature — file sẽ được đặt tên theo đó.';
  const file = featureFileName(trimmed);
  if (!file) return 'Tên này không tạo được tên file hợp lệ.';
  if (taken.some((name) => name.toLowerCase() === file.toLowerCase())) {
    return `Đã có ${file}. Chọn feature đó ở trên, hoặc đặt tên khác.`;
  }
  return `File sẽ là ${file}.`;
}

/** Logic editor duy nhất, dùng chung cho panel bên và editor inline. */
export function ScenarioEditorFields({
  block,
  tagSuggestions,
  saving,
  featureNames,
  target,
  onTargetChange,
  onSave,
  onClose,
  editorLabel = 'Nội dung kịch bản',
  editorClassName = 'h-80',
  bodyClassName,
  actionsClassName,
  saveLabel = 'Lưu thay đổi',
  closeLabel = 'Huỷ',
}: {
  block: string;
  tagSuggestions: string[];
  saving: boolean;
  featureNames?: string[];
  target?: CreateTarget;
  onTargetChange?: (target: CreateTarget) => void;
  onSave: (block: string) => void;
  onClose: () => void;
  editorLabel?: string;
  editorClassName?: string;
  bodyClassName?: string;
  actionsClassName?: string;
  saveLabel?: string;
  closeLabel?: string;
}) {
  const [draft, setDraft] = useState(block);
  const [tagInput, setTagInput] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const [seed, setSeed] = useState(block);
  if (seed !== block) {
    setSeed(block);
    setDraft(block);
    setTagInput('');
  }

  const tags = tagsOf(draft);
  const setTags = (next: string[]) => setDraft((text) => withTags(text, next));
  const addTag = (raw: string) => {
    const tag = raw.trim().startsWith('@') ? raw.trim() : `@${raw.trim()}`;
    if (tag.length > 1 && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput('');
  };

  const insert = (line: string) => {
    const area = editor.current;
    if (!area) return;
    const at = area.selectionStart;
    const before = draft.slice(0, at);
    const after = draft.slice(area.selectionEnd);
    const indent = /(^|\n)([ \t]*)[^\n]*$/.exec(before)?.[2] ?? '    ';
    const head = before.endsWith('\n') || before === '' ? '' : '\n';
    const text = `${head}${indent}${line}`;
    setDraft(`${before}${text}${after}`);
    queueMicrotask(() => {
      area.focus();
      const pos = before.length + text.length;
      area.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      onSave(draft);
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const area = event.currentTarget;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
    if (event.shiftKey) {
      const line = draft.slice(lineStart, end);
      const trimmed = line.replace(/^ {1,2}/, '');
      const removed = line.length - trimmed.length;
      if (removed === 0) return;
      setDraft(`${draft.slice(0, lineStart)}${trimmed}${draft.slice(end)}`);
      queueMicrotask(() => area.setSelectionRange(start - removed, end - removed));
      return;
    }
    setDraft(`${draft.slice(0, start)}  ${draft.slice(end)}`);
    queueMicrotask(() => area.setSelectionRange(start + 2, start + 2));
  };

  const suggestions = tagSuggestions.filter(
    (tag) =>
      !tags.includes(tag) &&
      (!tagInput.trim() || tag.includes(tagInput.trim().replace(/^@/, ''))),
  );

  return (
    <>
      <div className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4', bodyClassName)}>
        {target && onTargetChange && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Thêm vào feature</span>
              <Dropdown
                className="mt-0"
                value={target.filename || NEW_FEATURE}
                onChange={(next) =>
                  onTargetChange({ ...target, filename: next === NEW_FEATURE ? '' : next })
                }
                options={[
                  ...(featureNames ?? []).map((name) => ({ value: name, label: name })),
                  { value: NEW_FEATURE, label: '＋ Feature mới…' },
                ]}
              />
            </label>
            {!target.filename && (
              <div className="flex flex-col gap-1">
                <Input
                  value={target.newTitle}
                  onChange={(event) => onTargetChange({ ...target, newTitle: event.target.value })}
                  placeholder="Tên feature mới, vd: Đăng ký tài khoản"
                  aria-label="Tên feature mới"
                />
                <span className="text-muted-foreground text-xs">
                  {newFileHint(target.newTitle, featureNames ?? [])}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Tags</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button type="button" aria-label={`Bỏ ${tag}`} onClick={() => setTags(tags.filter((item) => item !== tag))}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <Input
              className="h-7 w-48"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addTag(tagInput);
                }
              }}
              placeholder="Chọn hoặc nhập tag mới…"
              aria-label={`Tags — ${editorLabel}`}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.slice(0, 12).map((tag) => (
                <Button key={tag} type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => addTag(tag)}>
                  {tag}
                </Button>
              ))}
            </div>
          )}
        </div>

        <SyntaxHelp onInsert={insert} />

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Gherkin</span>
            <span className="text-muted-foreground text-xs">Tab thụt lề · Shift+Tab bỏ thụt lề</span>
          </div>
          <GherkinEditor
            textareaRef={editor}
            className={editorClassName}
            value={draft}
            onChange={setDraft}
            onKeyDown={onKeyDown}
            aria-label={editorLabel}
          />
        </div>

        <NormalizePanel content={draft} onApply={setDraft} />
      </div>

      <div className={cn('flex items-center gap-2 border-t p-4', actionsClassName)}>
        <Button disabled={saving} onClick={() => onSave(draft)}>
          {saving ? 'Đang lưu…' : saveLabel}
        </Button>
        <Button variant="outline" onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
    </>
  );
}
