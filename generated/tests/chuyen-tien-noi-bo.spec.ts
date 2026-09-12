// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransferConfirmPage } from '../pages/TransferConfirmPage.js';

describe("Chuyển tiền nội bộ", () => {
  test("Chuyển tiền thành công từ tài khoản Thường sang Ký Quỹ", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.doAvailableAmount();
      await transferPage.enterSoTien("1,000");
      await transferPage.tapSubmitButton();
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

  test("Chuyển tiền thành công từ tài khoản Ký Quỹ sang Thường", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Ký Quỹ");
      await transferPage.selectChonTkNhanTien("TK Thường");
      await transferPage.doAvailableAmount();
      await transferPage.enterSoTien("500");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.assertOrderInfoText("Chuyển tiền");
      await transferConfirmPage.assertSourceAccountText("Ký Quỹ");
      await transferPage.assertChonTkNhanTienText("Thường");
      await transferPage.assertTienChuyenPhi0Text("500");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });

  test("Chọn tiểu khoản nguồn và đích cho giao dịch chuyển tiền", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.assertSourceAccountText("TK Thường");
      await transferPage.assertChonTkNhanTienText("TK Ký Quỹ");
    } finally {
      await ctx.close();
    }
  });

  test("Tiểu khoản đã chọn ở nguồn không xuất hiện trong dropdown đích", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.doChonTkNhanTien();
    } finally {
      await ctx.close();
    }
  });

  test("Tiểu khoản đã chọn ở đích không xuất hiện trong dropdown nguồn", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.doSourceAccount();
    } finally {
      await ctx.close();
    }
  });

  test("Số tiền được chuyển thay đổi theo tiểu khoản nguồn đã chọn", async () => {
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
      await transferPage.selectSourceAccount("TK Ký Quỹ");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });

  test("Không cho chuyển khi số tiền vượt quá số tiền được chuyển", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.doAvailableAmount();
      await transferPage.enterSoTien("999999999");
      await transferPage.tapSubmitButton();
      await transferPage.assertThongBaoText("Tiền chuyển + phí vượt quá số tiền có thể chuyển");
    } finally {
      await ctx.close();
    }
  });

  test("Chuyển sang màn hình xác nhận khi số tiền hợp lệ", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1,000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.assertOrderInfoText("Chuyển tiền");
      await transferPage.assertTienChuyenPhi0Text("1,000");
    } finally {
      await ctx.close();
    }
  });

  test("Quay lại màn hình Chuyển tiền từ màn hình xác nhận", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1,000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.tapBackButton();
      await transferConfirmPage.assertSourceAccountVisible();
      await transferPage.assertChonTkNhanTienVisible();
      await transferPage.assertSoTienVisible();
      await transferPage.assertSubmitButtonVisible();
    } finally {
      await ctx.close();
    }
  });
});
