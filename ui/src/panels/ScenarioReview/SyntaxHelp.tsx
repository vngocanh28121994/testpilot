import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { ROUTES } from '@/api/routes';
import type { VocabularyResponse } from '@core/ui/contracts.js';

/**
 * Bảng cú pháp đứng cạnh ô sửa kịch bản.
 *
 * Kịch bản không viết bằng tiếng Việt tự do mà bằng một tập mẫu câu đóng: gõ
 * ngoài tập đó thì câu đọc vẫn xuôi nhưng không chạy được. Không có bảng này
 * thì cách duy nhất để biết mẫu câu là mở mã nguồn ra đọc.
 */
export function SyntaxHelp() {
  const vocabulary = useQuery({
    queryKey: ['vocabulary'],
    queryFn: () => api.get<VocabularyResponse>(ROUTES.vocabulary),
  });

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

  const groups = new Map<string, typeof vocabulary.data.forms>();
  for (const form of vocabulary.data.forms) {
    groups.set(form.group, [...(groups.get(form.group) ?? []), form]);
  }

  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Mẫu câu viết được ({vocabulary.data.forms.length})
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {[...groups].map(([group, forms]) => (
          <div key={group} className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide uppercase">{group}</span>
            {forms.map((form) => (
              <div key={form.id} className="flex flex-col gap-0.5">
                <code className="text-xs">{form.doc}</code>
                <span className="text-muted-foreground text-xs">{form.hint}</span>
              </div>
            ))}
          </div>
        ))}

        {/* Action đã duyệt cũng là câu gõ được, nên đứng cùng chỗ với mẫu câu
            dựng sẵn — tách ra hai bảng thì không ai tìm thấy bảng thứ hai. */}
        {vocabulary.data.actions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide uppercase">Action đã duyệt</span>
            {vocabulary.data.actions.map((action) => (
              <div key={action.id} className="flex flex-col gap-0.5">
                <code className="text-xs">{action.phraseTemplate}</code>
                <span className="text-muted-foreground text-xs">{action.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide uppercase">
            Element gọi tên được ({vocabulary.data.elements.length})
          </span>
          <div className="max-h-48 overflow-auto">
            {vocabulary.data.elements.map((el) => (
              <div key={el.id} className="text-muted-foreground text-xs">
                <b className="text-foreground">{el.label}</b> — {el.screen}
              </div>
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}
