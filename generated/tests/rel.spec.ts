// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransferConfirmPage } from '../pages/TransferConfirmPage.js';

describe("Chuyển tiền nội bộ", () => {
  test("Chuyển tiền thành công từ TK Thường sang TK Ký Quỹ", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.doAvailableAmount();
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.focusOrderInfoRegion();
      await transferConfirmPage.assertOrderInfoText("Chuyển tiền");
      await transferConfirmPage.assertSourceAccountText("Thường");
      await transferPage.assertChonTkNhanTienText("Ký Quỹ");
      await transferPage.assertTienChuyenPhi0Text("1,000");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });
});
