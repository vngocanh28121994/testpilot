// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { LoginPage } from '../pages/LoginPage.js';
import { HomePage } from '../pages/HomePage.js';

describe("Kiểm tra hiệu quả đầu tư phái sinh", () => {
  test("Kiểm tra hiệu quả đầu tư phái sinh", async () => {
    const ctx = await createPageContext();
    try {
      const loginPage = new LoginPage(ctx);
      const homePage = new HomePage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Hiệu quả đầu tư");
      await loginPage.tapPhaiSinh();
      await homePage.assertThongKeChungGiaoDichPsVisible();
      await homePage.selectDateNgayTu("01/01/2026");
      await homePage.assertSoLuongGiaoDichNumber("notEquals", 0);
    } finally {
      await ctx.close();
    }
  });
});
