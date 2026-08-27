// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { LoginPage } from '../pages/LoginPage.js';
import { HomePage } from '../pages/HomePage.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';

describe("Đăng nhập TCInvest", () => {
  test("Đăng nhập thành công vào tài khoản", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
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
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
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

  test("Tìm kiếm Bảng giá cổ phiếu sau đăng nhập", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await ctx.screenshot("price-board-after-search");
      await priceBoardPage.assertCoSoTabVisible();
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterOMaCoPhieu("ADS");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.tapAddStockButton();
      await priceBoardPage.assertTextVisible("ADS");
      await priceBoardPage.openRowMenu("ADS");
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.assertTextNotVisible("ADS");
    } finally {
      await ctx.close();
    }
  });

  test("Kiểm tra tài sản trái phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
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
