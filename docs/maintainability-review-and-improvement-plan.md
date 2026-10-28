# Rà soát khả năng bảo trì và kế hoạch cải thiện Zoopdog

Ngày rà soát: 2026-10-27 (Asia/Kuala_Lumpur). Commit: `237845170e69b3953f8bb00e5b366be26f297798`.

## Kết luận

Kiến trúc website tĩnh và JavaScript thuần phù hợp với quy mô dự án. Các module dùng chung cho identity, merge dữ liệu, matching và pronunciation giúp giảm phân kỳ giữa website, userscript và CLI. Không có lý do từ đợt rà soát này để chuyển framework hoặc viết lại toàn bộ ứng dụng.

Điểm cần đầu tư trước là tính toàn vẹn dữ liệu, vòng đời annotation, hợp đồng kết quả ở UI và khả năng tái lập build/release. Bộ kiểm thử xanh hiện chưa ngăn được một số lỗi đã có phép tái hiện. Sau khi khép các lỗ hổng này mới nên tách nhỏ runtime và bổ sung công cụ kiểm tra tĩnh.

Đây là tài liệu review và kế hoạch triển khai; các lỗi được nêu bên dưới **chưa được sửa**. Không thay đổi source, test, dictionary, lockfile hoặc thư viện bên thứ ba trong lượt review này.

## Phạm vi và cách đánh giá

Đã rà soát bản đồ 426 file được Git theo dõi, entry point, phụ thuộc và các đường xử lý quan trọng trong:

| Khu vực | Thành phần | Trọng tâm |
| --- | --- | --- |
| Website | `*.jade`, HTML/CSS đã sinh, `js/popupdict.js`, `js/zd-pron.js` | Script loading, UI adapter, selection, lookup, hợp đồng render |
| Shared browser runtime | `zd-extension/js/zd-*.js`, `frame.js`, `showframe.js`, `highlighter.js` | Matching, pronunciation, IndexedDB, MessageChannel, state |
| Userscript | Ba runtime trong `scripts/userscript/`, CSS tương ứng | Mutation, ownership, selection, storage, local requests |
| Data/build | Builders, `scripts/lib/`, user entries/order, chunom layer | Normalization, lossless grouping, CSV, artifact/version |
| Quy trình | `Makefile`, package/lockfile, watcher, release, OpenSpec lifecycle | Thứ tự chạy, tính tái lập, freshness, failure handling |
| Kiểm thử/tài liệu | `test/`, helpers, docs, AGENTS, active OpenSpec | Độ tin cậy của gate, khoảng trống tích hợp, tài liệu sai lệch |

Review đi sâu vào các đường có tác động tới việc thay đổi và bảo trì; không phải chứng nhận mọi dòng mã đều đúng. Dữ liệu từ điển lớn và thư viện minified được xem như input/phụ thuộc, không được kiểm định từng mục hay audit nội bộ. Không chạy audit bảo mật dependency qua mạng, trình duyệt thật, phát hành GitHub hoặc dịch vụ `book-translator`.

Đã đọc lại [review hiện có](../openspec/changes/harden-runtime-and-dictionary-processing/review.md), [design](../openspec/changes/harden-runtime-and-dictionary-processing/design.md) và [tasks](../openspec/changes/harden-runtime-and-dictionary-processing/tasks.md). F01–F09 bên dưới tương ứng R1–R9 của change này và được xác minh lại trên commit hiện tại; không coi chúng là phát hiện mới. F10–F17 mở rộng góc nhìn về khả năng bảo trì.

Mức ưu tiên: P1 = có thể mất/biến đổi nội dung người dùng hoặc nghĩa từ điển; P2 = lỗi chức năng, build/release hoặc gate cần xử lý sớm; P3 = nợ kiến trúc và quy trình. Không có P0 được xác nhận trong phạm vi này.

## Phát hiện theo ưu tiên

### F01 — P1: Gộp nghĩa theo giao token làm mất nội dung

