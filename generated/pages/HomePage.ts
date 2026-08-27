import { BasePage } from '../../src/pom/BasePage.js';

/** Trang chủ sau đăng nhập */
export class HomePage {
  constructor(private readonly page: BasePage) {}

  /** Tổng tài sản */
  async waitForTotalAssets(): Promise<void> {
    await this.page.waitFor('home.totalAssets');
  }

  /** Tổng tài sản */
  async assertTotalAssetsVisible(): Promise<void> {
    await this.page.assertVisible('home.totalAssets');
  }

  /** Nút tìm kiếm */
  async tapSearchBox(): Promise<void> {
    await this.page.tap('home.searchBox');
  }

  /** Ô tìm kiếm */
  async enterSearchInput(text: string): Promise<void> {
    await this.page.input('home.searchInput', text);
  }

  /** Kết quả tìm kiếm đầu tiên */
  async waitForSearchFirstResult(): Promise<void> {
    await this.page.waitFor('home.searchFirstResult');
  }

  /** Kết quả tìm kiếm đầu tiên */
  async tapSearchFirstResult(): Promise<void> {
    await this.page.tap('home.searchFirstResult');
  }

  /** Trái phiếu
   * @testpilot-element home.traiPhieu action=tap
   */
  async tapTraiPhieu(): Promise<void> {
    await this.page.tap('home.traiPhieu');
  }

  /** Mã trái phiếu
   * @testpilot-element home.maTraiPhieu action=assertVisible
   */
  async assertMaTraiPhieuVisible(): Promise<void> {
    await this.page.assertVisible('home.maTraiPhieu');
  }

  /** Gốc đầu tư
   * @testpilot-element home.gocDauTu action=assertVisible
   */
  async assertGocDauTuVisible(): Promise<void> {
    await this.page.assertVisible('home.gocDauTu');
  }

  /** Tiền
   * @testpilot-element home.tien action=tap
   */
  async tapTien(): Promise<void> {
    await this.page.tap('home.tien');
  }

  /** Tổng tiền
   * @testpilot-element home.tongTien action=assertVisible
   */
  async assertTongTienVisible(): Promise<void> {
    await this.page.assertVisible('home.tongTien');
  }

  /** Cổ phiếu
   * @testpilot-element home.coPhieu action=tap
   */
  async tapCoPhieu(): Promise<void> {
    await this.page.tap('home.coPhieu');
  }

  /** Tiểu khoản
   * @testpilot-element home.tieuKhoan action=select
   */
  async selectTieuKhoan(option: string): Promise<void> {
    await this.page.select('home.tieuKhoan', option);
  }

  /** Giá trị vốn
   * @testpilot-element home.giaTriVon action=assertVisible
   */
  async assertGiaTriVonVisible(): Promise<void> {
    await this.page.assertVisible('home.giaTriVon');
  }

  /** Menu
   * @testpilot-element home.menu action=tap
   */
  async tapMenu(): Promise<void> {
    await this.page.tap('home.menu');
  }

  /** Đặt lệnh cổ phiếu
   * @testpilot-element home.datLenhCoPhieu action=tap
   */
  async tapDatLenhCoPhieu(): Promise<void> {
    await this.page.tap('home.datLenhCoPhieu');
  }

  /** Đặt lệnh
   * @testpilot-element home.datLenh action=assertVisible
   */
  async assertDatLenhVisible(): Promise<void> {
    await this.page.assertVisible('home.datLenh');
  }

  /** Kiểm thử
   * @testpilot-element home.kiemThu action=scrollTo
   */
  async scrollToKiemThu(): Promise<void> {
    await this.page.scrollTo('home.kiemThu');
  }

  /** Kiểm thử
   * @testpilot-element home.kiemThu action=tap
   */
  async tapKiemThu(): Promise<void> {
    await this.page.tap('home.kiemThu');
  }

