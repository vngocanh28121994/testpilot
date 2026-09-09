import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';
import { useJobStore } from '@/stores/jobStore';

/**
 * localStorage trong bộ nhớ.
 *
 * jsdom có sẵn localStorage, nhưng nó dùng chung giữa các test trong cùng một
 * file — mà ThemeProvider ghi lựa chọn theme vào đó. Một bản cài lại sạch sau
 * mỗi test là cách duy nhất để thứ tự chạy không đổi kết quả.
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, value),
  };
}

const testLocalStorage = createMemoryStorage();
Object.defineProperty(window, 'localStorage', { configurable: true, value: testLocalStorage });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testLocalStorage });

/**
 * ResizeObserver, thứ jsdom không có.
 *
 * Radix đo phần tử bằng nó trong mọi thành phần dựng trên Popper — dropdown,
 * select, tooltip. Thiếu nó thì `PopperContent` ném ngay lúc mount, error
 * boundary nuốt cả cây, và test chỉ thấy một màn hình trống: không phải "nút
 * bấm không ăn" mà là "không còn gì để bấm". Đúng thứ đã làm test sidebar đỏ
 * ngẫu nhiên khoảng một lần trong mười lăm, tuỳ theo lần render đó rơi vào
 * nhánh thu gọn (dropdown) hay nhánh mở (collapsible).
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ThemeProvider gọi matchMedia; jsdom không cài đặt nó.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// TanStack Router khôi phục vị trí cuộn khi điều hướng; jsdom không cài đặt
// scrollTo và in một dòng "Not implemented" cho mỗi lần. Không phải lỗi, chỉ
// là nhiễu che mất output thật.
Object.defineProperty(window, 'scrollTo', { configurable: true, value: () => {} });

// DotBackground vẽ dây nối bằng canvas 2D; jsdom không cài đặt getContext và
// in một dòng "Not implemented" cho MỖI lần render AppShell. Component đã xử lý
// đúng khi getContext trả null, nên stub ở đây chỉ để output test đọc được.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: () => null,
});
// 'error' chứ không phải 'warn' như sen. Một request không có handler nghĩa là
// test đang lặng lẽ gọi ra mạng thật — ở đây thì nó fail và không ai thấy,
// còn ở CI thì nó treo. Cứ để nó đỏ ngay.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  // jobStore CỐ Ý sống ở module scope để job không chết khi đổi trang (R10).
  // Chính vì thế nó rò trạng thái giữa các test nếu không dọn — đây là cái giá
  // của thiết kế đó, và đây là chỗ trả.
  useJobStore.getState().resetAll();
  testLocalStorage.clear();
});

afterAll(() => server.close());

/**
 * Những API trình duyệt mà Radix cần nhưng jsdom không có.
 *
 * Dropdown dùng chung dựng trên Radix Select; nó gọi ba thứ này lúc mở danh
 * sách. Thiếu chúng thì test đỏ với "hasPointerCapture is not a function" —
 * một thông báo không hề nói rằng nguyên nhân là jsdom, chứ không phải component.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
