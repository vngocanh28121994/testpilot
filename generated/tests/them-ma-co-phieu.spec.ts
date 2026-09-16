// @testpilot-managed — generated from the approved feature; edit the .feature source.
import { describe, test } from 'node:test';
import { createPageContext } from '../support/driver.js';
import { PriceBoardPage } from '../pages/PriceBoardPage.js';
import { AddStockModalPage } from '../pages/AddStockModalPage.js';
import { StockOptionsMenuPage } from '../pages/StockOptionsMenuPage.js';

describe("Thêm mã cổ phiếu trên Bảng giá cổ phiếu", () => {
  test("Thêm mã cổ phiếu mới vào danh mục trên Bảng giá", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở chức năng Thêm mã cổ phiếu từ nút dấu cộng", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.assertSearchInputVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Nhập số liệu để tìm kiếm mã cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
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
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.assertSuggestionListCollection({"kind":"firstText","text":"VIC-HOSE"});
    } finally {
      await ctx.close();
    }
  });

  test("Tìm kiếm mã cổ phiếu theo tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("Thép Mê Lin");
      await addStockModalPage.assertSuggestionListText("MEL-HNX");
    } finally {
      await ctx.close();
    }
  });

  test("Chỉ hiển thị tối đa 5 kết quả tìm kiếm", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("ME");
      await addStockModalPage.assertSuggestionListCollection({"kind":"count","operator":"atMost","value":5});
    } finally {
      await ctx.close();
    }
  });

  test("Tự động lọc trùng kết quả tìm kiếm theo mã và theo tên doanh nghiệp", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
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
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"countMatching","text":"VIC","operator":"equals","value":1});
      await priceBoardPage.assertStockRowCollection({"kind":"focused"});
    } finally {
      await ctx.close();
    }
  });

  test("Mở menu thao tác của dòng mã cổ phiếu", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.rowOptionsButton");
      await priceBoardPage.tapRowOptionsButton();
      await stockOptionsMenuPage.assertRemoveFromCategoryVisible();
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã cổ phiếu khỏi danh mục hiện tại", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.rowOptionsButton");
      await priceBoardPage.tapRowOptionsButton();
      await stockOptionsMenuPage.tapRemoveFromCategory();
      await priceBoardPage.assertStockRowText("VIC", 'notContains');
    } finally {
      await ctx.close();
    }
  });

  test("Xoá mã khỏi danh mục hiện tại không ảnh hưởng tới các danh mục khác", async () => {
    const ctx = await createPageContext();
    try {
      const priceBoardPage = new PriceBoardPage(ctx);
      const addStockModalPage = new AddStockModalPage(ctx);
      const stockOptionsMenuPage = new StockOptionsMenuPage(ctx);
      await ctx.launch();
      // app already launched via ctx.launch()
      await ctx.ensureLoggedIn("tcbs");
      await ctx.openFeatureFromSearch("Bảng giá cổ phiếu", "priceBoard.addStockButton");
      await priceBoardPage.tapAddStockButton();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
      await priceBoardPage.tapOpenCategory();
      await priceBoardPage.tapCategoryNotDefault();
      await addStockModalPage.enterSearchInput("VIC");
      await addStockModalPage.tapStockSearchFirstResult();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
      await priceBoardPage.tapRowOptionsButton();
      await stockOptionsMenuPage.tapRemoveFromCategory();
      await priceBoardPage.assertStockRowText("VIC", 'notContains');
      await priceBoardPage.tapOpenCategory();
      await priceBoardPage.tapCategoryDefault();
      await priceBoardPage.assertStockRowCollection({"kind":"firstText","text":"VIC"});
    } finally {
      await ctx.close();
    }
  });
});
