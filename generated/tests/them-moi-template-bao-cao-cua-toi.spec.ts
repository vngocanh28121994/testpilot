// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { MyReportsPage } from '../pages/MyReportsPage.js';
import { ReportTypePickerPage } from '../pages/ReportTypePickerPage.js';
import { ReportTemplateEditorPage } from '../pages/ReportTemplateEditorPage.js';
import { AddCardSheetPage } from '../pages/AddCardSheetPage.js';
import { SaveTemplateDialogPage } from '../pages/SaveTemplateDialogPage.js';
import { TransferPage } from '../pages/TransferPage.js';

describe("Thêm mới template Báo cáo của tôi", () => {
  test("Thêm mới template báo cáo thành công", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.tapSaveButton();
      await myReportsPage.enterTenCuaThietKe("Template test");
      await saveTemplateDialogPage.tapSaveButton();
      await myReportsPage.assertReportItemText("Template test");
      await transferPage.assertThongBaoText("Lưu mẫu thành công");
    } finally {
      await ctx.close();
    }
  });

  test("Mở chức năng Thêm mới từ nút thêm mới báo cáo", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.assertChonLoaiNoiDungHienThiVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Chọn loại báo cáo Cá nhân và bấm Tiếp tục mở màn hình thêm mới", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.assertTitleVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Chọn loại báo cáo Doanh nghiệp và thị trường và bấm Tiếp tục mở màn hình thêm mới", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await reportTypePickerPage.tapBusinessMarketOption();
      await reportTypePickerPage.tapContinueButton();
      await reportTypePickerPage.assertWarningBannerVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Mỗi loại báo cáo mở ra màn hình thêm mới có giao diện khác nhau", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.assertEmptyStateVisible();
      await reportTypePickerPage.assertWarningBannerNotVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Màn hình Thêm mới hiển thị empty state khi chưa thêm thẻ", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.assertEmptyStateVisible();
      await reportTemplateEditorPage.assertCardCollection({"kind":"count","operator":"equals","value":0});
    } finally {
      await ctx.close();
    }
  });

  test("Bấm nút thêm thẻ mở màn hình chọn thẻ", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.assertCardMonthlyProfitVisible();
      await addCardSheetPage.assertCardTransactionStatsVisible();
      await addCardSheetPage.assertCardAssetsVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Mặc định không chọn thẻ nào khi mở màn hình chọn thẻ", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.assertCardCollection({"kind":"count","operator":"equals","value":0});
    } finally {
      await ctx.close();
    }
  });

  test("Bấm thẻ lần thứ hai bỏ chọn thẻ", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.assertCardCollection({"kind":"count","operator":"equals","value":0});
    } finally {
      await ctx.close();
    }
  });

  test("Các thẻ đã chọn hiển thị trên màn hình Thêm mới sau khi quay lại", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.assertCardCollection({"kind":"count","operator":"equals","value":1});
    } finally {
      await ctx.close();
    }
  });

  test("Không chọn thẻ nào thì màn hình Thêm mới vẫn ở trạng thái empty state", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.assertEmptyStateVisible();
      await reportTemplateEditorPage.assertCardCollection({"kind":"count","operator":"equals","value":0});
    } finally {
      await ctx.close();
    }
  });

  test("Nút Lưu disable khi không có thẻ nào được chọn", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.assertSaveButtonNotVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Nút Lưu enable khi có thẻ được chọn", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.assertSaveButtonVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Bấm Lưu mở popup nhập tên template", async () => {
    const ctx = await createPageContext();
    try {
      const myReportsPage = new MyReportsPage(ctx);
      const reportTypePickerPage = new ReportTypePickerPage(ctx);
      const reportTemplateEditorPage = new ReportTemplateEditorPage(ctx);
      const addCardSheetPage = new AddCardSheetPage(ctx);
      const saveTemplateDialogPage = new SaveTemplateDialogPage(ctx);
      const transferPage = new TransferPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Báo cáo của tôi", "myReports.addReportButton");
      await myReportsPage.tapAddReportButton();
      await myReportsPage.selectChonLoaiNoiDungHienThi("Cá nhân");
      await reportTypePickerPage.tapContinueButton();
      await reportTemplateEditorPage.tapAddCardButton();
      await addCardSheetPage.tapCardMonthlyProfit();
      await addCardSheetPage.tapCloseButton();
      await reportTemplateEditorPage.tapSaveButton();
      await myReportsPage.assertTenCuaThietKeVisible();
      await saveTemplateDialogPage.assertSaveButtonVisible();
    } finally {
      await ctx.close();
    }
  });
});
