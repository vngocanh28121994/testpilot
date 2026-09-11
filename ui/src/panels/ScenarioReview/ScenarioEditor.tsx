import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dropdown } from '@/components/Dropdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { GherkinEditor } from '@/components/GherkinEditor';
import { NormalizePanel } from './NormalizePanel';
import { SyntaxHelp } from './SyntaxHelp';
import { featureFileName, tagsOf, withTags } from '@/lib/gherkin';
import { X } from 'lucide-react';

const NEW_FEATURE = '\u0000new';

/**
 * Cho biết file sẽ được đặt tên gì, hoặc vì sao chưa đặt được — nói trước khi
 * có gì được ghi ra đĩa, chứ không để lỗi nổ ra lúc bấm Lưu.
 */
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

/**
 * Sửa MỘT kịch bản, trong một panel bên.
 *
 * Bản React đầu tiên đưa cả nội dung file vào một <textarea> cao 72 nhét trong
 * một ô của bảng. Ba điều sai cùng lúc: chỗ soạn quá chật, người sửa một kịch
 * bản phải cuộn qua những kịch bản không liên quan, và một lần chọn-rồi-gõ nhầm
 * là xoá luôn kịch bản bên cạnh. Ở đây chỉ khối của kịch bản đó được đưa ra;
 * phần còn lại của file không đi qua tay ai.
 */
export interface CreateTarget {
  /** Tên file đã có, hoặc chuỗi rỗng khi người dùng đang tạo file mới. */
  filename: string;
  /** Tiêu đề feature mới; chỉ có nghĩa khi `filename` rỗng. */
  newTitle: string;
}

export function ScenarioEditor({
  open,
  title,
  filename,
  block,
  tagSuggestions,
  saving,
  featureNames,
  target,
  onTargetChange,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  filename: string;
  block: string;
  tagSuggestions: string[];
  saving: boolean;
  /** Chỉ truyền khi đang tạo kịch bản mới: các feature có thể thêm vào. */
  featureNames?: string[];
  target?: CreateTarget;
  onTargetChange?: (target: CreateTarget) => void;
  onSave: (block: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(block);
  const [tagInput, setTagInput] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  // Mở kịch bản khác thì nạp lại nội dung. Khoá theo `block` thay vì dùng
  // useEffect: React dựng lại state khi key đổi, không cần một vòng render thừa.
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

  /**
   * Chèn tại con trỏ, không phải nối vào cuối: người ta bấm một mẫu câu khi
   * đang đứng ở giữa kịch bản, và câu mới phải rơi đúng chỗ đang đứng.
   */
  const insert = (line: string) => {
    const area = editor.current;
    if (!area) return;
    const at = area.selectionStart;
    const before = draft.slice(0, at);
    const after = draft.slice(area.selectionEnd);
    // Thụt lề theo dòng hiện tại để câu chèn vào không phá cấu trúc Gherkin.
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

  /** Tab thụt lề thay vì nhảy ra khỏi ô — trong một trình soạn Gherkin, thụt lề là việc thường xuyên hơn. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    (tag) => !tags.includes(tag) && (!tagInput.trim() || tag.includes(tagInput.trim().replace(/^@/, ''))),
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{filename}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4">
          {/* Chỉ hiện khi đang thêm mới: sửa một kịch bản có sẵn thì file đích
              đã biết rồi, đưa ra một ô chọn ở đó chỉ mời người ta chuyển nhầm. */}
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
                  {/* Nói trước file sẽ tên gì, trước khi có gì được ghi ra đĩa. */}
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
                  <button
                    type="button"
                    aria-label={`Bỏ ${tag}`}
                    onClick={() => setTags(tags.filter((item) => item !== tag))}
                  >
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
                aria-label="Tags của kịch bản"
              />
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 12).map((tag) => (
                  <Button
                    key={tag}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-xs"
                    onClick={() => addTag(tag)}
                  >
                    {tag}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Trên ô soạn, không dưới: đây là thứ người ta tra TRƯỚC khi gõ, và
              nằm dưới cùng thì phải cuộn qua cả ô soạn mới thấy. Master cũng
              đặt nó ở đây. */}
          <SyntaxHelp onInsert={insert} />

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Gherkin</span>
              <span className="text-muted-foreground text-xs">Tab thụt lề · Shift+Tab bỏ thụt lề</span>
            </div>
            <GherkinEditor
              textareaRef={editor}
              className="h-80"
              value={draft}
              onChange={setDraft}
              onKeyDown={onKeyDown}
              aria-label="Nội dung kịch bản"
            />
          </div>

          {/* Chuẩn hoá đứng cạnh ô soạn, không nằm ở trang khác: câu sai cú pháp
              phải lộ ra trước khi bấm Lưu, chứ không phải lúc chạy. */}
          <NormalizePanel content={draft} onApply={setDraft} />
        </div>

        <div className="flex items-center gap-2 border-t p-4">
          <Button disabled={saving} onClick={() => onSave(draft)}>
            {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
