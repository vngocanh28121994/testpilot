/**
 * Bộ repo dựng lúc dùng, không dựng lúc điều phối.
 *
 * Vì sao cần: `dispatch` xưa dựng repo cho MỌI route trước khi gọi handler, nên
 * một route không đọc dữ liệu vẫn phải chờ — và vẫn chết — vì việc mở kho. Lỗi
 * ấy đã xảy ra thật: `GET /api/health` trong container trả về "No config at
 * /app/.testpilot/users/node/config.json", tức là endpoint dùng để biết tiến
 * trình còn sống lại phụ thuộc vào việc cấu hình đã đúng. Load balancer đọc câu
 * trả lời đó và kết luận sai theo cả hai hướng: giết một tiến trình đang chạy
 * tốt, hoặc báo động về một thứ nó không đo.
 *
 * Mọi phương thức của repo đều async, nên hoãn được mà không đổi kiểu: lời gọi
 * đầu tiên mới mở kho, và lỗi mở kho nổi ra ĐÚNG ở chỗ cần dữ liệu.
 */
import type { JobRepo, RegistryRepo, Repos, RunRepo } from './repo.js';

type Build = () => Repos | Promise<Repos>;

/**
 * Nhớ kết quả sau lần dựng đầu.
 *
 * Nhớ cả lời hứa chứ không chỉ giá trị: hai lời gọi song hành trong cùng một
 * request (màn Healing đọc registry hai lần) mà mỗi bên mở một kết nối riêng là
 * nhân đôi số kết nối Postgres cho mỗi request.
 */
function memo(build: Build): () => Promise<Repos> {
  let pending: Promise<Repos> | undefined;
  // `async` ở đây không phải trang trí: `build` có thể ném ĐỒNG BỘ (đọc config
  // thiếu file là một ví dụ), và một cú ném đồng bộ từ trong thân một phương
  // thức lẽ ra async sẽ vượt qua mọi `.catch()` mà route đặt quanh nó.
  return () => (pending ??= (async () => build())());
}

function proxy<T extends object>(pick: (repos: Repos) => T, open: () => Promise<Repos>): T {
  return new Proxy({} as T, {
    get(_target, key) {
      return (...args: unknown[]) =>
        open().then((repos) => {
          const repo = pick(repos) as Record<string | symbol, unknown>;
          const method = repo[key];
          if (typeof method !== 'function') {
            throw new TypeError(`Repo không có phương thức "${String(key)}".`);
          }
          return (method as (...a: unknown[]) => unknown).apply(repo, args);
        });
    },
  });
}

export function lazyRepos(build: Build): Repos {
  const open = memo(build);
  return {
    registry: proxy<RegistryRepo>((repos) => repos.registry, open),
    jobs: proxy<JobRepo>((repos) => repos.jobs, open),
    runs: proxy<RunRepo>((repos) => repos.runs, open),
  };
}
