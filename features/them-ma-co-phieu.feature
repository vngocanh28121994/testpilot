@feature-them-ma-co-phieu-tren-bang-gia-co-phieu
Feature: Thêm mã cổ phiếu trên Bảng giá cổ phiếu

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Bảng giá cổ phiếu" from search

  @p0 @smoke @positive
  Scenario: Thêm mã cổ phiếu mới vào danh mục trên Bảng giá
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"

  @p0 @smoke @positive
  Scenario: Mở chức năng Thêm mã cổ phiếu từ nút dấu cộng
    When I click "Thêm mã"
    Then "Ô tìm kiếm mã cổ phiếu" is visible

  @p0 @smoke @positive
  Scenario: Nhập số liệu để tìm kiếm mã cổ phiếu
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" is visible

  @p1 @business-rule
  Scenario: Kết quả khớp theo mã được ưu tiên hiển thị
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then first "Danh sách gợi ý mã cổ phiếu" shows "VIC-HOSE"

  @p1 @positive
  Scenario: Tìm kiếm mã cổ phiếu theo tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "Thép Mê Lin" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" shows "MEL-HNX"

  @p1 @boundary
  Scenario: Chỉ hiển thị tối đa 5 kết quả tìm kiếm
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" count is at most "5"

  @p1 @business-rule
  Scenario: Tự động lọc trùng kết quả tìm kiếm theo mã và theo tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" values are unique

  @p1 @business-rule
  Scenario: Chọn mã đã có trong danh mục thì không thêm mới và focus vào dòng đó
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times
    And "Dòng cổ phiếu trong danh mục" is focused

  @p1 @positive
  Scenario: Mở menu thao tác của dòng mã cổ phiếu
    When I click "Nút tùy chọn dòng"
    Then "Tùy chọn Xóa khỏi danh mục" is visible

  @p1 @positive
  Scenario: Xoá mã cổ phiếu khỏi danh mục hiện tại
    When I click "Nút tùy chọn dòng"
    And I click "Tùy chọn Xóa khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"

  # HỎI: Tài liệu nói "không ảnh hưởng tới các danh mục khác" nhưng không nêu tên
  # danh mục cụ thể nào khác đang tồn tại và chứa mã bị xoá — cần danh mục nào để
  # kiểm thử REQ-012?
@p1 @business-rule
  Scenario: Xoá mã khỏi danh mục hiện tại không ảnh hưởng tới các danh mục khác
When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
     Then first "Dòng cổ phiếu trong danh mục" shows "VIC"
   When I click "open category"
    And I click "category not default"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"
    When I click "Nút tùy chọn dòng"
    And I click "Tùy chọn Xóa khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC"
   When I click "open category"
    And I click "category default"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"