- Nguồn: [dictionary-identity.js](../scripts/lib/dictionary-identity.js), `isRedundantVariant` khoảng dòng 434–450, `verifyLossless` khoảng dòng 612–638.
- Hiện trạng: một token chung đủ để coi hai bundle nghĩa là dư thừa. Validator dùng lại cùng predicate nên không phát hiện quyết định gộp sai.
- Tái hiện: `sharp, biting, cutting` và `sharp, acute, keen` chỉ còn bundle đầu. Dữ liệu thật `bao bọc` mất `protect` trong output popup builder.
- Hệ quả bảo trì: thêm một quy tắc heuristic có thể làm mất nghĩa trên cả website và userscript mà verification vẫn đạt.
- Hướng sửa: quan hệ bao phủ có hướng; giữ cả hai bundle khi chỉ giao một phần. Kiểm chứng độc lập nội dung, POS và headword, thay vì chỉ gọi lại predicate quyết định gộp.
- Nghiệm thu: regression fixture và `bao bọc` giữ đủ nghĩa; output cố ý thiếu token/POS/headword phải bị validator từ chối. Không sửa dữ liệu nguồn để làm test đạt.
- Theo dõi: OpenSpec hiện có, mục 1.

### F02 — P1: Annotation trải nhiều node không cleanup đầy đủ khi node sau đổi

- Nguồn: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), `annotateAcrossNodes`, khoảng dòng 496–546; bookkeeping chỉ ghi phần chèn của segment đầu ở dòng 530–532.
- Tái hiện trên DOM harness hiện có: hai wrapper `tình ` và `cảm`; sau annotation, trang đổi text node thứ hai thành `bạn`. Kết quả visible text là `tình bạncảm`, ruby còn `情 / 伴 / 感`.
- Hệ quả: userscript làm sai nội dung nhìn thấy của caption/widget cập nhật động. Việc chỉ vá matcher không giải quyết ownership của DOM đã chèn.
- Hướng sửa: quản lý ownership cho mọi source segment của span; một segment thay đổi phải reconcile toàn bộ annotation liên quan, giữ nội dung mới của trang.
- Nghiệm thu: mutation đầu/giữa/cuối, node removal, nhiều match chung source, NFC/NBSP, shadow root và trailing text đều không nhân đôi/mất nội dung.
- Theo dõi: OpenSpec hiện có, mục 3.

### F03 — P2: CSV thiếu quote đóng được chấp nhận, nuốt entry kế tiếp

- Nguồn: [nom-entries-csv.js](../scripts/lib/nom-entries-csv.js), `parseCsv`, dòng 28–86.
- Tái hiện: `vi,nom,explain\nba,巴,"\nbốn,四,\n` trả một entry `ba` có explain `bốn,四,`; serialize lại không còn entry `bốn` độc lập.
- Hệ quả: một lỗi gõ trong shard có thể âm thầm thay đổi cấu trúc dữ liệu; lần ghi sau có thể giữ lại dạng đã bị nuốt.
- Hướng sửa: từ chối EOF khi còn `inQuotes`, quote sai vị trí và cấu trúc row không hợp lệ; lỗi phải kèm file/shard và vị trí. Không tự động “sửa” dữ liệu lỗi.
- Nghiệm thu: thiếu quote thất bại trước mọi write; multiline/escaped quotes/blank lines/header hợp lệ vẫn round-trip đúng.
- Theo dõi: OpenSpec hiện có, mục 2.

### F04 — P2: Make graph cho phép minify trước khi build xong

- Nguồn: [Makefile](../Makefile), dòng 43–48.
- Tái hiện: chạy graph thật `make -j4 release-userscripts` với `NODE` thay bằng logger, không gọi publisher thật. Minify kết thúc trước ba builder khoảng 290 ms.
- Hệ quả: checkout sạch có thể thiếu artifact; checkout cũ có thể release dist không tương ứng source hiện tại. Việc publish đợi tất cả prerequisite không đảm bảo minify đã dùng input mới.
- Hướng sửa: biểu diễn dependency build → minify → publish trong graph. Giữ `DRY_RUN=1` không publish, nhưng ghi rõ nó vẫn có thể build output.
- Nghiệm thu: mock start/end xác nhận thứ tự ở `-j1` và `-j4`; lỗi builder chặn minify/publish; lỗi minify chặn publish.
- Theo dõi: OpenSpec hiện có, mục 2.

### F05 — P2: Mutation của text node bypass exclusion của tổ tiên

