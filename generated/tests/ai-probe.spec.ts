// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { LoginPage } from '../pages/LoginPage.js';
import { HomePage } from '../pages/HomePage.js';

describe("Thử tầng AI", () => {
  test("Tìm ô khối lượng bằng nhãn mô tả", async () => {
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
      await homePage.assertDatLenhVisible();
      await homePage.enterONhapKhoiLuongDatLenh("100");
    } finally {
      await ctx.close();
    }
  });
});
