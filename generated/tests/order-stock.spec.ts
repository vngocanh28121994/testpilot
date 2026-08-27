// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { LoginPage } from '../pages/LoginPage.js';
import { HomePage } from '../pages/HomePage.js';

describe("order-stock", () => {
  test("Đặt lệnh nháp", async () => {
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
      await homePage.tapSearchBox();
      await homePage.enterSearchInput("Đặt lệnh cổ phiếu");
      await homePage.waitForSearchFirstResult();
      await homePage.tapSearchFirstResult();
      await ctx.screenshot("order-stock-after-search");
      await homePage.assertDatLenhVisible();
      await homePage.tapLenhThuong();
      await homePage.scrollToLuuLenh();
      await homePage.tapLuuLenh();
      await homePage.enterNhapMa("TCB");
      await homePage.waitForText("TCB");
      await homePage.tapText("TCB");
      await homePage.enterKlDat("100");
      await homePage.enterGiaDat("28");
      await homePage.tapLuuMua();
      await ctx.screenshot("order-draft-stock-result");
      await homePage.assertDaLuuLenhMuaVisible();
    } finally {
      await ctx.close();
    }
  });
});
