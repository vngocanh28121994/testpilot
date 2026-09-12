// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { LoginPage } from '../pages/LoginPage.js';
import { HomePage } from '../pages/HomePage.js';

describe("Đăng nhập TCInvest", () => {
  test("Đăng nhập thành công vào tài khoản", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await loginPage.enterUsernameField(ctx.variable("account.tcbs.username"));
      await loginPage.enterPasswordField(ctx.variable("account.tcbs.password"));
      await loginPage.tapSubmitButton();
      await homePage.waitForTotalAssets();
      await homePage.assertTotalAssetsVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Đăng nhập thất bại — nhập sai thông tin", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await loginPage.enterUsernameField("0123456789");
      await loginPage.enterPasswordField("sat-khau-sai-123");
      await loginPage.tapSubmitButton();
      await loginPage.assertErrorMessageVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Kiểm tra tài sản trái phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Tài sản của tôi");
      await ctx.screenshot("my-asset-after-search");
      await homePage.assertTotalAssetsVisible();
      await homePage.tapTraiPhieu();
      await homePage.assertGocDauTuVisible();
      await homePage.tapTien();
      await homePage.assertTongTienVisible();
      await homePage.tapCoPhieu();
      await homePage.selectTieuKhoan("Ký quỹ");
      await ctx.screenshot("sau-khi-chon-tieu-khoan");
      await homePage.assertGiaTriVonVisible();
      await homePage.tapMenu();
      await homePage.scrollToKiemThu();
      await homePage.tapKiemThu();
      await homePage.assertKiemThuFundmartVisible();
    } finally {
      await ctx.close();
    }
  });
});
