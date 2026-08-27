// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';

describe("Kiểm chứng dropdown tuỳ biến", () => {
  test("Chọn được tiểu khoản từ dropdown Angular Material", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.assertSourceAccountText("Thường");
    } finally {
      await ctx.close();
    }
  });
});