- Nguồn: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), `mutationHandler` dòng 115–126 và text-node dispatch dòng 221–222.
- Tái hiện: đổi text node trong `<code>` từ `foo` thành `bạn` sau startup tạo ruby `伴` trong code, dù initial traversal loại vùng này.
- Hệ quả: hợp đồng “không annotate editor/code” phụ thuộc cách nội dung được cập nhật; khó bảo trì các entry point độc lập.
- Hướng sửa: một hàm eligibility xét tổ tiên dùng chung cho initial scan, additions và characterData; kiểm tra lại lúc flush.
- Nghiệm thu: excluded tags, contenteditable và node chuyển vào editor khi đang queue không bị sửa; văn bản hợp lệ bên ngoài vẫn được annotate.
- Theo dõi: OpenSpec hiện có, mục 4.

### F06 — P2: Mutation nhỏ có thể quét lại toàn container lớn

- Nguồn: [nom-ruby.runtime.js](../scripts/userscript/nom-ruby.runtime.js), dòng 126 queue `mutationRecord.target`.
- Tái hiện: sau initial scan 100 paragraph không match, append một div rỗng vào body gây 300 lượt đọc `nodeValue` của text cũ.
- Hệ quả: chi phí tăng theo kích thước feed/SPA thay vì vùng thay đổi. Interval và requestAnimationFrame không giải quyết lượng công việc mỗi lần flush.
- Hướng sửa: queue dirty/added regions và vùng nối có giới hạn; deduplicate; bỏ own mutations. Giữ cơ chế recover-missed-first-line đã được mô tả trong code.
- Nghiệm thu: counter test trên ít nhất hai kích thước DOM; append nhỏ không đọc toàn bộ text cũ, đồng thời cross-wrapper và delayed-line regressions vẫn đạt.
- Theo dõi: OpenSpec hiện có, mục 4.

### F07 — P2: Popup lookup nhận thuộc tính kế thừa như entry thật

- Nguồn: [popupdict.runtime.js](../scripts/userscript/popupdict.runtime.js), `lookupContext`, dòng 570–580.
- Tái hiện: dictionary qua `JSON.parse` chỉ có `bạn`; lookup `constructor` trả results kiểu function từ `Object.prototype`. Consumer mong mảng và có thể ném lỗi khi render.
- Hướng sửa: own-property check hoặc dictionary không có prototype, giữ được entry hợp lệ mang tên `constructor`.
- Nghiệm thu: key vắng mặt trả miss; key `constructor` thật trả đúng data; kiểm tra payload qua `JSON.parse`, không chỉ object literal được dựng đặc biệt.
- Theo dõi: OpenSpec hiện có, mục 5.

### F08 — P2: Core và UI adapter không thống nhất kết quả rỗng

- Nguồn: [zd-pron.js](../js/zd-pron.js), dòng 39–52 và 89–94; [zd-pron-core.js](../zd-extension/js/zd-pron-core.js), `getMultiWordHomophones`, khoảng dòng 517–519.
- Tái hiện bằng source adapter thật trong VM: input ba dấu cách làm pronunciation ném `Cannot read properties of null (reading 'forEach')`; homophone ném `results.forEach is not a function`.
- Nguyên nhân: `!input.value` không bắt whitespace; `.zd.match(...)` có thể trả null, còn homophone core trả HTML sentinel `&nbsp;` thay vì mảng.
- Hướng sửa: adapter xử lý trạng thái empty; core trả mảng rỗng thống nhất cho kết quả rỗng, placeholder thuộc UI. Giữ hợp đồng count khi vượt limit hoặc thay bằng kiểu kết quả có tag trong một thay đổi riêng có migration.
- Nghiệm thu: empty/space/tab/newline/punctuation, zero, unsupported input và nhập hợp lệ sau trạng thái rỗng đều có test core + adapter.
- Theo dõi: OpenSpec hiện có, mục 5.

### F09 — P2: Limit số kết quả không chặn stack depth theo số token

- Nguồn: [zd-pron-core.js](../zd-extension/js/zd-pron-core.js), `getPermutations`, khoảng dòng 491–494.
- Tái hiện: `getMultiWordHomophones(Array(4000).fill('xyz').join(' '), 10000)` ném `RangeError: Maximum call stack size exceeded` mặc dù tích chỉ có một khả năng.
- Hướng sửa: tạo Cartesian product bằng vòng lặp/iterator; chỉ join khi có kết quả hoàn chỉnh; giữ thứ tự và giới hạn hiện tại.
- Nghiệm thu: 4.000 singleton token không tràn stack, tích nhiều nhánh nhỏ giữ thứ tự, trường hợp đạt/vượt limit không tạo toàn bộ kết quả.
- Theo dõi: OpenSpec hiện có, mục 5.

