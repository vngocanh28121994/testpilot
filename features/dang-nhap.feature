# Viết tay để chạy demo nửa thực thi của pipeline khi chưa có LLM key.
# Chỉ gồm hành vi phía client: network policy đang chặn mọi backend, nên
# không có scenario nào chạm tới API thật.
@smoke
Feature: Đăng nhập TCInvest

  Background:
    Given I open the app


  Scenario: Màn hình đăng nhập hiện đủ các thành phần
    Then "Ô tên đăng nhập" is visible
    And "Ô mật khẩu" is visible
    And "Nút đăng nhập" is visible


  Scenario: Nhập được thông tin đăng nhập
    When I enter "0123456789" into "Ô tên đăng nhập"
    And I enter "khong-phai-mat-khau-that" into "Ô mật khẩu"
    Then "Nút đăng nhập" is visible


  Scenario: Có lối vào mở tài khoản và bảng giá
    Then "Mở tài khoản" is visible
    And "Thẻ Bảng giá" is visible


  Scenario: Xoá được ô đã nhập
    When I enter "test@example.com" into "Ô tên đăng nhập"
    And I clear "Ô tên đăng nhập"
    Then "Ô tên đăng nhập" is visible


  Scenario: Bắt lỗi cố ý — chứng minh test fail thật chứ không luôn xanh
    Then "Không Tồn Tại Trên Màn Hình" is visible

  # Tách tag riêng: đây là scenario DUY NHẤT chạm vào backend thật và dùng
  # credential thật, nên nó phải chạy được độc lập với phần còn lại.
  #   npm run run:web -- --tag @login
  @login
  Scenario: Đăng nhập thành công vào tài khoản
    When I enter "{{account.tcbs.username}}" into "Ô tên đăng nhập"
    And I enter "{{account.tcbs.password}}" into "Ô mật khẩu"
    And I tap "Nút đăng nhập"
    And I wait for "Tổng tài sản"
    Then "Tổng tài sản" is visible
