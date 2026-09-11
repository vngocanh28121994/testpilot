import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { VocabularyResponse } from '@core/ui/contracts.js';

/** Một dòng gõ được, đã gộp mẫu câu dựng sẵn và action đã duyệt về một dạng. */
interface Entry {
  key: string;
  group: string;
  text: string;
  hint: string;
}

/**
 * Bảng cú pháp đứng cạnh ô sửa kịch bản.
 *
 * Kịch bản không viết bằng tiếng Việt tự do mà bằng một tập mẫu câu đóng: gõ
 * ngoài tập đó thì câu đọc vẫn xuôi nhưng không chạy được. Không có bảng này
 * thì cách duy nhất để biết mẫu câu là mở mã nguồn ra đọc.
 *
 * Tìm được và bấm chèn được, chứ không phải một danh sách chỉ để đọc: bảng có
 * hơn ba mươi mẫu câu cộng toàn bộ element, cuộn tay tìm một câu rồi gõ lại nó
 * cho đúng từng ký tự là cách chắc chắn để gõ sai.
 */
export function SyntaxHelp({ onInsert }: { onInsert?: (line: string) => void }) {
  const [query, setQuery] = useState('');
  /**
   * Xổ ra khi cần, không chiếm chỗ thường trực.
   *
   * Khi dùng để chèn, bảng này đứng TRÊN ô soạn — đó là chỗ người ta nhìn trước
   * khi gõ. Nhưng 141 dòng nằm thường trực ở đó thì đẩy chính ô soạn xuống dưới
   * tầm mắt, nên nó chỉ mở khi con trỏ vào ô tìm, và phủ lên nội dung bên dưới
   * thay vì xô mọi thứ đi.
   *
   * Không có `onInsert` thì đây là bảng tra cứu thuần tuý, mở sẵn là đúng.
   */
  const [open, setOpen] = useState(false);
  const asPicker = Boolean(onInsert);
  //
  // Còn chữ trong ô tìm thì bảng còn mở, kể cả khi tiêu điểm đã rời đi. Đóng
  // theo tiêu điểm nghe hợp lý cho tới khi thử thật: người dùng bấm vào ô soạn
  // để đặt con trỏ đúng dòng cần chèn — và bảng sập ngay lúc đó, đúng lúc họ
  // vừa tìm xong câu muốn chèn.
  const showList = !asPicker || open || query.trim().length > 0;
  const vocabulary = useQuery({
    queryKey: ['vocabulary'],
    queryFn: () => api.get<VocabularyResponse>(ROUTES.vocabulary),
  });

  const entries = useMemo<Entry[]>(() => {
    if (!vocabulary.data) return [];
    return [
      ...vocabulary.data.forms.map((form) => ({
        key: `form:${form.id}`,
        group: form.group,
        text: form.doc,
        hint: form.hint,
      })),
      // Action đã duyệt cũng là câu gõ được, nên đứng cùng chỗ với mẫu câu dựng
      // sẵn — tách ra hai bảng thì không ai tìm thấy bảng thứ hai.
      ...vocabulary.data.actions.map((action) => ({
        key: `action:${action.id}`,
        group: 'Action đã duyệt',
        text: action.phraseTemplate,
        hint: action.label,
      })),
    ];
  }, [vocabulary.data]);

  const clean = query.trim().toLowerCase();
  const shown = clean
    ? entries.filter((e) => `${e.text} ${e.hint} ${e.group}`.toLowerCase().includes(clean))
    : entries;
  const elements = (vocabulary.data?.elements ?? []).filter((el) =>
    clean ? `${el.label} ${el.screen} ${el.id}`.toLowerCase().includes(clean) : true,
  );

  if (vocabulary.isPending) {
    return <p className="text-muted-foreground text-xs">Đang tải bảng cú pháp…</p>;
  }
  if (!vocabulary.data) {
    return (
      <p className="text-destructive text-xs">
        Không tải được bảng cú pháp: {(vocabulary.error as Error).message}
      </p>
    );
  }

  const groups = new Map<string, Entry[]>();
  for (const entry of shown) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);

  return (
    // `shrink-0`, không phải `min-h-0`.
    //
    // Khung cha là một cột cuộn có chiều cao cố định, và mọi thứ trong đó —
    // thẻ tag, ô Gherkin `h-80`, bảng Chuẩn hoá — đều không co được. Bảng này
    // là thứ duy nhất co được, nên flexbox dồn toàn bộ phần thiếu chỗ vào nó:
    // nó co về gần bằng 0, `overflow-auto` của chính nó giấu nốt phần còn lại,
    // và người dùng chỉ còn thấy đúng một ô tìm kiếm không bao giờ ra kết quả.
    <div
      className="relative flex shrink-0 flex-col gap-3"
      onBlur={(event) => {
        // Chỉ đóng khi tiêu điểm rời hẳn cả cụm: bấm vào một dòng trong bảng
        // cũng là một cú blur của ô nhập, đóng lúc đó là nuốt mất cú bấm.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="flex flex-col gap-1">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="Tìm câu lệnh, action hoặc element…"
          aria-label="Tìm trong bảng cú pháp"
          {...(asPicker ? { 'aria-expanded': open } : {})}
        />
        {onInsert && (
          <span className="text-muted-foreground text-xs">
            Bấm một dòng để chèn vào kịch bản. Câu ngoài bảng này viết tự nhiên rồi bấm Chuẩn hoá.
          </span>
        )}
      </div>

      {/* Cao có hạn và tự cuộn: bảng có hơn ba mươi mẫu câu cộng toàn bộ
          element, thả tự do thì nó đẩy nút Lưu ra khỏi tầm mắt. */}
      {showList && (
      <div
        className={
          asPicker
            ? 'bg-popover absolute top-full right-0 left-0 z-20 mt-1 flex max-h-96 flex-col gap-4 '
              + 'overflow-auto rounded-md border p-2 shadow-lg'
            : 'flex max-h-96 flex-col gap-4 overflow-auto'
        }
      >
        {shown.length === 0 && elements.length === 0 && (
          <p className="text-muted-foreground text-xs">Không có mục nào khớp “{query}”.</p>
        )}

        {[...groups].map(([group, items]) => (
          <div key={group} className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide uppercase">{group}</span>
            {items.map((entry) =>
              onInsert ? (
                <button
                  key={entry.key}
                  type="button"
                  className="hover:bg-muted flex flex-col gap-0.5 rounded-md px-2 py-1 text-left"
                  onClick={() => {
                    onInsert(entry.text);
                    // Xoá cả ô tìm: còn chữ là bảng còn mở, mà chèn xong rồi
                    // thì thứ người ta muốn nhìn là kịch bản, không phải bảng.
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <code className="text-xs">{entry.text}</code>
                  <span className="text-muted-foreground text-xs">{entry.hint}</span>
                </button>
              ) : (
                <div key={entry.key} className="flex flex-col gap-0.5 px-2 py-1">
                  <code className="text-xs">{entry.text}</code>
                  <span className="text-muted-foreground text-xs">{entry.hint}</span>
                </div>
              ),
            )}
          </div>
        ))}

        {elements.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium tracking-wide uppercase">
              Element gọi tên được ({elements.length})
            </span>
            {elements.map((el) => (
              <div key={el.id} className="text-muted-foreground text-xs">
                <b className="text-foreground">{el.label}</b> — {el.screen}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
