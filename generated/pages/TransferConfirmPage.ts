import { BasePage } from '../../src/pom/BasePage.js';

/** Xác nhận chuyển tiền */
export class TransferConfirmPage {
  constructor(private readonly page: BasePage) {}

  /** Lệnh
   * @testpilot-element transferConfirm.orderInfo action=focusRegion
   */
  async focusOrderInfoRegion(): Promise<void> {
    await this.page.focusRegion('transferConfirm.orderInfo');
  }

  /** Lệnh
   * @testpilot-element transferConfirm.orderInfo action=assertText
   */
  async assertOrderInfoText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transferConfirm.orderInfo', expected, mode);
  }

  /** Chuyển từ
   * @testpilot-element transferConfirm.sourceAccount action=assertText
   */
  async assertSourceAccountText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('transferConfirm.sourceAccount', expected, mode);
  }

  /** Nút XÁC NHẬN
   * @testpilot-element transferConfirm.confirmButton action=tap
   */
  async tapConfirmButton(): Promise<void> {
    await this.page.tap('transferConfirm.confirmButton');
  }

  /** Nút QUAY LẠI
   * @testpilot-element transferConfirm.backButton action=tap
   */
  async tapBackButton(): Promise<void> {
    await this.page.tap('transferConfirm.backButton');
  }

  /** Chuyển từ
   * @testpilot-element transferConfirm.sourceAccount action=assertVisible
   */
  async assertSourceAccountVisible(): Promise<void> {
    await this.page.assertVisible('transferConfirm.sourceAccount');
  }
}
