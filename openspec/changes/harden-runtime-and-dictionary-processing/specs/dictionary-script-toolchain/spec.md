## ADDED Requirements

### Requirement: Malformed shard CSV fails before publication
Codec CSV dùng chung SHALL hỗ trợ Unicode, escaped quotes, CRLF và newline bên trong quoted field hợp lệ. Nó MUST từ chối EOF khi quote chưa đóng, quote sai vị trí, ký tự không hợp lệ sau quote đóng, và row dữ liệu shard không có đúng ba cột sau khi bỏ qua blank line và header hợp lệ theo hợp đồng hiện có. Lỗi SHALL mang vị trí dòng/cột; loader SHALL bổ sung đường dẫn shard. Lệnh đọc để build hoặc upsert MUST thất bại trước mọi ghi đầu ra nếu dữ liệu cần đọc không hợp lệ.

#### Scenario: Blank lines and valid header remain accepted
- **WHEN** file chỉ có header hợp lệ, có blank lines giữa các row hoặc có newline cuối file
- **THEN** parser bỏ qua chúng theo hợp đồng hiện có và không tạo entry rỗng hoặc báo sai số cột

#### Scenario: Quote is unclosed at EOF
- **WHEN** input là `vi,nom,explain\nba,巴,"\nbốn,四,\n`
- **THEN** parser ném lỗi có vị trí thay vì trả một entry ba đã nuốt entry bốn

#### Scenario: Column shape or quoting is invalid
- **WHEN** row thiếu/thừa cột, quote xuất hiện giữa unquoted field hoặc có ký tự thừa sau quote đóng
- **THEN** loader báo lỗi với vị trí và đường dẫn, và không coi row đó là một entry hợp lệ

#### Scenario: Valid multiline quoted data round-trips
- **WHEN** explain hợp lệ chứa comma, escaped double quote, newline và chữ tiếng Việt
- **THEN** parse rồi serialize rồi parse giữ nguyên các field và các entry độc lập

#### Scenario: A bad shard is used by a writer
- **WHEN** build/upsert cần đọc một shard lỗi
- **THEN** lệnh thất bại và mọi shard/artifact có sẵn hoặc chưa có trước đó vẫn giữ nguyên trạng thái

### Requirement: Release minification follows successful rebuilds
Quy trình `make release-userscripts` SHALL chỉ bắt đầu minify sau khi cả hai userscript build thành công và chỉ bắt đầu publish sau khi toàn bộ build, runtime dictionary và minify thành công. Quan hệ thứ tự này MUST đúng cả khi GNU Make chạy song song. Các lệnh minify/build độc lập SHALL tiếp tục sử dụng được.

#### Scenario: Parallel release has stale artifacts
- **WHEN** `make -j4 release-userscripts` chạy với userscript cũ và builder bị trì hoãn trong fixture
- **THEN** minifier chỉ đọc kết quả build mới sau khi cả hai builder hoàn tất, và publisher chỉ chạy sau minify thành công

#### Scenario: Fresh build has no userscripts yet
- **WHEN** fixture không có userscript root và chạy release song song
- **THEN** minify chờ cả hai builder tạo đầu ra và không đọc file chưa tồn tại

#### Scenario: A build or minify fails
- **WHEN** bất kỳ build hoặc bước minify thất bại
- **THEN** publisher không được gọi; nếu build thất bại thì minifier cũng không được gọi

#### Scenario: Verification uses the real dependency graph
- **WHEN** regression test chạy Makefile thật với NODE mock ghi nhận sự kiện
- **THEN** test xác nhận thứ tự start/end và failure propagation mà không gọi GitHub hoặc ghi artifact thật
