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
  Scenario: Mở chức năng Thêm mã cổ phiếu từ nút plus
    When I click "Thêm mã"
    Then "Ô tìm kiếm mã cổ phiếu" is visible

  @p0 @smoke @positive
  Scenario: Tìm kiếm mã cổ phiếu theo dữ liệu nhập
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
  Scenario: Danh sách gợi ý hiển thị tối đa 5 kết quả
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" count is at most 5

  @p1 @business-rule
  Scenario: Kết quả trùng giữa mã và tên doanh nghiệp được lọc chỉ hiển thị một lần
    When I click "Thêm mã"
    And I enter "ME" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" values are unique

  @p1 @business-rule
  Scenario: Chọn mã chưa có trong danh mục thì thêm mới vào dòng đầu tiên
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then first "Dòng cổ phiếu trong danh mục" shows "VIC"

  @p1 @business-rule
  Scenario: Chọn mã đã có trong danh mục thì không thêm mới và focus vào dòng đó
    When I click "Thêm mã"
    And I enter "TCB" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" shows "TCB" exactly 1 times
    And "Dòng cổ phiếu trong danh mục" is focused

  @p1 @positive
  Scenario: Mở menu tùy chọn của dòng cổ phiếu
    When I click "Icon ... tại dòng ADS"
    Then "Tùy chọn Xóa khỏi danh mục" is visible

  @p1 @positive
  Scenario: Xoá mã khỏi danh mục hiện tại
    When I click "Icon ... tại dòng ADS"
    And I click "Tùy chọn Xóa khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "ADS"

  # HỎI: Tài liệu nói "không ảnh hưởng tới các danh mục khác" nhưng không nêu tên danh mục cụ thể nào khác ngoài danh mục hiện tại — cần danh mục nào để kiểm thử?
