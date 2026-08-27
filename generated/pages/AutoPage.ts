import { BasePage } from '../../src/pom/BasePage.js';

/** auto */
export class AutoPage {
  constructor(private readonly page: BasePage) {}

  /** TCBF
   * @testpilot-element auto.tcbf action=tap
   */
  async tapTcbf(): Promise<void> {
    await this.page.tap('auto.tcbf');
  }

  /** Các quỹ có thể bạn quan tâm
   * @testpilot-element auto.cacQuyCoTheBanQuanTam action=assertVisible
   */
  async assertCacQuyCoTheBanQuanTamVisible(): Promise<void> {
    await this.page.assertVisible('auto.cacQuyCoTheBanQuanTam');
  }

  /** Giá 1M
   * @testpilot-element auto.gia1m action=tap
   */
  async tapGia1m(): Promise<void> {
    await this.page.tap('auto.gia1m');
  }

  /** Diễn biến giá trong vòng 1 tháng
   * @testpilot-element auto.dienBienGiaTrongVong1Thang action=assertVisible
   */
  async assertDienBienGiaTrongVong1ThangVisible(): Promise<void> {
    await this.page.assertVisible('auto.dienBienGiaTrongVong1Thang');
  }

  /** Các quỹ có thể bạn quan tâm
   * @testpilot-element auto.cacQuyCoTheBanQuanTam action=focusRegion
   */
  async focusCacQuyCoTheBanQuanTamRegion(): Promise<void> {
    await this.page.focusRegion('auto.cacQuyCoTheBanQuanTam');
  }

  /** Bảng giá
   * @testpilot-element auto.bangGia action=focusRegion
   */
  async focusBangGiaRegion(): Promise<void> {
    await this.page.focusRegion('auto.bangGia');
  }
}
