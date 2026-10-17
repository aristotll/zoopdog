## MODIFIED Requirements

### Requirement: Every input has a stable result contract
Pronunciation guide SHALL trả hợp đồng đã công bố chứa hanoi, quangnam và saigon cho mọi input được chấp nhận. Input rỗng, whitespace-only, punctuation-only, unsupported và numeric MUST trả kết quả đầy đủ rõ ràng hoặc diagnostic có kiểu ổn định; MUST NOT có .zd bị thiếu, duyệt nhầm prototype key thành dialect hoặc ném TypeError không được công bố. Đồng âm nhiều từ SHALL trả mảng rỗng cho mỗi dialect khi input rỗng hoặc chỉ có whitespace và SHALL giữ hợp đồng array-or-count hiện có cho input khác; core MUST NOT dùng chuỗi HTML sentinel làm dữ liệu. Mọi UI adapter SHALL xử lý kết quả rỗng trước khi chia paragraph hoặc lặp mảng.

#### Scenario: Input is empty or whitespace
- **WHEN** core nhận chuỗi rỗng hoặc chuỗi chỉ có khoảng trắng, tab và newline
- **THEN** pronunciation guide trả kết quả rỗng đã công bố cho cả ba dialect và đồng âm trả các mảng rỗng

#### Scenario: Input is zero
- **WHEN** core nhận số 0 hoặc chuỗi 0
- **THEN** nó xử lý theo quy tắc numeric đã công bố mà không thiếu dialect field hoặc làm adapter lỗi

#### Scenario: Input is unsupported
- **WHEN** core nhận token ngoài grammar word/number đã công bố
- **THEN** nó trả diagnostic đầu vào không được hỗ trợ ổn định theo hợp đồng đã công bố và mọi UI adapter vẫn dùng được

#### Scenario: Both website adapters render whitespace
- **WHEN** source js/zd-pron.js thật chạy trên trang pronunciation và homophones với input chỉ có whitespace
- **THEN** cả hai render trạng thái rỗng không có TypeError và vẫn render input hợp lệ tiếp theo

## ADDED Requirements

### Requirement: Homophone enumeration is independent of token stack depth
Phép sinh tích Descartes đồng âm SHALL giữ thứ tự kết quả và giới hạn số tổ hợp đã công bố, và MUST NOT dùng call stack tuyến tính theo số token đầu vào. Input nhiều token nhưng ít tổ hợp SHALL được xử lý đầy đủ mà không bị cắt hoặc tăng giới hạn stack để che lỗi.

#### Scenario: Four thousand singleton tokens
- **WHEN** getMultiWordHomophones nhận 4.000 token xyz cách nhau bằng space và limit 10.000
- **THEN** nó hoàn tất cho mọi dialect không RangeError và trả mảng rỗng sau khi loại tổ hợp trùng input

#### Scenario: Small products preserve order
- **WHEN** các fixture nhiều nhánh chạy qua generator mới và baseline được đặc tả
- **THEN** trình tự tổ hợp và quy tắc loại input gốc giống nhau

#### Scenario: Combinations reach the existing limit
- **WHEN** số tổ hợp đạt hoặc vượt limit
- **THEN** API trả count theo hợp đồng hiện có mà không materialize toàn bộ tích
