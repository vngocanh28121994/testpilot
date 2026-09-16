// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { TransferPage } from '../pages/TransferPage.js';
import { TransferConfirmPage } from '../pages/TransferConfirmPage.js';

describe("Chuyển tiền nội bộ", () => {
  test("Chuyển tiền thành công từ tiểu khoản Thường sang Ký Quỹ", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
    } finally {
      await ctx.close();
    }
  });

  test("Chuyển tiền thành công từ tiểu khoản Ký Quỹ sang Thường", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Ký Quỹ");
      await transferPage.selectChonTkNhanTien("TK Thường");
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.tapConfirmButton();
      await transferPage.assertThongBaoText("Chuyển tiền thành công");
    } finally {
      await ctx.close();
    }
  });

  test("Chọn tiểu khoản nguồn và tiểu khoản đích thành công", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.assertSourceAccountText("TK Thường");
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
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
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
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.chonTkNhanTien");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.doSourceAccount();
    } finally {
      await ctx.close();
    }
  });

  test("Số tiền được chuyển thay đổi theo tiểu khoản nguồn được chọn", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.doAvailableAmount();
      await transferPage.selectSourceAccount("TK Ký Quỹ");
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });

  test("Nhập số tiền vượt quá số tiền được chuyển thì không cho chuyển", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
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

  test("Số tiền hợp lệ thì chuyển sang màn hình xác nhận", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.assertOrderInfoText("Chuyển tiền");
      await transferConfirmPage.assertSourceAccountText("Thường");
      await transferPage.assertChonTkNhanTienText("Ký Quỹ");
      await transferPage.assertTienChuyenPhi0Text("1,000");
    } finally {
      await ctx.close();
    }
  });

  test("Bấm Quay lại thì trở lại màn hình Chuyển tiền", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.tapBackButton();
      await transferPage.assertSubmitButtonVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Sau khi chuyển thành công số tiền được chuyển cập nhật theo số tiền vừa chuyển", async () => {
    const ctx = await createPageContext();
    try {
      const transferPage = new TransferPage(ctx);
      const transferConfirmPage = new TransferConfirmPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Chuyển tiền", "transfer.sourceAccount");
      await transferPage.selectSourceAccount("TK Thường");
      await transferPage.selectChonTkNhanTien("TK Ký Quỹ");
      await transferPage.doAvailableAmount();
      await transferPage.enterSoTien("1000");
      await transferPage.tapSubmitButton();
      await transferConfirmPage.tapConfirmButton();
      await transferPage.doAvailableAmount();
    } finally {
      await ctx.close();
    }
  });
});