### F10 — P2: Phiên bản release phụ thuộc artifact cục bộ bị Git bỏ qua

- Nguồn: [userscript.js](../scripts/lib/userscript.js), dòng 178–208; [release-userscripts.js](../scripts/release-userscripts.js), `main`; `.gitignore` loại root userscripts. Docs build đã nhắc cần giữ build cũ nhưng chưa có cơ chế enforce.
- Tái hiện trong thư mục tạm, cùng một ngày: hai build thay nội dung lần lượt có version `2026.10.27` và `2026.10.27.1`; build nội dung mới hơn ở đường dẫn sạch lại có `2026.10.27`. `compareVersions(fresh, published)` trả `-1`.
- Hệ quả: release từ máy mới có thể không được userscript manager coi là bản cập nhật. Cùng commit cũng không xác định đầy đủ version nếu thiếu state cục bộ.
- Hướng sửa: nguồn version có thẩm quyền cho release, độc lập root artifact: tham số release version hoặc metadata release đã xác minh; fail nếu không chứng minh version mới lớn hơn bản đã phát hành. Build phát triển và release stamping nên có trách nhiệm riêng.
- Nghiệm thu: hai release cùng ngày từ hai thư mục sạch có version tăng; version bằng/thấp hơn bị chặn; build lặp lại không đổi nội dung giữ version khi dùng cùng manifest; test không gọi GitHub thật.

### F11 — P2: Hai atomic rename không phải transaction cho cặp dictionary/metadata

- Nguồn: [build-extension-vnedict-json.js](../scripts/build-extension-vnedict-json.js), dòng 160–177.
- Tái hiện bằng writer injection trên file tạm: ngay sau write dictionary, SHA-256 của payload khác revision trong metadata cũ. Comment “never a mix” mạnh hơn guarantee thực tế.
- Hệ quả: server đọc đúng lúc rebuild có thể nhận cặp lệch, coordinator chuyển stale/unavailable. Digest checking hiện có giảm nguy cơ cài dữ liệu sai; đây là vấn đề availability/publication, không phải bằng chứng dữ liệu sai đã được cài.
- Hướng sửa: publish payload theo revision bất biến rồi đổi metadata/pointer cuối cùng; consumer lấy đúng payload theo revision. Phương án nhỏ hơn là ngừng phục vụ trong lúc thay generation, nhưng phải mô tả rõ giới hạn. Catch/rollback chỉ xử lý một số exception, không xử lý process crash hay concurrent readers.
- Nghiệm thu: reader xen giữa các bước và fault injection không nhận generation thiếu payload; crash/retry giữ generation trước; test stale fallback tiếp tục đạt. Nếu chọn revision URL, giữ tương thích consumer cũ và release asset naming có chủ đích.

### F12 — P2: Verification phụ thuộc artifact hiện có và tự rebuild khi bất kỳ test nào lỗi

- Nguồn: [ensure-built.js](../test/helpers/ensure-built.js), dòng 9–16, 40–54; [Makefile](../Makefile), dòng 96–103.
- Quan sát tĩnh: userscript helper chỉ xét tồn tại. Runtime helper xét mtime một tập input nhưng không gồm `scripts/user-nom-order.js`, `scripts/user-nom-entries.js`, `scripts/chunom-standard-layer.js`. Các file này được builder import trực tiếp/gián tiếp và có thể đổi output.
- Make retry toàn suite sau mọi lỗi, không phân biệt artifact cũ, lỗi source, hay flaky test. Nhiều test file gọi helper ở top level, có thể cùng khởi tạo output trên checkout sạch khi Node chạy song song.
- Hệ quả: kết quả phụ thuộc thứ tự/lịch sử máy; failure đầu bị làm mờ; test và build cùng ghi output dùng chung. Rủi ro concurrent build được suy ra từ cấu trúc, chưa được stress-test ở review này.
- Hướng sửa: một bước prepare rõ ràng, một lần trước test; workspace artifact riêng cho mỗi run. Dùng input manifest/hash đầy đủ hoặc luôn build trong preparation. Gate test phải giữ exit status lỗi đầu; tiện ích refresh/retry chỉ chạy opt-in.
- Nghiệm thu: checkout sạch và warm checkout cho cùng kết quả; sửa từng input thật khiến output thay đổi hoặc cache invalidation đúng; test cố ý fail vẫn fail gate; hai test process không ghi cùng file. Không chỉ tăng mtime để giả lập mọi trường hợp.

