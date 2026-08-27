// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { AutoPage } from '../pages/AutoPage.js';

describe("fundmart", () => {
  test("Kiểm tra tooltip table", async () => {
    const ctx = await createPageContext();
    try {
      const autoPage = new AutoPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá Fundmart");
      await autoPage.tapTcbf();
      await autoPage.focusCacQuyCoTheBanQuanTamRegion();
      await autoPage.tapGia1m();
      await autoPage.assertDienBienGiaTrongVong1ThangVisible();
    } finally {
      await ctx.close();
    }
  });
});
