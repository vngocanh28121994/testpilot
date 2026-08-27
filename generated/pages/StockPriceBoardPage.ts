import { BasePage } from '../../src/pom/BasePage.js';

/** Bảng giá cổ phiếu */
export class StockPriceBoardPage {
  constructor(private readonly page: BasePage) {}

  /** Nút thêm mã cổ phiếu
   * @testpilot-element stockPriceBoard.addStockButton action=tap
   */
  async tapAddStockButton(): Promise<void> {
    await this.page.tap('stockPriceBoard.addStockButton');
  }

  /** Dòng cổ phiếu trong bảng giá
   * @testpilot-element stockPriceBoard.stockRow action=assertVisible
   */
  async assertStockRowVisible(): Promise<void> {
    await this.page.assertVisible('stockPriceBoard.stockRow');
  }

  /** Dòng cổ phiếu trong bảng giá
   * @testpilot-element stockPriceBoard.stockRow action=assertText
   */
  async assertStockRowText(expected: string): Promise<void> {
    await this.page.assertText('stockPriceBoard.stockRow', expected);
  }

  /** Menu hành động của dòng cổ phiếu
   * @testpilot-element stockPriceBoard.rowActionMenu action=tap
   */
  async tapRowActionMenu(): Promise<void> {
    await this.page.tap('stockPriceBoard.rowActionMenu');
  }

  /** Xoá khỏi danh mục
   * @testpilot-element stockPriceBoard.removeFromList action=tap
   */
  async tapRemoveFromList(): Promise<void> {
    await this.page.tap('stockPriceBoard.removeFromList');
  }

  /** Dòng cổ phiếu trong bảng giá
   * @testpilot-element stockPriceBoard.stockRow action=assertNotVisible
   */
  async assertStockRowNotVisible(): Promise<void> {
    await this.page.assertNotVisible('stockPriceBoard.stockRow');
  }
}