### F13 — P2: Toolchain build trang/style chưa được khóa trong repository

- Nguồn: [package.json](../package.json) chỉ pin esbuild; [docs/build.md](build.md), dòng 3–5 nói không có package.json; không có Node version pin/engines trong file được theo dõi.
- Hệ quả: contributor mới không thể suy ra đầy đủ runtime/CLI tương thích; output HTML/CSS được commit có thể khác theo Pug/Stylus cài trên máy. Cấu hình cloud đã chuẩn bị CLI ngoài checkout chỉ phục vụ môi trường hiện tại, chưa giải quyết tính tái lập của repository.
- Hướng sửa: chọn Node LTS được hỗ trợ, xác định minimum cho APIs đang dùng; pin Pug CLI/Stylus theo output baseline đã review; thêm Make target build/check cho trang và style. Dùng `npm ci` với lockfile. Không tự động nâng compiler rồi commit hàng loạt output mà chưa xem diff.
- Nghiệm thu: máy sạch dùng duy nhất hướng dẫn repo để cài/build/test; compile vào thư mục tạm và so artifact; sai lệch được phân loại là thay đổi có chủ đích hoặc lỗi cần xử lý.

### F14 — P2: Không có CI được theo dõi để thực thi các gate đã có

- Bằng chứng: `git ls-files` không có `.github/workflows/*` hoặc cấu hình CI thông dụng trong root. Không suy luận rằng tổ chức không có CI ngoài repository.
- Hệ quả: local verification là một quy ước, chưa có bằng chứng tự động chạy trên mỗi PR; kiểm tra package/build/minify và drift của HTML/CSS chưa có target CI hoàn chỉnh.
- Hướng sửa: workflow PR dùng toolchain đã pin, frozen install, prepare, test, syntax, build/minify và drift check; không publish từ PR. Report audit tùy chọn riêng, không bỏ qua âm thầm.
- Nghiệm thu: PR cố ý làm hỏng syntax, regression, build hoặc artifact drift đều đỏ; PR docs-only có thể dùng check nhẹ nếu paths được cấu hình đúng. Quy tắc required check/branch protection do maintainer áp dụng sau khi workflow ổn định.

### F15 — P3: Runtime lớn dùng lexical scope chung làm thay đổi khó cô lập

- Nguồn: popup runtime 1.412 dòng; local fragment 1.937 dòng; nom runtime 685 dòng ở commit này. Local fragment được nối vào cùng IIFE và dùng helper/global của core theo tên; có nhiều nhánh `typeof zoo... === 'function'`.
- Hệ quả: thứ tự nối và tên hàm là API ngầm. Một tính năng local có thể phụ thuộc storage, selection, HTTP, form state và DOM rendering cùng lúc. Không phải cứ file lớn là bug; rủi ro nằm ở sự phụ thuộc không được khai báo.
- Hướng sửa: tách dần queue/storage, selection UI, popup geometry/rendering, local transport, modal state; truyền dependencies hoặc namespace API nhỏ. Tiếp tục sinh userscript độc lập qua builder hiện có, không bắt buộc framework/bundler mới.
- Nghiệm thu: public API và lifecycle start/stop rõ; test module chạy độc lập; parity của dictionary/rendering, metadata grants và kích thước bundle được so với baseline. Không tách cả ba runtime trong cùng một PR.

### F16 — P3: Hợp đồng với book-translator và browser globals thiếu điểm kiểm tra tập trung

