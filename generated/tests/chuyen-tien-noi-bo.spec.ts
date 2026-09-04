// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransferConfirmPage } from '../pages/TransferConfirmPage.js';

describe("Chuyển tiền nội bộ", () => {
  test("Chuyển tiền từ TK Thường sang TK Ký Quỹ thành công", async () => {
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
      await transferConfirmPage.assertSourceAccountText("Thường");
      await transferPage.assertChonTkNhanTienText("Ký Quỹ");
      await transferPage.assertTienChuyenPhi0Text("1,000");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
    } finally {
      await ctx.close();
    }
  });

  test("Chuyển tiền từ TK Ký Quỹ sang TK Thường thành công", async () => {
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
      await transferPage.enterSoTien("500");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.assertOrderInfoText("Chuyển tiền");
      await transferConfirmPage.assertSourceAccountText("Ký Quỹ");
      await transferPage.assertChonTkNhanTienText("Thường");
      await transferPage.assertTienChuyenPhi0Text("500");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
    } finally {
      await ctx.close();
    }
  });

  test("Tiểu khoản đã chọn ở nguồn không xuất hiện ở dropdown đích", async () => {
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

  test("Tiểu khoản đã chọn ở đích không xuất hiện ở dropdown nguồn", async () => {
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

  test("Số tiền được chuyển thay đổi theo tiểu khoản nguồn", async () => {
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

  test("Nhập số tiền vượt quá số tiền được chuyển", async () => {
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
      await transferPage.enterSoTien("999999999");
      await transferPage.tapSubmitButton();
      await transferPage.assertThongBaoText("Tiền chuyển + phí vượt quá số tiền có thể chuyển");
    } finally {
      await ctx.close();
    }
  });

  test("Nhập số tiền hợp lệ chuyển sang màn xác nhận", async () => {
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
      await transferConfirmPage.assertSourceAccountText("Thường");
      await transferPage.assertChonTkNhanTienText("Ký Quỹ");
      await transferPage.assertTienChuyenPhi0Text("1,000");
    } finally {
      await ctx.close();
    }
  });

  test("Bấm Quay lại trở về màn hình Chuyển tiền", async () => {
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
      await transferPage.assertSubmitButtonVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Số tiền được chuyển giảm sau khi chuyển tiền thành công", async () => {
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
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });
});
