import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { queryClient } from '@/lib/queryClient';
import { routeTree } from './routeTree.gen';
import './index.css';

const router = createRouter({
  routeTree,
  // Nguồn sự thật duy nhất cho tiền tố đường dẫn, và là lý do cutover ở Phase 6
  // chỉ phải sửa `base` trong vite.config.ts. Vite bơm giá trị `base` vào đây.
  // Thiếu dòng này thì bản build dưới /next/ sẽ rơi vào notFoundComponent ở mọi
  // đường dẫn trừ gốc — xem UI-MIGRATION-PLAN §6.5.
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