- Nguồn: [popupdict-local.runtime.js](../scripts/userscript/popupdict-local.runtime.js), `ZOO_LOCAL_BASE`, `zooHttpRequest`, các form; [showframe.js](../zd-extension/js/showframe.js), dòng 12, 65–81 vẫn có fallback `chrome.runtime`/`chrome.storage`; [local-mode.md](local-mode.md) mô tả các form được mirror từ repository khác.
- Hệ quả: unit test mock có thể đạt trong khi server đổi shape; website thường không có `chrome.storage` nên vị trí pin không được lưu và exception bị nuốt. Đây là đường fallback/khả năng bảo trì được quan sát, chưa kiểm thử hành vi trình duyệt thật trong lượt này.
- Hướng sửa: bảng contract endpoint/method/request/response/version và fixture tương thích do hai repository dùng; adapter storage/URL tường minh cho website, userscript và host cũ. Chỉ đổi API nếu đồng thời sửa/test book-translator theo AGENTS.md.
- Nghiệm thu: fixture cũ/mới và response lỗi có test; website khởi tạo không cần Chrome extension API; hành vi lưu pin được nêu rõ và test bằng storage adapter. Không thêm retry tự động cho write request chưa có idempotency.

### F17 — P3: Tài liệu và một số test cấu trúc chưa phản ánh contract hiện tại

- Nguồn: [docs/build.md](build.md), đoạn đầu và phần userscript còn gọi output là committed; [AGENTS.md](../AGENTS.md) còn nhắc `user_nom_entries.jsonc` trong overview dù store là shards; [local-mode.md](local-mode.md) phần Two builds còn nói raw GitHub URL; [runner.md](../runner.md) hướng dẫn build rồi `git add -A`/push nhưng output hiện phát hành qua release assets.
- Test cấu trúc như [scripts-structure.test.js](../test/scripts-structure.test.js) dùng regex để kiểm tra source; test performance dùng tỷ lệ wall-clock. Chúng có giá trị riêng nhưng không thay thế regression hành vi và có thể khó refactor/flaky khi được dùng quá rộng.
- Hướng sửa: một quickstart và bảng source → generated artifact → nơi publish; docs chi tiết liên kết tới đó. Thêm JSDoc typedef cho grouped row, popup tuple, order row, readiness, transport payload; dùng kiểm tra tĩnh có phạm vi, bắt đầu từ module thuần. Giữ structural check thật sự là kiến trúc contract, chuyển assertion về spelling sang behavior khi phù hợp; performance có counter gate và benchmark riêng.
- Nghiệm thu: lệnh trong docs chạy được trên checkout sạch; không còn khẳng định trái package/ignore/release thực tế; thay tên biến nội bộ không làm test hành vi fail; lỗi shape được phát hiện tại boundary. Không bật lint toàn kho rồi format hàng loạt dữ liệu/library.

## Những nền tảng nên giữ

- Dùng chung `dictionary-identity`, `nom-merge`, `text`, `zd-nom-match`, `zd-words` và pronunciation core giữa các consumer; bổ sung contract quanh chúng thay vì tạo implementation thứ hai.
- Coordinator dictionary có validation, SHA-256 khi được hỗ trợ, transaction IndexedDB và stale fallback. Cần giữ các trạng thái phân biệt khi thay cơ chế publication.
- Sandbox iframe và MessageChannel có validation bounded payload; không chuyển sang nhận message rộng không kiểm tra.
- Bộ test có characterization, matcher equivalence, DOM harness, filesystem fixtures và import-side-effect checks. Nên mở rộng các điểm giao tiếp đang thiếu thay vì thay cả test framework.
- Hand-maintained shard/order là dữ liệu người dùng. Không dùng reset/stash/discard để chữa test; không gộp cleanup dữ liệu vào refactor.
- OpenSpec lifecycle mặc định read-only và archive opt-in; giữ sự phân biệt thao tác kiểm tra với thao tác thay đổi trạng thái.

## Kế hoạch triển khai theo giai đoạn

Ước lượng là effort tương đối cho một maintainer đã hiểu code, chưa bao gồm thời gian phối hợp hoặc sửa phát sinh. Mỗi giai đoạn chia thành PR nhỏ; chỉ cập nhật checkbox khi có bằng chứng nghiệm thu.

