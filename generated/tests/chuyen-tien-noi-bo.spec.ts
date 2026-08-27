// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransferConfirmPage } from '../pages/TransferConfirmPage.js';

describe("Chuyển tiền nội bộ", () => {
  test("Chuyển tiền từ tài khoản Thường sang Ký Quỹ thành công", async () => {
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
      await transferPage.assertTienChuyenPhi0Text("1,000");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });

  test("Chuyển tiền từ tài khoản Ký Quỹ sang Thường thành công", async () => {
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
      await transferPage.assertTienChuyenPhi0Text("500");
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });

  test("Chọn tiểu khoản nguồn và đích từ dropdown", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.assertSourceAccountText("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.assertChonTkNhanTienText("TK Ký Quỹ");
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
      await transferPage.tapChonTkNhanTien();
      await transferPage.assertTkThuongNotVisible();
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
      await transferPage.tapSourceAccount();
      await transferPage.assertTkKyQuyNotVisible();
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
      await transferPage.tapNutDong();
      await transferPage.assertThongBaoNotVisible();
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

  test("Quay lại từ màn xác nhận trở về màn hình Chuyển tiền", async () => {
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
      await transferPage.doAvailableAmount();
      await transferConfirmPage.tapBackButton();
      await transferPage.doAvailableAmount();
      await transferPage.assertSoTienVisible();
    } finally {
      await ctx.close();
    }
  });
});
