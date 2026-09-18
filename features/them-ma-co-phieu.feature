@feature-them-ma-co-phieu-tren-bang-gia-co-phieu
Feature: Thêm mã cổ phiếu trên Bảng giá cổ phiếu

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Bảng giá cổ phiếu" from search

  @p0 @smoke @positive
  Scenario: Thêm mã cổ phiếu mới vào danh mục trên Bảng giá cổ phiếu
    When I click "Thêm mã"
    Then "Ô tìm kiếm mã cổ phiếu" is visible
    When I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible
    When I click "Kết quả tìm kiếm đầu tiên"
    And I click "Nút thêm mã trong popup"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"

  @p0 @smoke @positive
  Scenario: Mở chức năng Thêm mã cổ phiếu từ nút thêm
    When I click "Thêm mã"
    Then "Ô tìm kiếm mã cổ phiếu" is visible

  @p0 @smoke @positive
  Scenario: Nhập số liệu để tìm kiếm mã cổ phiếu
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @business-rule
  Scenario: Kết quả khớp theo mã được ưu tiên hiển thị
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then first "Danh sách gợi ý mã cổ phiếu" shows "VIC"

  @p1 @boundary
  Scenario: Hiển thị danh sách kết quả khi nhập đủ 3 ký tự
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @boundary
  Scenario: Cho phép chọn mã từ danh sách kết quả tìm kiếm
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Nút thêm mã trong popup" is visible

  @p1 @positive
  Scenario: Tìm kiếm mã cổ phiếu theo tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "Vingroup" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @boundary
  Scenario: Danh sách kết quả tìm kiếm hiển thị tối đa 5 mục
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" count is at most 5

  @p1 @business-rule
  Scenario: Kết quả trùng lặp giữa tìm theo mã và theo tên doanh nghiệp bị loại bỏ
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" values are unique

  @p1 @business-rule
  Scenario: Mã chưa có trong danh mục được thêm mới vào dòng đầu tiên
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    And I click "Nút thêm mã trong popup"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"

  @p1 @business-rule
  Scenario: Mã đã có trong danh mục không được thêm mới và được focus
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    And I click "Nút thêm mã trong popup"
    Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly 1 times
    And "Dòng cổ phiếu trong danh mục" is focused

  @p1 @positive
  Scenario: Mở menu tùy chọn của dòng cổ phiếu
    When I click "Nút tùy chọn dòng"
    Then "Tùy chọn Xóa khỏi danh mục" is visible

  @p1 @positive
  Scenario: Xoá mã cổ phiếu khỏi danh mục hiện tại
    When I click "Nút tùy chọn dòng"
    And I click "Tùy chọn Xóa khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"

  # HỎI: Tài liệu không nêu tên danh mục cụ thể nào khác ngoài danh mục hiện tại — cần biết danh mục nào để kiểm chứng "không ảnh hưởng tới các danh mục khác".
  @p1 @business-rule
  Scenario: Xoá mã khỏi danh mục hiện tại không ảnh hưởng tới các danh mục khác
    When I click "Nút tùy chọn dòng"
    And I click "Tùy chọn Xóa khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"