| Giai đoạn | Phạm vi | Effort dự kiến | Phụ thuộc | Điều kiện hoàn tất |
| --- | --- | --- | --- | --- |
| A | Khóa baseline, F01–F03 | 3–5 ngày | Không | Không mất nghĩa, annotation không nhân chữ, CSV lỗi fail trước write |
| B | F04–F09 | 3–5 ngày | Baseline A; F04 có thể làm độc lập | Regression runtime/UI và graph song song đạt |
| C | F10–F12 | 3–5 ngày | F04 trước release gate | Version có thẩm quyền, generation nhất quán, test không tự chữa lỗi |
| D | F13–F14, docs F17 | 2–4 ngày | Preparation C trước CI hoàn chỉnh | Checkout sạch tái lập, PR checks và drift checks đạt |
| E | F15–F17 | 4–7 ngày, chia nhiều PR | Regression A–D | Module/API rõ, behavior parity và browser smoke đạt |

### A — Bảo toàn dữ liệu và ownership

- [ ] Lưu baseline của source revision, candidate order, số entry, artifact digest và output có chủ đích. Không dùng digest toàn bộ làm oracle duy nhất khi cần thay output đúng.
- [ ] Thêm test thất bại cho F01, sau đó sửa grouping và validator độc lập; review thống kê thay đổi sense/headword/POS trên dữ liệu thật.
- [ ] Thêm test thất bại cho F02, sửa ownership mọi segment; giữ các regression cross-node/shadow/removal.
- [ ] Thêm malformed CSV fixtures cho F03; giữ codec round-trip và error context tại loader.
- [ ] Dùng task tương ứng trong OpenSpec hiện có; không tạo change thứ hai mô tả cùng R1–R3.

### B — Chức năng và chi phí runtime

- [ ] Sửa graph Makefile và thêm test logger có assertion thứ tự/failure propagation (F04).
- [ ] Hợp nhất eligibility rồi giới hạn dirty regions, đo bằng counter (F05–F06). Giữ behavior first-line recovery trước khi tối ưu.
- [ ] Chặn inherited dictionary hit và kiểm tra entry cùng tên thật (F07).
- [ ] Chuẩn hóa empty result ở core/UI, thêm VM adapter test (F08).
- [ ] Loại recursion theo token trong Cartesian product, giữ thứ tự và limit (F09).
- [ ] Đóng OpenSpec harden-runtime-and-dictionary-processing chỉ sau khi task/test/browser evidence đủ; không đánh dấu hoàn tất từ tài liệu review.

### C — Build và release có thể tin cậy

- [ ] Xác định version authority, local dev stamping và release preflight riêng; mock registry/release metadata trong test (F10).
- [ ] Chọn publication generation và kế hoạch tương thích consumer; bổ sung xen kẽ reader/writer, crash/fault cases (F11).
- [ ] Tách prepare khỏi verify, dùng artifact directory riêng theo run; loại blanket retry của gate và kiểm thử warm/cold/concurrent preparation (F12).
- [ ] Sinh manifest gồm commit, Node/tool versions, input hashes, optional chunom/font state, artifact hashes và release versions. Optional input absent phải được ghi rõ, không coi hai build có/không layer là tương đương.
- [ ] Release dry-run kiểm tra manifest, version, metadata/header, tồn tại và digest artifact; không gọi `gh release create` trong test.

### D — Contributor workflow và CI

- [ ] Pin toolchain/CLIs và thêm `build-pages`, `build-styles`, `check-generated` hoặc tên tương đương có mô tả đầy đủ (F13).
- [ ] Tạo quickstart: `npm ci`, prepare, verify, serve; ghi rõ Node version, local mode tùy chọn, required/optional network và secrets (mặc định không cần secrets).
- [ ] Thêm CI PR chạy gate tái lập; minify/build và kiểm tra artifact drift vào thư mục tạm (F14).
- [ ] Audit từ điển tùy chọn chạy riêng theo lịch/thay đổi dữ liệu, báo outcome thật; không coi test bị skip là đã audit.
- [ ] Sửa hướng dẫn stale trong build/local-mode/AGENTS/runner khi thay contract tương ứng; PR phải review cả tài liệu lẫn lệnh thực tế (F17).

### E — Giảm coupling có kiểm soát

