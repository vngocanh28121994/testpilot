@feature-them-ma-co-phieu
Feature: Chức năng Thêm mã cổ phiếu

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Bảng giá cổ phiếu" from search

  @p0 @smoke @positive
  Scenario: Thêm mã cổ phiếu mới vào danh mục
    When I click "Thêm mã"
    Then I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    And I click "Thêm mã"
    Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times

  @p0 @smoke @business-rule
  Scenario: Thêm mã cổ phiếu đã có trong danh mục
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" count is at least "1"
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" shows "VIC" exactly "1" times

  @p0 @smoke @positive
  Scenario: Tìm kiếm mã cổ phiếu theo tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "Tập đoàn Vingroup" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" shows "VIC-HOSE"

  @p0 @boundary
  Scenario: Tìm kiếm mã cổ phiếu hiển thị tối đa 5 kết quả
    When I click "Thêm mã"
    And I enter "M" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" count is at most "5"

  @p0 @smoke @business-rule
  Scenario: Tìm kiếm theo mã ưu tiên hơn tìm kiếm theo tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Kết quả tìm kiếm đầu tiên" shows "VIC-HOSE"

  @p0 @business-rule
  Scenario: Tự động lọc trùng kết quả tìm kiếm từ mã và tên doanh nghiệp
    When I click "Thêm mã"
    And I enter "VIC" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý mã cổ phiếu" shows "VIC-HOSE" exactly "1" times

  @p1 @positive
  Scenario: Xóa mã cổ phiếu khỏi danh mục
    Given "Dòng cổ phiếu trong danh mục" shows "VIC"
    When I click "Icon ... tại dòng VIC"
    And I click "Xoá khỏi danh mục"
    Then "Dòng cổ phiếu trong danh mục" does not show "VIC-HOSE"
