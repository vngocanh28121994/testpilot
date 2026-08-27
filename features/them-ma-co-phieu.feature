@feature-them-ma-co-phieu
Feature: Thêm mã cổ phiếu

  Background:
    Given I open the app
    And I am logged in as "tcbs"
    And I open feature "Bảng giá cổ phiếu" from search

  @p0 @boundary
  Scenario: Thêm mã cổ phiếu mới vào danh mục
    Given I click "Thêm mã"
    When I enter "MEL" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý" shows "MEL-HNX"
    When I click "Kết quả tìm kiếm đầu tiên"
    Then first "Dòng cổ phiếu trong danh mục" shows "MEL"

  @p0 @boundary
  Scenario: Tìm kiếm mã cổ phiếu theo tên doanh nghiệp
    Given I click "Thêm mã"
    When I enter "Thép Mê Lin" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý" shows "MEL-HNX"

  @p0 @boundary
  Scenario: Hiển thị tối đa 5 kết quả gợi ý khi tìm kiếm
    Given I click "Thêm mã"
    When I enter "M" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý" count is at most "5"

  @p0 @boundary
  Scenario: Lọc trùng kết quả khi mã trùng với tên doanh nghiệp
    Given I click "Thêm mã"
    When I enter "MEL" into "Ô tìm kiếm mã cổ phiếu"
    Then "Danh sách gợi ý" shows "MEL-HNX" exactly "1" times

  @p0 @boundary
  Scenario: Chọn mã cổ phiếu đã có trong danh mục sẽ scroll tới và focus vào dòng đó
    Given I click "Thêm mã"
    When I enter "TCB" into "Ô tìm kiếm mã cổ phiếu"
    And I click "Kết quả tìm kiếm đầu tiên"
    Then "Dòng cổ phiếu trong danh mục" is focused

  @p2 @positive
  Scenario: Xóa mã cổ phiếu khỏi danh mục hiện tại
    Given I click "Icon ... tại dòng ADS"
    When I click "Xoá khỏi danh mục"
    Then "ADS" is not visible

  @p1 @positive
  Scenario: Xóa mã khỏi danh mục hiện tại không ảnh hưởng danh mục khác
    Given I click "Icon ... tại dòng ADS"
    And I click "Xoá khỏi danh mục"
    When I select "HOSE" from "Danh sách sàn và nhóm bảng giá"
    Then "ADS" is visible
