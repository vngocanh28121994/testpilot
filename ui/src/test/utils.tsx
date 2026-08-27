import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { ThemeProvider } from '@/components/ThemeProvider';

/**
 * QueryClient riêng cho mỗi test: `retry: false` để một lỗi mong đợi không mất
 * ba lần thử mới nổi lên, `gcTime: 0` để cache không sống sang test sau.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function createQueryWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: createQueryWrapper(), ...options });
}

/**
 * Render kèm Router thật.
 *
 * Cần cho mọi thứ chạm tới `<Link>`, `useNavigate` hay `useRouterState` — tức
 * là toàn bộ panel, vì tất cả đều bọc trong AppShell/Sidebar. Render trần thì
 * chúng ném "invariant expected app router to be mounted", một thông báo không
 * chỉ ra được nguyên nhân.
 */
export async function renderWithRouter(
  ui: ReactElement,
  options: { path?: string; initialEntry?: string } = {},
) {
  const { path = '/', initialEntry = path } = options;
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const uiRoute = createRoute({ getParentRoute: () => rootRoute, path, component: () => ui });
  // Route bắt-tất để một cú điều hướng trong test không rơi vào notFound.
  const splat = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <div data-testid="other-route" />,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([uiRoute, splat]),
    // Memory history: jsdom chỉ có một URL toàn cục, nên history thật sẽ rò
    // giữa các test và thứ tự chạy bắt đầu quyết định kết quả.
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  // Bắt buộc: RouterProvider render rỗng cho tới khi route đầu tiên resolve
  // xong. Thiếu dòng này thì mọi assertion đều nhìn vào một <div /> trống.
  await router.load();

  const queryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...result, router, queryClient };
}

export * from '@testing-library/react';
