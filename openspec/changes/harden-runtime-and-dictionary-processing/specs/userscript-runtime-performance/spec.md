## MODIFIED Requirements

### Requirement: Annotation produces the same DOM
Runtime nom-ruby SHALL giữ cấu trúc DOM của phép chèn một lượt và nhiều lượt tương đương: source text node giữ phần đầu, tiếp theo là ruby.zoopdog-nom-ruby và các tail text node. Runtime SHALL bỏ qua text không chứa word character, giữ hành vi NFC đã công bố, và quản lý ownership của mọi source segment cùng node được chèn khi một match trải qua nhiều node. Khi trang thay đổi hoặc loại bỏ một source segment, runtime MUST retire annotation cũ bị ảnh hưởng, bảo toàn nội dung mới của trang và annotate lại vùng hợp lệ mà không giữ thêm chữ cũ.

#### Scenario: Batched insertion
- **WHEN** một text node chứa ba match
- **THEN** child list bằng trình tự mà thuật toán splitText từng match tạo ra và node gốc vẫn chứa phần đầu

#### Scenario: Streaming page rewrites a node
- **WHEN** trang viết lại text của một node đã annotate
- **THEN** các node đã chèn cho nội dung cũ bị dọn và nội dung mới được annotate một lần

#### Scenario: A later source segment is rewritten
- **WHEN** `tình ` và `cảm` trong hai wrapper được annotate như một cụm rồi trang đổi source node thứ hai thành `bạn`
- **THEN** visible text là `tình bạn`, không có chữ cảm hoặc ruby của cụm cũ còn lại, và nội dung mới được xét annotate đúng một lần

#### Scenario: First, middle and last segments change
- **WHEN** trang viết lại node đầu, giữa hoặc cuối của một match nhiều node
- **THEN** runtime retire mọi phần annotation cũ liên quan, giữ nguyên nội dung của trang và các match không liên quan

#### Scenario: A source segment is removed
- **WHEN** trang tháo bỏ hoặc thay một wrapper chứa source segment
- **THEN** cleanup không hồi sinh wrapper hoặc snapshot đã bị trang xóa và không để lại annotation cũ ở các segment còn lại

## ADDED Requirements

### Requirement: Annotation eligibility is consistent across entry points
Runtime SHALL áp dụng một chính sách exclusion tổ tiên chung trước mọi phép annotation, bao gồm initial traversal, subtree addition, direct characterData và flush của queue. Text dưới code, pre, script, style, textarea, input, select, ruby/rt hoặc vùng editable bị loại trừ theo chính sách hiện có MUST NOT bị sửa bởi annotation, kể cả khi text hoặc vị trí DOM thay đổi sau startup.

#### Scenario: Excluded text is updated after startup
- **WHEN** một text node đã có dưới vùng bị loại đổi từ `foo` sang `bạn`
- **THEN** nội dung mới giữ nguyên và không có ruby nào được chèn

#### Scenario: A queued node moves into an editor
- **WHEN** node được queue ở vùng hợp lệ rồi chuyển vào contenteditable trước flush
- **THEN** runtime kiểm tra lại eligibility và không sửa node trong editor

#### Scenario: Eligible text remains annotatable
- **WHEN** cùng văn bản được thêm hoặc cập nhật bên ngoài vùng bị loại
- **THEN** cả initial traversal và mutation path tạo cùng kết quả annotation

### Requirement: Mutation work follows the changed region
Runtime SHALL xử lý child-list mutation bằng vùng mới/dirty cùng vùng nối cần thiết cho matching và cleanup ownership. Một mutation nhỏ MUST NOT mặc định làm phân tích lại toàn body hoặc mọi text node không liên quan của target lớn. Việc reconcile SHALL có giới hạn traversal rõ ràng, giữ cross-wrapper matching, shadow-root support, coalescing theo tổ tiên và bỏ qua mutation do runtime tạo.

#### Scenario: Empty body addition does not rescan old paragraphs
- **WHEN** sau initial scan của 100 paragraph, một div rỗng được append trực tiếp vào body
- **THEN** text của 100 paragraph cũ không bị đọc/phân tích lại chỉ vì target là body

#### Scenario: One leaf changes in a large feed
- **WHEN** một leaf mới có văn bản xuất hiện trong feed có nhiều paragraph cũ
- **THEN** công việc phân tích chỉ thuộc leaf và vùng nối liên quan có giới hạn, không tăng theo toàn bộ số paragraph cũ

#### Scenario: A delayed line recovers its neighbor
- **WHEN** một dòng widget đến muộn và trường hợp missed-first-line trong fixture hiện tại cần reconcile dòng liền kề
- **THEN** các dòng liên quan vẫn được annotate mà không mở rộng thành quét toàn trang

#### Scenario: Performance verification counts work
- **WHEN** test đo một mutation nhỏ trên hai DOM có lượng nội dung cũ khác nhau
- **THEN** counter traversal/phân tích xác nhận nội dung không liên quan không bị quét lại; wall-clock timing không phải gate duy nhất
