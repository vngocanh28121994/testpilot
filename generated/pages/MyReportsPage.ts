import { BasePage } from '../../src/pom/BasePage.js';

/** Báo cáo của tôi */
export class MyReportsPage {
  constructor(private readonly page: BasePage) {}

  /** Nút thêm mới báo cáo
   * @testpilot-element myReports.addReportButton action=tap
   */
  async tapAddReportButton(): Promise<void> {
    await this.page.tap('myReports.addReportButton');
  }

  /** Chọn loại nội dung hiển thị
   * @testpilot-element myReports.chonLoaiNoiDungHienThi action=select
   */
  async selectChonLoaiNoiDungHienThi(option: string): Promise<void> {
    await this.page.select('myReports.chonLoaiNoiDungHienThi', option);
  }

  /** Tên của thiết kế
   * @testpilot-element myReports.tenCuaThietKe action=input
   */
  async enterTenCuaThietKe(text: string): Promise<void> {
    await this.page.input('myReports.tenCuaThietKe', text);
  }

  /** Mục báo cáo trong danh sách
   * @testpilot-element myReports.reportItem action=assertText
   */
  async assertReportItemText(expected: string, mode: 'equals' | 'contains' | 'notContains' = 'contains'): Promise<void> {
    await this.page.assertText('myReports.reportItem', expected, mode);
  }

  /** Chọn loại nội dung hiển thị
   * @testpilot-element myReports.chonLoaiNoiDungHienThi action=assertVisible
   */
  async assertChonLoaiNoiDungHienThiVisible(): Promise<void> {
    await this.page.assertVisible('myReports.chonLoaiNoiDungHienThi');
  }

  /** Tên của thiết kế
   * @testpilot-element myReports.tenCuaThietKe action=assertVisible
   */
  async assertTenCuaThietKeVisible(): Promise<void> {
    await this.page.assertVisible('myReports.tenCuaThietKe');
  }
}
