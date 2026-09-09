import { useRouter } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { reloadPage } from '@/lib/reload';

/**
 * Thứ hiện ra khi một route ném lỗi.
 *
 * Bản mặc định của TanStack Router chỉ in `error.message`. Trên bundle đã
 * minify thì đó là một dòng vô dụng —
 *
 *   Something went wrong!    l is not a function
 *
 * — không stack, không biết route nào, không biết component nào. Một lỗi thật
 * mà người báo lại chỉ có chừng đó thông tin thì người sửa phải đi đoán, và
 * chính chỗ này đã làm mất một buổi đi đoán.
 */

/**
 * Chunk của bản build cũ đã bị xoá.
 *
 * Route được tách chunk, và mỗi lần build Vite dọn sạch thư mục output. Một tab
 * đang mở vẫn giữ tên chunk cũ; bấm sang route chưa nạp là đi tải một file
 * không còn tồn tại. Chuyện này xảy ra mỗi lần deploy khi có người đang dùng,
 * chứ không riêng lúc phát triển.
 *
 * Tải lại trang là cách sửa đúng và duy nhất: bản HTML mới trỏ sang tên chunk
 * mới.
 *
 * Chặn vòng lặp bằng mốc thời gian chứ không bằng cờ một-lần. Cờ một-lần thì
 * hoặc phải xoá lúc khởi động — và thế là lỗi tái diễn ngay sau khi tải lại sẽ
 * quay vòng vô tận — hoặc không bao giờ xoá, và lần deploy sau trong cùng phiên
 * sẽ không được tự sửa nữa. Mốc thời gian cho cả hai: hai lần trong vòng mười
 * giây là vòng lặp, hãy dừng và hiện lỗi thật; cách nhau xa hơn là hai sự cố
 * khác nhau, mỗi cái đáng được một lần tải lại.
 */
const RELOAD_MARK = 'testpilot:chunk-reload';
const LOOP_WINDOW_MS = 10_000;

function isStaleChunk(error: Error): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i
    .test(`${error.message} ${error.name}`);
}

/** sessionStorage ném lỗi khi bị chặn; lúc đó thà không tự tải lại còn hơn vỡ. */
function reloadedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_MARK) ?? 0);
    return Number.isFinite(at) && Date.now() - at < LOOP_WINDOW_MS;
  } catch {
    return true;
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch { /* không ghi được thì thôi, chỉ mất khả năng tự sửa */ }
}

export function RouteError({ error, reset }: { error: Error; reset?: () => void }) {
  const router = useRouter();

  if (isStaleChunk(error) && !reloadedRecently()) {
    markReload();
    reloadPage();
    return null;
  }

  // `location.search` là object đã parse, không phải chuỗi — nối nó vào chuỗi
  // sẽ ném "Cannot convert object to primitive value", tức là màn hình báo lỗi
  // tự nó thành lỗi. `href` đã gồm cả query.
  const where = router.state.location.href;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">Màn hình này gặp lỗi</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Phần còn lại của ứng dụng vẫn dùng được. Nếu cần báo lại, chép nguyên khối bên dưới.
      </p>

      {isStaleChunk(error) && (
        <p className="mt-3 text-sm">
          Bản build đã đổi trong lúc trang này đang mở, và tải lại vẫn chưa xong.
          Thử tải lại lần nữa; nếu vẫn vậy thì nguyên nhân nằm ở chỗ khác.
        </p>
      )}
      <div className="border-s-status-fail bg-(--tint-fail) mt-4 rounded-lg border border-s-[3px] px-3.5 py-3">
        <b className="text-sm">{error.name || 'Error'}: {error.message}</b>
        <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{where}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {reset && <Button size="sm" variant="outline" onClick={reset}>Thử lại</Button>}
        <Button size="sm" variant="outline" onClick={reloadPage}>
          Tải lại trang
        </Button>
      </div>

      {error.stack && (
        <details className="mt-4" open>
          <summary className="text-muted-foreground cursor-pointer text-sm select-none">
            Stack
          </summary>
          <code className="text-muted-foreground mt-2 block max-h-96 overflow-auto rounded bg-black/5 p-3 font-mono text-xs whitespace-pre-wrap dark:bg-white/5">
            {error.stack}
          </code>
        </details>
      )}
    </div>
  );
}
