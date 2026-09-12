@feature-them-ma-co-phieu-tren-bang-gia-co-phieu
Feature: Thêm mã cổ phiếu trên Bảng giá cổ phiếu

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Bảng giá cổ phiếu" from search

  @p0 @smoke @positive
  Scenario: Thêm mã cổ phiếu chưa có vào danh mục
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"

  @p0 @smoke @positive
  Scenario: Mở chức năng Thêm mã cổ phiếu từ nút cộng
    When I click "Thêm mã"
    Then "Ô tìm kiếm mã cổ phiếu" is visible

  @p0 @smoke @positive
  Scenario: Nhập từ khóa tìm kiếm hiển thị kết quả
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @business-rule
  Scenario: Kết quả khớp theo mã được ưu tiên hiển thị
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then first "Danh sách gợi ý mã cổ phiếu" shows "VIC-HOSE"

  @p1 @positive
  Scenario: Tìm kiếm theo tên doanh nghiệp hiển thị kết quả
    When I click "Thêm mã"
    And I enter "Thép Mê Lin" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @boundary
  Scenario: Chỉ hiển thị tối đa 5 kết quả tìm kiếm
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" count is at most "5"

  @p1 @business-rule
  Scenario: Không có kết quả trùng lặp trong danh sách gợi ý
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" values are unique

  @p1 @business-rule
  Scenario: Chọn mã đã có trong danh mục thì không thêm mới và focus vào dòng đó
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    And I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times
    And "Dòng cổ phiếu trong danh mục" is focused

  @p1 @positive
  Scenario: Mở menu tuỳ chọn của dòng mã cổ phiếu
    When I click "Nút tùy chọn dòng"
    Then "Xoá khỏi danh mục" is visible

  @p1 @positive
  Scenario: Xoá mã khỏi danh mục hiện tại
    When I click "Nút tùy chọn dòng"
    And I click "Xoá khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"

  @p1 @business-rule
  Scenario: Xoá mã không ảnh hưởng tới danh mục khác
    When I remember "Dòng cổ phiếu trong danh mục" as "danhMucKhac"
    And I click "Nút tùy chọn dòng"
    And I click "Xoá khỏi danh mục"
    And I select "Danh mục khác" from "Danh mục theo dõi"
    Then "Dòng cổ phiếu trong danh mục" is unchanged from "danhMucKhac"
