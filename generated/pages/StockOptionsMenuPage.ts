import { BasePage } from '../../src/pom/BasePage.js';

/** Menu tùy chọn mã cổ phiếu */
export class StockOptionsMenuPage {
  constructor(private readonly page: BasePage) {}

  /** Tùy chọn Xóa khỏi danh mục
   * @testpilot-element stockOptionsMenu.removeFromCategory action=assertVisible
   */
  async assertRemoveFromCategoryVisible(): Promise<void> {
    await this.page.assertVisible('stockOptionsMenu.removeFromCategory');
  }

  /** Tùy chọn Xóa khỏi danh mục
   * @testpilot-element stockOptionsMenu.removeFromCategory action=tap
   */
  async tapRemoveFromCategory(): Promise<void> {
    await this.page.tap('stockOptionsMenu.removeFromCategory');
  }
}