- [ ] Tách transport và storage adapter trước, rồi queue/selection/modal modules; giữ entry point và builder output tương thích (F15).
- [ ] Viết JSDoc shape và dependency map ngắn; thử static checking trên module thuần trước khi mở rộng.
- [ ] Chuẩn hóa contract local mode với maintainer book-translator; không thay endpoint/payload/hotkey/control UI chỉ trong repository này (F16).
- [ ] Thêm browser smoke tối thiểu: dictionary IndexedDB fresh/stale/retry, sandbox frame load/message/resize, whitespace và long-input pronunciation, selection/pointer, dynamic cross-node rewrite, excluded editor và open shadow root.
- [ ] Thử strict Trusted Types CSP và userscript manager thực tế; pass-through policy hiện tại không đủ bằng chứng tương thích mọi CSP. Kiểm tra khả năng tạo policy và fallback bằng test trước khi tuyên bố hỗ trợ.
- [ ] Tách performance benchmark khỏi gate dễ nhiễu; giữ counter/complexity regression cố định. Ghi số đo trước/sau trên cùng dataset và máy.

## Chiến lược kiểm chứng và tiêu chí đóng kế hoạch

1. Mỗi bug fix bắt đầu bằng regression thất bại trên source hiện tại; fix đúng phạm vi, không xóa assertion hay thay dữ liệu để né lỗi.
2. Test module thuần dùng fixture nhỏ; test parity dùng snapshot dữ liệu thật có xác định provenance. Tránh nhiều test process tự viết cùng artifact root.
3. Sau thay đổi builder/runtime, build lại artifact vào đường dẫn tạm hoặc gitignored rồi so nội dung, version, grants và kích thước. Với thay đổi có chủ đích, review semantic diff thay vì yêu cầu byte-identity tuyệt đối.
4. Chạy suite Node, syntax, minify, page/style build, check-generated và OpenSpec lifecycle tương ứng. Giữ exit status thật và phân biệt fail/skip/unrun.
5. Browser smoke phải chứng minh tương tác và IndexedDB/MessageChannel thật; DOM harness không thay thế hoàn toàn layout, font, CSP, selection hoặc userscript manager.
6. Trước merge, kiểm tra `git status --short`; PR chỉ gồm source/test/docs/artifact thuộc thay đổi đó. Không thêm dependency lớn chỉ để chia nhỏ code.

Kế hoạch được coi là hoàn tất khi F01–F14 có regression/gate và evidence đóng, F15–F17 có ranh giới module/tài liệu/contract đã nghiệm thu, và browser smoke cần thiết có kết quả ghi lại. Các quyết định trì hoãn phải có lý do, phạm vi ảnh hưởng và điều kiện xem lại; không đánh dấu “đã sửa” chỉ vì suite hiện tại xanh.

## Bằng chứng chạy trong đợt review này

| Kiểm tra | Kết quả |
| --- | --- |
| `node --test test/*.test.js` | Exit 0; 359 test: 358 pass, 0 fail, 1 skip; khoảng 28 giây |
| Audit skipped | `ZD_REVIEW_DICTIONARY=1` chưa bật; không kết luận audit nghĩa từ điển đã đạt |
| `find scripts -name '*.js' -print0 \| xargs -0 -n1 node --check` | Exit 0 |
| `make verify-browser` | Exit 0 |
| `make check-openspec` | Exit 0; harden-runtime change actionable; chunom-layer-hardening archive-eligible; không archive |
| Phép tái hiện F01–F09 | Chạy lại hai code block trong review OpenSpec hiện có với source thật; cả 9 hành vi lỗi vẫn xuất hiện |
| F04 mock release | Chỉ logger thay NODE trên Makefile thật; không publish, push hay gọi GitHub API |
| F10 version | API version writer thật trên thư mục tạm; bản fresh thấp hơn bản thứ hai cùng ngày |
| F11 publication | Writer injection trên file tạm xác nhận payload/metadata khác revision giữa hai write |
| Browser, book-translator, dependency security audit | Chưa chạy; không khẳng định tương thích hoặc an toàn đầy đủ |

Log tại máy review: `/tmp/zoopdog-review-tests.log`, `/tmp/zoopdog-review-repro-1.log`, `/tmp/zoopdog-review-repro-2.log`. File tạm không phải artifact được commit hoặc điều kiện để dùng kế hoạch.

Môi trường xác minh: Node `v24.19.0`, npm `11.9.0`. Review dùng suite trực tiếp và syntax targets riêng để không kích hoạt nhánh blanket rebuild/retry của `make verify`. Source runtime và dữ liệu được giữ nguyên; chỉ thêm tài liệu kế hoạch này.
