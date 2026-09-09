import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { queryClient } from '@/lib/queryClient';
import { ThemeProvider } from '@/components/ThemeProvider';
import { RouteError } from '@/components/RouteError';
import { routeTree } from './routeTree.gen';
import './index.css';

const router = createRouter({
  routeTree,
  // Router và asset cùng đọc Vite `base`; deep link luôn được resolve từ cùng
  // một gốc với bundle production.
  basepath: import.meta.env.BASE_URL,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  // Bản mặc định chỉ in error.message; trên bundle minify đó là một dòng vô
  // dụng, và không nói được route nào đang lỗi.
  defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
