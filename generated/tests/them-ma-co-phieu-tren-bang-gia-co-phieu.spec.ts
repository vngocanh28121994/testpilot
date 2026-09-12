// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';

describe("Thêm mã cổ phiếu trên Bảng giá cổ phiếu", () => {
  test("Thêm mã cổ phiếu chưa có vào danh mục", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở chức năng Thêm mã cổ phiếu từ nút cộng", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.assertSearchInputVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Nhập từ khóa tìm kiếm hiển thị kết quả", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Kết quả khớp theo mã được ưu tiên hiển thị", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"firstText","text":"VIC-HOSE"});
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm theo tên doanh nghiệp hiển thị kết quả", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("Thép Mê Lin");
      await addStockModalPage.assertSuggestionListVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Chỉ hiển thị tối đa 5 kết quả tìm kiếm", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"count","operator":"atMost","value":5});
    } finally {
      await ctx.close();
    }
  });

  test("Không có kết quả trùng lặp trong danh sách gợi ý", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"uniqueText"});
    } finally {
      await ctx.close();
    }
  });

  test("Chọn mã đã có trong danh mục thì không thêm mới và focus vào dòng đó", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"countMatching","text":"VIC","operator":"equals","value":1});
      await priceBoardPage.assertStockRowCollection({"kind":"focused"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở menu tuỳ chọn của dòng mã cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapRowOptionsButton();
      await priceBoardPage.assertXoaKhoiDanhMucVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã khỏi danh mục hiện tại", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.tapRowOptionsButton();
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.assertStockRowText("VIC", 'notContains');
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã không ảnh hưởng tới danh mục khác", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu");
      await priceBoardPage.doStockRow();
      await priceBoardPage.tapRowOptionsButton();
      await priceBoardPage.tapXoaKhoiDanhMuc();
      await priceBoardPage.selectCategoryDropdown("Danh mục khác");
      await priceBoardPage.doStockRow();
    } finally {
      await ctx.close();
    }
  });
});
