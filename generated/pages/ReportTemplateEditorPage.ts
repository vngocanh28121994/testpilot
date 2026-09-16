import { BasePage } from '../../src/pom/BasePage.js';

/** Tạo mẫu báo cáo */
export class ReportTemplateEditorPage {
  constructor(private readonly page: BasePage) {}

  /** Nút nổi thêm thẻ
   * @testpilot-element reportTemplateEditor.addCardButton action=tap
   */
  async tapAddCardButton(): Promise<void> {
    await this.page.tap('reportTemplateEditor.addCardButton');
  }

  /** Nút Lưu
   * @testpilot-element reportTemplateEditor.saveButton action=tap
   */
  async tapSaveButton(): Promise<void> {
    await this.page.tap('reportTemplateEditor.saveButton');
  }

  /** Tiêu đề Báo cáo mẫu chưa có tên
   * @testpilot-element reportTemplateEditor.title action=assertVisible
   */
  async assertTitleVisible(): Promise<void> {
    await this.page.assertVisible('reportTemplateEditor.title');
  }

  /** Hình ảnh minh họa trạng thái trống
   * @testpilot-element reportTemplateEditor.emptyState action=assertVisible
   */
  async assertEmptyStateVisible(): Promise<void> {
    await this.page.assertVisible('reportTemplateEditor.emptyState');
  }

  /** Thẻ nội dung trong báo cáo
   * @testpilot-element reportTemplateEditor.card action=assertCollection
   */
  async assertCardCollection(check: Parameters<BasePage['assertCollection']>[1]): Promise<void> {
    await this.page.assertCollection('reportTemplateEditor.card', check);
  }

  /** Nút Lưu
   * @testpilot-element reportTemplateEditor.saveButton action=assertNotVisible
   */
  async assertSaveButtonNotVisible(): Promise<void> {
    await this.page.assertNotVisible('reportTemplateEditor.saveButton');
  }

  /** Nút Lưu
   * @testpilot-element reportTemplateEditor.saveButton action=assertVisible
   */
  async assertSaveButtonVisible(): Promise<void> {
    await this.page.assertVisible('reportTemplateEditor.saveButton');
  }
}
