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
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm câu lệnh, action hoặc element…"
          aria-label="Tìm trong bảng cú pháp"
        />
        {onInsert && (
          <span className="text-muted-foreground text-xs">
            Bấm một dòng để chèn vào kịch bản. Câu ngoài bảng này viết tự nhiên rồi bấm Chuẩn hoá.
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-auto">
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
                  onClick={() => onInsert(entry.text)}
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
    </div>
  );
}
