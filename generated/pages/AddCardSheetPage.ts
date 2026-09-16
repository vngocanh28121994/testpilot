import { BasePage } from '../../src/pom/BasePage.js';

/** Thêm thẻ */
export class AddCardSheetPage {
  constructor(private readonly page: BasePage) {}

  /** Thẻ Lợi nhuận theo tháng
   * @testpilot-element addCardSheet.cardMonthlyProfit action=tap
   */
  async tapCardMonthlyProfit(): Promise<void> {
    await this.page.tap('addCardSheet.cardMonthlyProfit');
  }

  /** Nút đóng popup Thêm thẻ
   * @testpilot-element addCardSheet.closeButton action=tap
   */
  async tapCloseButton(): Promise<void> {
    await this.page.tap('addCardSheet.closeButton');
  }

  /** Thẻ Lợi nhuận theo tháng
   * @testpilot-element addCardSheet.cardMonthlyProfit action=assertVisible
   */
  async assertCardMonthlyProfitVisible(): Promise<void> {
    await this.page.assertVisible('addCardSheet.cardMonthlyProfit');
  }

  /** Thẻ Thống kê giao dịch CP
   * @testpilot-element addCardSheet.cardTransactionStats action=assertVisible
   */
  async assertCardTransactionStatsVisible(): Promise<void> {
    await this.page.assertVisible('addCardSheet.cardTransactionStats');
  }

  /** Thẻ Tài sản
   * @testpilot-element addCardSheet.cardAssets action=assertVisible
   */
  async assertCardAssetsVisible(): Promise<void> {
    await this.page.assertVisible('addCardSheet.cardAssets');
  }
}