  /** Kiểm thử Fundmart
   * @testpilot-element home.kiemThuFundmart action=assertVisible
   */
  async assertKiemThuFundmartVisible(): Promise<void> {
    await this.page.assertVisible('home.kiemThuFundmart');
  }

  /** Lệnh thường
   * @testpilot-element home.lenhThuong action=tap
   */
  async tapLenhThuong(): Promise<void> {
    await this.page.tap('home.lenhThuong');
  }

  /** Lưu lệnh
   * @testpilot-element home.luuLenh action=scrollTo
   */
  async scrollToLuuLenh(): Promise<void> {
    await this.page.scrollTo('home.luuLenh');
  }

  /** Lưu lệnh
   * @testpilot-element home.luuLenh action=tap
   */
  async tapLuuLenh(): Promise<void> {
    await this.page.tap('home.luuLenh');
  }

  /** Ô nhập mã cổ phiếu
   * @testpilot-element home.oNhapMaCoPhieu action=input
   */
  async enterONhapMaCoPhieu(text: string): Promise<void> {
    await this.page.input('home.oNhapMaCoPhieu', text);
  }

  /** KL đặt
   * @testpilot-element home.klDat action=input
   */
  async enterKlDat(text: string): Promise<void> {
    await this.page.input('home.klDat', text);
  }

  /** Giá đặt
   * @testpilot-element home.giaDat action=input
   */
  async enterGiaDat(text: string): Promise<void> {
    await this.page.input('home.giaDat', text);
  }

  /** Lưu mua
   * @testpilot-element home.luuMua action=tap
   */
  async tapLuuMua(): Promise<void> {
    await this.page.tap('home.luuMua');
  }

  /** Đã lưu lệnh mua
   * @testpilot-element home.daLuuLenhMua action=assertVisible
   */
  async assertDaLuuLenhMuaVisible(): Promise<void> {
    await this.page.assertVisible('home.daLuuLenhMua');
  }

  /** Nhập mã
   * @testpilot-element home.nhapMa action=input
   */
  async enterNhapMa(text: string): Promise<void> {
    await this.page.input('home.nhapMa', text);
  }

  /** {{text}}
   * @testpilot-element home.dynamicText action=waitFor
   */
  async waitForText(text: string): Promise<void> {
    await this.page.waitFor('home.dynamicText', undefined, { text: text });
  }

  /** {{text}}
   * @testpilot-element home.dynamicText action=tap
   */
  async tapText(text: string): Promise<void> {
    await this.page.tap('home.dynamicText', { text: text });
  }

  /** Ô nhập khối lượng đặt lệnh
   * @testpilot-element home.oNhapKhoiLuongDatLenh action=input
   */
  async enterONhapKhoiLuongDatLenh(text: string): Promise<void> {
    await this.page.input('home.oNhapKhoiLuongDatLenh', text);
  }

  /** Thống kê chung giao dịch PS
   * @testpilot-element home.thongKeChungGiaoDichPs action=assertVisible
   */
  async assertThongKeChungGiaoDichPsVisible(): Promise<void> {
    await this.page.assertVisible('home.thongKeChungGiaoDichPs');
  }

  /** Ngày Từ
   * @testpilot-element home.ngayTu action=input
   */
  async enterNgayTu(text: string): Promise<void> {
    await this.page.input('home.ngayTu', text);
  }

  /** số lượng giao dịch
   * @testpilot-element home.soLuongGiaoDich action=assertNumber
   */
  async assertSoLuongGiaoDichNumber(operator: 'equals' | 'notEquals' | 'greaterThan' | 'atLeast', expected: number): Promise<void> {
    await this.page.assertNumber('home.soLuongGiaoDich', operator, expected);
  }

  /** Ngày Từ
   * @testpilot-element home.ngayTu action=selectDate
   */
  async selectDateNgayTu(date: string): Promise<void> {
    await this.page.selectDate('home.ngayTu', date);
  }
}
