import { expect, test } from '@playwright/test';

/**
 * Smoke test của chính bảng điều khiển.
 *
 * Đừng nhầm với Playwright mà TestPilot dùng để chạy test của SẢN PHẨM
 * (src/drivers/web.ts, generated/tests/) — cái đó chạy bằng `npm run run:web`.
 *
 * Bộ này chạy trên dev server, và dev server proxy /api sang backend thật ở
 * :4300. Nên nó cần `npm run ui` đang chạy — đó là chủ ý: mục đích của e2e là
 * kiểm chứng đúng phần mà unit test đã mock đi.
 */
test.describe('bảng điều khiển', () => {
  test('mở app, thấy sidebar 14 mục', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav.getByRole('link')).toHaveCount(14);
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  });

  test('điều hướng sang một mục chưa nối thì thấy lời giải thích', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Zephyr' }).click();
    await expect(page.getByText('Đồng bộ kết quả sang Zephyr/Jira. Chưa nối.')).toBeVisible();
    await expect(page).toHaveURL(/\/todo\/zephyr$/);
  });

  test('đường dẫn không tồn tại thì router trả 404 của app, không phải của server', async ({
    page,
  }) => {
    const res = await page.goto('/khong-ton-tai-dau');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Về trang chủ' })).toBeVisible();
  });

  test('đổi theme sang sáng rồi tối, token trạng thái đổi theo', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Sáng' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Tối' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('không có lỗi console khi tải trang', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });
});
