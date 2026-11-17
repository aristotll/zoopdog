# Zoopdog — Rà soát hiệu năng, khả năng bảo trì và kế hoạch cải thiện

Ngày rà soát: 2026-11-17. Commit: `2ec7533`. Phạm vi: toàn bộ mã nguồn do dự án viết
(`scripts/`, `scripts/userscript/`, `zd-extension/js/`, `js/`, `test/`, `Makefile`, CI, tài liệu),
không gồm thư viện bên thứ ba đã minify và nội dung dữ liệu từ điển.

Tài liệu này nối tiếp [bản rà soát 2026-10-27](maintainability-review-and-improvement-plan.md)
(F01–F17, phần lớn đã xong). Bản đó tập trung vào toàn vẹn dữ liệu, build và phát hành; bản này
tập trung vào **chi phí lúc chạy trong trình duyệt** và **chi phí bảo trì mã**. Các mục F cũ còn mở
không được lặp lại ở đây, chỉ được nhắc ở mục 5.

## 1. Kết luận

Kiến trúc hiện tại (JavaScript thuần, không framework, dữ liệu dùng chung, test `node:test`) phù
hợp và nên giữ. Engine khớp Chữ Nôm (`zd-nom-match.js`) đã được tối ưu tốt: bảng tra ký tự, chỉ
mục theo từ, quy hoạch động tính một lần cho mỗi run. Không có lý do để viết lại.

Ba việc đáng làm nhất, theo thứ tự:

1. **Userscript popup trả giá cố định rất lớn trên mọi trang và mọi iframe**: parse 6,2 MB JSON
   (~90–160 ms, ~40 MB heap) ngay khi nạp, dù người dùng chưa hề rê chuột vào từ tiếng Việt nào
   (P1). Đây là chi phí lớn nhất toàn dự án và sửa được bằng một thay đổi nhỏ.
2. **Đường xử lý `pointermove` làm việc thừa trên mỗi sự kiện**: không gộp theo khung hình, và khi
   tra không thấy thì ghi chẩn đoán bằng `Object.keys(ZOO_DICTIONARY).length` (~13 ms mỗi lần, cấp
   phát mảng 78 000 phần tử) (P2, P3).
3. **Bốn runtime userscript (5 949 dòng) dùng chung một phạm vi từ vựng và lặp lại cùng một bộ
   hạ tầng** (hàng đợi mutation, quét định kỳ, chèn style, chọn chế độ, thẻ loại trừ). Chỉ một
   module nhỏ được kiểm tra kiểu; không có linter (M1–M4).

## 2. Số đo nền

Đo trên máy rà soát (Linux, Node 24), lấy trung vị. Con số tuyệt đối phụ thuộc máy; dùng để so
sánh trước/sau trên cùng một máy.

| Hạng mục | Giá trị |
| --- | --- |
| `dist/zoopdog-popupdict.user.js` | 6 213 228 byte (gzip 1 843 540) |
| `dist/zoopdog-nom-ruby.user.js` | 1 417 342 byte (gzip 577 031) |
| `dist/zoopdog-cjk-ruby.user.js` | 26 111 byte |
| `ZOO_DICTIONARY`: 78 060 khoá, JSON 6,18 MB | `JSON.parse` 92 ms; eval cả biểu thức 164 ms; heap +40 MB |
| `NOM_MAP`: 47 843 mục (40 079 mục nhiều từ), JSON 1,39 MB | `JSON.parse` 15 ms; eval 31 ms; heap +4,7 MB |
| Dựng tập tiền tố của matcher (lười, lần đầu) | 15,5 ms |
| `Object.keys(ZOO_DICTIONARY).length` | 12,9 ms mỗi lần gọi |
| Quét 23 850 ký tự, 4 200 kết quả khớp (`scripts/bench-nom.js`) | 42 ms |
| `zd-extension/js/vnedict.json` của website | 9 703 572 byte (gzip 1,96 MB; brotli 1,64 MB), 78 060 dòng |
| `make rebuild-userscripts` | 4,4 s |
| `make verify` | 36,6 s (503 test: 499 đạt, 0 lỗi, 4 bỏ qua; riêng test 24,8 s) |

Chưa đo được trong lần này: thời gian thật trong trình duyệt và trình quản lý userscript
(Tampermonkey/Violentmonkey), chi phí layout/style trên trang thật. Các mục có ghi "cần đo trong
trình duyệt" là suy luận từ mã, chưa có số liệu.

## 3. Phát hiện về hiệu năng

Mức ưu tiên: **P1** làm trước, **P2** nên làm, **P3** làm khi tiện.

### P1 — Từ điển popup được parse ngay khi nạp, trên mọi trang và mọi frame (P1)

`scripts/userscript/popupdict.runtime.js:22` gán `var ZOO_DICTIONARY = JSON.parse("…")` ở cấp cao
nhất của IIFE. Userscript khai báo `@match *://*/*`, không có `@noframes` (chủ ý, vì có chuyển tiếp
phím Shift giữa các frame), nên **mỗi tài liệu** — kể cả iframe quảng cáo, widget, trang không có
chữ tiếng Việt — đều trả ~90–160 ms CPU và ~40 MB heap trước khi làm bất cứ việc gì. Một trang
có 5 iframe là khoảng 0,5–1 giây thời gian luồng chính và ~200 MB.

Đề xuất, theo mức độ thay đổi tăng dần:

1. **Parse lười**: giữ chuỗi JSON, chỉ `JSON.parse` ở lần `lookupContext` đầu tiên (hoặc trong
   `requestIdleCallback` sau lần tương tác con trỏ đầu tiên). `scripts/lib/userscript.js`
   (`jsonParseLiteral`, `extractAssignedJson`) và `scripts/bench-nom.js` cần đổi theo cùng lúc.
   Chi phí còn lại mỗi frame là bản thân chuỗi (~12 MB do chuỗi hai byte), không còn 40 MB đối
   tượng và không còn thời gian parse.
2. **Bỏ qua frame không dùng được**: không khởi tạo trong frame có kích thước 0 hoặc rất nhỏ; với
   frame còn lại, hoãn toàn bộ `main()` tới sự kiện con trỏ đầu tiên trong frame đó.
3. **Tách dữ liệu khỏi mã** (lớn hơn, cần quyết định): đưa từ điển sang `@resource` +
   `GM_getResourceText` (chỉ đọc khi cần, thân script còn vài chục KB, cập nhật mã không phải tải
   lại 6 MB). Rủi ro: hành vi cache `@resource` khác nhau giữa các trình quản lý và trên iOS; phải
   kiểm tra trên trình quản lý thật trước khi chọn. Không làm bước này nếu bước 1–2 đã đủ.

Cùng nhóm: `Highlighter` (`popupdict.runtime.js:704`) tạo ngay một `<canvas>` phủ toàn viewport
trong mọi frame (bitmap `innerWidth × innerHeight × 4` byte, ~8 MB ở 1920×1080). Nên tạo canvas
và popup ở lần hiển thị đầu tiên.

### P2 — Ghi chẩn đoán đắt trên đường nóng của con trỏ (P1)

Trong `hoverLookup` (`popupdict.runtime.js:1296`):

- Dòng 1348: mỗi lần tra không thấy (tức là rê qua **bất kỳ** từ nào không có trong từ điển, ví dụ
  mọi từ tiếng Anh) đều gọi `Object.keys(ZOO_DICTIONARY).length` — đo được 12,9 ms và một mảng
  78 000 phần tử mỗi lần — chỉ để ghi vào `dataset.lastHover`. Thay bằng hằng số
  `__ZOOPDOG_KEY_COUNT__` đã có sẵn lúc build.
- Dòng 1321–1324: mỗi lần "noword/notcontained" gọi `zdCaretFromPoint` **lần thứ hai** và
  `JSON.stringify` để dựng chuỗi chẩn đoán. Nên chỉ dựng chuỗi này khi bật cờ gỡ lỗi (ví dụ
  `localStorage.zoopdogDebug`), mặc định chỉ ghi mã kết quả ngắn.

Thay đổi nhỏ, không đổi hành vi nhìn thấy được; tài liệu `docs/userscript-troubleshooting.md` dựa
vào `data-last-hover` nên cần cập nhật cách bật chẩn đoán.

### P3 — `pointermove` không được gộp theo khung hình (P2)

`popupdict.runtime.js:1464` chạy `hoverLookup` đồng bộ cho mọi `pointermove` (có thể vài trăm lần
mỗi giây với chuột tần số cao). Mỗi lần gọi `caretRangeFromPoint` và `elementFromPoint` (ép tính
layout nếu DOM vừa đổi). Trang web `js/popupdict.js:331` có cùng mẫu với `mousemove`.

- Gộp: lưu toạ độ mới nhất, xử lý một lần mỗi `requestAnimationFrame`.
- `zdRecoverTextNodeFromWholePage` (`zd-words.js:129`) duyệt toàn bộ `document.body` với
  `getBoundingClientRect` cho từng phần tử khi các mức tìm gần thất bại. Trên trang lớn đây là
  O(số phần tử) cho một lần rê chuột. Nên giới hạn số nút duyệt và nhớ kết quả "không tìm thấy"
  cho cùng phần tử đích để không lặp lại ở sự kiện kế tiếp.
- `foreignObstacles` (`popupdict.runtime.js:952`) gọi `getComputedStyle` cho mọi con trực tiếp của
  `body`/`html`, chạy lúc hiện popup và thêm 3 lần hẹn giờ (150/450/1000 ms). Chấp nhận được,
  nhưng nên bỏ qua các lần kiểm tra lại khi popup đã ẩn hoặc vị trí không đổi (đã có điều kiện
  ẩn; thêm so sánh danh sách chướng ngại).

### P4 — Lần quét đầu của nom-ruby chạy đồng bộ trọn trang (P2)

`nom-ruby.runtime.js`: `main()` thêm `doc.body` vào hàng đợi rồi `rescanTextNodes()` quét và chèn
`<ruby>` cho toàn bộ tài liệu trong một tác vụ. Engine nhanh (~1,8 µs/ký tự), nhưng phần DOM
(tách text node, tạo `ruby`/`rt`, tính lại layout) tỉ lệ với số kết quả khớp, nên trang dài (một
chương sách, vài nghìn đoạn) có thể khoá luồng chính hàng trăm ms. Cần đo trong trình duyệt.

- Chia lô theo ngân sách thời gian (ví dụ 8–12 ms mỗi lượt, tiếp tục bằng
  `requestIdleCallback`/`setTimeout`), ưu tiên nút trong viewport trước.
- `scanTextNodes` (dòng 333) đi ngược **toàn bộ chuỗi tổ tiên** cho mỗi nút được thăm, kể cả khi
  được gọi đệ quy từ `scanChildren` — tức O(số nút × độ sâu). Chỉ cần kiểm tra tổ tiên một lần ở
  gốc mỗi lượt quét; lời gọi đệ quy đã biết tổ tiên hợp lệ.
- `isExcludedElement` (dòng 324) đọc `element.isContentEditable` cho từng phần tử. Thuộc tính này
  phụ thuộc style kế thừa; đọc xen kẽ với việc chèn nút có thể gây tính lại style nhiều lần. Cần
  đo; nếu đúng, thay bằng kiểm tra `closest('[contenteditable]')` một lần ở gốc lượt quét cộng
  kiểm tra thuộc tính tại chỗ khi đi xuống.
- `NOM_MAP` (31 ms, 4,7 MB) cũng được eval trong mọi frame; áp dụng cùng cách parse lười của P1,
  kích hoạt khi lượt quét đầu tìm thấy ít nhất một text node có ký tự chữ.

### P5 — Quét định kỳ 500 ms song song với MutationObserver (P3)

`nom-ruby.runtime.js:975` và `cjk-ruby.runtime.js:1232` đặt `setInterval(…, 500)` vĩnh viễn trong
mọi frame, trong khi đã có `MutationObserver` + `requestAnimationFrame`. Mỗi nhịp rỗng rẻ, nhưng
đánh thức mọi tab/iframe hai lần mỗi giây. Nên đổi sang hẹn giờ một lần sau mutation (hoặc giãn
dần 0,5 s → 5 s khi không có gì thay đổi), giữ một nhịp chậm làm lưới an toàn cho trường hợp
shadow root đóng. Tương tự `popupdict-local.runtime.js:457` vẽ lại mỗi 2,5 s.

### P6 — Lớp overlay bố trí lại toàn bộ bản ghi mỗi khung cuộn (P2, chỉ ở chế độ overlay)

`overlay-labels.js:78` (`layout`) chạy theo mọi sự kiện cuộn (bắt ở pha capture) và với **mọi**
bản ghi của trang: `getBoundingClientRect` + `getComputedStyle` cho từng phần tử cha, tạo `Range`
và `getClientRects` cho từng bản ghi, rồi kiểm tra chồng lấn tuyến tính trên danh sách đã đặt
(O(n²) với số nhãn hiển thị), và ghi lại 5 thuộc tính style cho mỗi nhãn dù không đổi.

- Lọc theo viewport trước khi đo: giữ bản ghi theo phần tử cha, dùng `IntersectionObserver` để chỉ
  đo những cha đang hiển thị.
- Với trang `documentAnchored`, toạ độ theo tài liệu không đổi khi cuộn: chỉ bố trí lại khi
  resize/mutation, không phải khi cuộn.
- Chỉ ghi style khi giá trị thay đổi; thay kiểm tra chồng lấn bằng lưới theo hàng.

### P7 — Website: tải và nạp từ điển (P3)

- `vnedict.json` 9,7 MB được tải, `JSON.parse`, kiểm tra hình dạng từng dòng, băm SHA-256, rồi
  `bulkAdd` 78 060 dòng vào IndexedDB trong một giao dịch (`zd-dictionary-runtime.js:119`, `:284`)
  — tất cả trên luồng chính. Chỉ xảy ra khi phiên bản đổi, nên ưu tiên thấp; nếu làm thì chuyển
  parse + kiểm tra + băm sang Web Worker và chia `bulkAdd` thành lô.
- Định dạng dòng `{key, headwords, en:[{def,pos}]}` lặp tên trường 78 000 lần; mã hoá mảng gọn
  như userscript (6,2 MB) giảm ~35 % trước nén. Cần tăng `schemaVersion`; chỉ đáng làm cùng lúc
  với một thay đổi schema khác.
- `popupdict.jade` nạp `dexie`, `handlebars`, `pace` trong `<head>` không có `defer`; các script
  cuối `body` cũng tuần tự. Thêm `defer` (giữ thứ tự) là thay đổi an toàn.
- `js/popupdict.js:114` (`keyup`) ghi lại `innerHTML` của ô nhập 2–4 lần mỗi phím; `js/zd-pron.js:111`
  tính lại cả ba phương ngữ ở mỗi sự kiện `input` kể cả phương ngữ đang ẩn. Nên debounce ~100 ms
  và chỉ tính phương ngữ đang bật.

## 4. Phát hiện về khả năng bảo trì

### M1 — Runtime userscript quá lớn và dùng chung một phạm vi (P1)

| Tệp | Dòng | Hàm | `addEventListener` | Hàm dài nhất |
| --- | --- | --- | --- | --- |
| `popupdict-local.runtime.js` | 2 068 | 103 | 58 | `zooWireNomForm` 225 dòng |
| `popupdict.runtime.js` | 1 526 | 65 | 37 | `main` 302 dòng |
| `cjk-ruby.runtime.js` | 1 237 | 63 | 8 | `main` 108 dòng |
| `nom-ruby.runtime.js` | 1 118 | 45 | 6 | — |

Các tệp được nối vào một IIFE, nên mọi `var`/hàm là toàn cục trong build: phải đặt tên né nhau
(xem chú thích ở `popupdict.runtime.js:312` về `zooNomReviewDebounce` so với `zooDebounce`), và
runtime chính gọi hàm của runtime local qua `typeof zooRenderLocalActions === 'function'` ở nhiều
chỗ. Việc tách đã bắt đầu (`local-transport.js`, `local-selection.js`, `nom-review-store.js`…)
và nên tiếp tục theo đúng mẫu đó — hàm tạo nhận phụ thuộc qua tham số, trả về đối tượng:

- Từ `popupdict.runtime.js`: hàng đợi review Nôm + thanh chọn (dòng ~36–560), `Highlighter`,
  `ResultPopup` + bố trí/chướng ngại, phần render định nghĩa, phần nối sự kiện con trỏ.
- Thay các phép thử `typeof zooX === 'function'` bằng một đối tượng mở rộng duy nhất
  (ví dụ `zooLocal = null` trong build công khai), để điểm nối giữa hai build nằm ở một chỗ.
- `readRuntimeSources` trong `scripts/build-popupdict-userscript.js` lặp 9 khối `parts.push`
  giống nhau; chuyển thành một danh sách tên tệp.

### M2 — Hạ tầng bị lặp giữa các runtime (P2)

Lặp lại gần như nguyên văn giữa `nom-ruby`, `cjk-ruby` và `popupdict`:

- `addStyle` (2 bản), `chooseMode` + `registerModeMenu` (2 bản), `EXCLUDED_TAGS` (2 bản với danh
  sách khác nhau một cách khó nhận ra), tạo chính sách Trusted Types (2 bản), debounce (2 bản).
- Vòng đời quét: hàng đợi nút mới, `MutationObserver`, gộp theo rAF, nhịp 500 ms, theo dõi shadow
  root — `nom-ruby` và `cjk-ruby` mỗi bên tự cài một bản.

Đề xuất một tệp dùng chung `scripts/userscript/zd-scan-scheduler.js` (hàng đợi + observer + ngân
sách thời gian + shadow root) và `zd-userscript-common.js` (style, chế độ theo host, thẻ loại
trừ). Lợi ích kép: P4 và P5 chỉ phải sửa một nơi. Làm sau khi có test đặc tả hành vi hiện tại của
cả hai bên, vì hai bản cài đặt có khác biệt nhỏ cần giữ hoặc hợp nhất có chủ ý.

### M3 — Kiểm tra tĩnh mới ở mức thử nghiệm (P2)

- `make check-types` chỉ kiểm một tệp 26 dòng. Các module thuần đã có biên rõ ràng nên là bước
  mở rộng kế tiếp: `zd-nom-match.js`, `zd-dictionary-runtime.js`, `zd-popup-protocol.js`,
  `scripts/lib/*.js`, các `local-*.js`. Thêm `tsconfig.json` với danh sách `include` tăng dần
  thay cho dòng lệnh `tsc` trong Makefile.
- Không có linter. `node --check` chỉ bắt lỗi cú pháp. Trong IIFE dùng chung, lỗi dễ gặp nhất là
  tên không khai báo và khai báo trùng — đúng loại lỗi `no-undef`/`no-redeclare` bắt được. Thêm
  ESLint cấu hình tối thiểu (chỉ các quy tắc bắt lỗi, không quy tắc định dạng), chạy trên bản
  userscript đã build để thấy đúng phạm vi thật.
- Thiếu `.editorconfig`: `cjk-ruby.runtime.js` thụt 4 khoảng trắng, phần còn lại 2.
- `package.json` không khai báo `engines`; `.nvmrc` và CI dùng Node 24. Thêm `engines.node` để
  sai phiên bản báo lỗi sớm.

### M4 — Test: tốt về độ phủ, còn nợ về tốc độ và trình duyệt (P2)

- 9 313 dòng test cho ~10 000 dòng mã; các hợp đồng cấu trúc và test tương đương engine
  (`nom-match-equivalence`) là điểm mạnh nên giữ.
- `make verify` 36,6 s: `scripts/test-isolated.js` sao chép cả kho (gồm ~22 MB `db_src`) và build
  lại cả 4 artifact cho mỗi lần chạy. Hợp lý cho CI; cho vòng lặp phát triển nên có thêm
  `make test-fast` chạy các test thuần (không cần artifact) trực tiếp trên checkout.
- Không có test hiệu năng xác định cho các đường nóng ở mục 3. Thêm test đếm (không đo thời
  gian): số lần gọi `getComputedStyle`/`getBoundingClientRect`/`caretRangeFromPoint` cho một kịch
  bản cố định trong DOM giả, và khẳng định `ZOO_DICTIONARY` chưa được parse trước lần tra đầu.
- Toàn bộ test DOM dùng harness giả; chưa có lần chạy tự động nào trong trình duyệt thật (Chromium
  + Playwright đủ cho website và cho việc nạp userscript đã build như script thường). Đây cũng là
  mục còn mở từ bản rà soát trước.
- `scripts/bench-nom.js` chỉ in số; nên ghi thêm kết quả dạng JSON để so sánh trước/sau.

### M5 — Dữ liệu và tài liệu (P3)

- `zd-extension/db_src/` giữ cả `vnedict.txt` (2,1 MB), `vnedict.json` (9,7 MB, sinh từ `.txt`)
  và `vnedict2.json` (6,8 MB, nguồn thật của các builder), cùng `evdict.txt` (2,0 MB) không được
  script nào đọc. Cần ghi rõ trong `docs/dictionary-data.md` tệp nào là nguồn, tệp nào là sinh
  ra; cân nhắc ngừng theo dõi `db_src/vnedict.json` nếu nó tái tạo được hoàn toàn. Không xoá gì
  khi chưa có quyết định của người duy trì.
- Tên thư mục `zd-extension/` (không còn extension) buộc mọi tài liệu phải giải thích lại. Đổi
  tên là thay đổi rộng (đường dẫn trong HTML, test, `book-translator`); chỉ nên làm một lần, có
  kế hoạch riêng, hoặc chấp nhận giữ nguyên và ngừng coi đó là nợ.
- Tài liệu chồng lớp: `docs/superpowers/plans|specs`, `openspec/changes/archive` (16 thay đổi),
  hai bản rà soát, `runner.md`, `.codemoss/`. Thêm `docs/README.md` làm mục lục: tài liệu nào là
  hiện hành, tài liệu nào là lịch sử.
- Pug cảnh báo đuôi `.jade` đã lỗi thời ở mỗi lần build; đổi sang `.pug` khi tiện (cập nhật
  `scripts/build-site.js`, test và `AGENTS.md`).
- Ba builder userscript lặp cùng khung `VARIANTS` / `main` / in nhật ký; gom vào
  `scripts/lib/userscript.js`.

## 5. Việc còn mở từ bản rà soát trước

Vẫn chưa đóng, không thuộc phạm vi mới nhưng ảnh hưởng thứ tự làm việc:

- Đóng thay đổi OpenSpec `harden-runtime-and-dictionary-processing` (cần bằng chứng trình duyệt).
- Chuẩn hoá hợp đồng local-mode với người duy trì `book-translator` (F16).
- Kiểm tra CSP Trusted Types nghiêm ngặt và trình quản lý userscript thật.

Mục M4 (chạy trong trình duyệt thật) phục vụ trực tiếp mục đầu và mục cuối.

## 6. Kế hoạch thực hiện

Mỗi giai đoạn là một hoặc vài commit độc lập, kèm artifact sinh ra nếu có. Thay đổi nào đụng tới
thứ local userscript gọi hoặc cấu hình phải sửa đồng thời `book-translator` theo `AGENTS.md`.

### Giai đoạn 0 — Đo trước khi sửa (nửa ngày)

- [x] `scripts/bench-nom.js` xuất thêm JSON; lưu số nền của mục 2 vào tài liệu này.
- [x] Viết kịch bản Playwright nạp `dist/*.user.js` vào một trang mẫu dài (văn bản tiếng Việt
      ~200 KB) và một trang có 5 iframe; ghi thời gian tác vụ dài, heap, số lần layout.
      Ghi chú: `scripts/browser-perf.js` (`make browser-perf`, commit `14002c3`), số đo ở mục 9.
      Đo thời gian chạy script, tác vụ dài nhất, tổng thời gian tác vụ và heap sau GC; **không** đo
      số lần layout/style (không có bộ đếm tin cậy từ ngoài trang).
- [x] Thêm test đếm cho đường con trỏ và lượt quét đầu (M4) — phải đỏ trước khi sửa P1/P2.

### Giai đoạn 1 — Thắng nhanh, rủi ro thấp (1 ngày)

- [x] P2: thay `Object.keys(ZOO_DICTIONARY).length` bằng hằng số build; đưa chuỗi chẩn đoán chi
      tiết sau cờ gỡ lỗi; cập nhật `docs/userscript-troubleshooting.md`.
- [x] P1 bước 1: parse lười `ZOO_DICTIONARY` và `NOM_MAP`; cập nhật `extractAssignedJson`,
      `bench-nom.js`, test cấu trúc.
- [x] P1: tạo `Highlighter`/`ResultPopup` ở lần dùng đầu.
- [x] P3: gộp `pointermove`/`mousemove` theo rAF (userscript và `js/popupdict.js`).
- [x] P7: `defer` cho script của website; debounce ô nhập phát âm.

Tiêu chí xong: trang không có tiếng Việt không còn tác vụ nào > 5 ms từ Zoopdog lúc nạp; heap mỗi
frame giảm ≥ 35 MB với popup; test đếm xanh; `make verify` xanh.

Ghi chú: các mục trên đã làm, nhưng đo trong Chromium thật (mục 9) cho thấy hai tiêu chí số liệu
**chưa đạt**: mỗi frame vẫn chạy script ≈ 196 ms lúc nạp (trước đó 281 ms) và heap mỗi frame giảm
13–20 MB, không phải 35 MB. Test đếm và `make verify` thì xanh. Sau đó thêm parse nhàn rỗi ở lần
hoạt động con trỏ đầu tiên (`626ef90`): lần hover đầu vào từ tiếng Việt không còn gánh ≈ 130 ms parse
nếu con trỏ đã có lúc yên, nhưng nếu hover ngay thì vẫn gánh.

### Giai đoạn 2 — Quét và overlay (2–3 ngày)

- [ ] P4: kiểm tra tổ tiên một lần ở gốc; đo `isContentEditable`; chia lô lượt quét đầu theo ngân
      sách thời gian, ưu tiên viewport. Giữ nguyên các test hồi quy cross-node/shadow/removal.
- [x] P5: thay nhịp 500 ms bằng hẹn giờ theo mutation + lưới an toàn chậm.
- [ ] P6: lọc theo viewport, bỏ bố trí lại khi cuộn với trang neo theo tài liệu, ghi style có điều
      kiện.
- [ ] P1 bước 2: bỏ qua frame kích thước 0, hoãn `main()` trong frame tới tương tác đầu tiên.

Tiêu chí xong: trên trang mẫu dài không có tác vụ nào > 50 ms do lượt quét; cuộn ở chế độ overlay
không gọi `getComputedStyle` cho phần tử ngoài viewport.

Ghi chú: đo trong Chromium thật (mục 9), tác vụ dài nhất của nom-ruby là 96 ms (84–178), nên tiêu
chí 50 ms **chưa đạt** dù khoảng trống tối đa của luồng chính đã giảm từ 3,6 s xuống 173 ms; tiêu chí
về overlay chưa đo trong trình duyệt. Vì vậy P4, P6 và P1 bước 2 vẫn để mở.

Ghi chú thực hiện giai đoạn 2 (đo bằng Playwright/Chromium; trang mẫu 3 000 thẻ `<p>`, 300 KB chữ
Việt, 33 000 `<ruby>`):

- P4 (làm một phần). Đã làm: kiểm tra tổ tiên một lần ở gốc quét (số lần đọc `tagName` tuyến tính
  theo số nút, có test đếm); quét chia lát ~12 ms bằng ngăn xếp tường minh, tiếp tục bằng
  `requestIdleCallback`/`setTimeout`, huỷ bằng bộ đếm thế hệ khi tắt/vẽ lại. Trước: một tác vụ quét
  đồng bộ 330–370 ms, longtask 416–462 ms cộng một tác vụ render 2,3–2,5 s, khoảng trống tối đa
  của luồng chính ~3,5 s. Sau: mỗi lát ≤ 13 ms (17 lát đo được), phần đồng bộ ban đầu 73–77 ms
  (gồm dựng bộ khớp), longtask dài nhất 160–165 ms (chưa tách được phần nào của nó thuộc lượt quét
  và phần nào là style/layout của các `<ruby>` vừa chèn), khoảng trống tối đa 210–670 ms; tổng thời
  gian tới khi chú âm xong 3,75–4,0 s so với 3,5–3,7 s (chậm hơn ~5%). Vì vậy tiêu chí "không tác
  vụ nào > 50 ms" chưa được chứng minh. `isContentEditable`: đo 5 000 đoạn, đọc thuộc tính 958–1082 ms
  so với kiểm tra bằng attribute 922–1006 ms (chênh < 5%, nhiễu) nên giữ nguyên. Chưa làm: ưu tiên
  nội dung trong viewport (không thêm IntersectionObserver).
- P5 (xong cho nom-ruby và cjk-ruby). Hẹn giờ tự đặt lại, bắt đầu 500 ms, nhân đôi tới 5 s khi các
  lần quét liên tiếp không có việc, về 500 ms khi gặp việc hoặc MutationObserver báo thay đổi (đo:
  5 s/lần sau ~9 s yên tĩnh). cjk-ruby giữ 500 ms khi còn nhãn đang chờ vì hẹn giờ là đồng hồ thử
  lại. Để nguyên `setInterval(paintNow, ZOO_EXPLORED_REPAINT_MS)` của popupdict-local: nó tô lại
  kết quả Google bị thay khối mà MutationObserver gắn trên `body` có thể bỏ sót, chưa đủ chắc chắn
  an toàn.
- P6 (làm một phần). Đã làm: một `Range` cho mỗi lượt bố trí (tạo lười), không gọi
  `getComputedStyle` cho cha nằm ngoài màn hình, chỉ ghi style/text khi giá trị khác lần ghi trước
  (lượt thứ hai giống hệt: 0 ghi, 1 `createRange`, trước đó 6). Chưa làm: bỏ bố trí lại khi cuộn ở
  trang neo theo tài liệu (nhãn của phần tử `position: fixed` hiện đi theo cuộn qua lần bố trí lại,
  bỏ qua sẽ đổi hình vẽ) và gom hàng cho phép kiểm tra chồng lấn.
- P1 bước 2 (làm một phần). Frame nhỏ hơn 50 px chỉ nối relay phím Shift (vẫn chuyển tiếp cho
  frame cha/con), khởi tạo đầy đủ một lần khi frame được đổi kích thước. Chưa làm: hoãn `main()` tới
  tương tác đầu tiên.

### Giai đoạn 3 — Giảm chi phí bảo trì (3–5 ngày, làm xen kẽ)

- [x] M3: `tsconfig.json` + mở rộng `check-types` tới các module thuần; ESLint tối thiểu trên
      bản build; `.editorconfig`; `engines` trong `package.json`.
      Ghi chú: `engines` đã có sẵn (`>=24 <25`). `check-types` phủ 23 module (review store, các
      helper local-mode thuần, `zd-nom-match`, `zd-dictionary-runtime`, `zd-popup-protocol`,
      `zd-browser-runtime`, 12 trong 16 file `scripts/lib`); chưa phủ `scripts/lib/dictionary-identity.js`,
      `nom-entries-store.js`, `release-manifest.js` (nhiều hình dạng object chưa có kiểu), `lint-config.js` và các
      runtime nặng DOM. Cập nhật (`26c6dca`): ba module đầu đã có `@typedef` và qua `strict` không
      cần `@ts-nocheck`, nên `check-types` phủ 27 tệp; còn `lint-config.js` và các runtime nặng DOM.
      Thử thêm `overlay-labels.js` và `zd-words.js`: mỗi tệp ≈ 40 lỗi tham số DOM chưa có kiểu, và
      mỗi tệp cần thêm một phép ép kiểu (`.data` trên `Node`, `error.message`), nên chưa đưa vào. ESLint chỉ có luật bắt lỗi; `no-unused-vars` để mức cảnh báo (10 cảnh báo
      còn lại là mã chết hoặc biến chưa dùng, chưa sửa).
      Cập nhật: đã xoá hết mã chết đó, `make lint` không còn cảnh báo và `no-unused-vars` là lỗi.
- [ ] M2: trích `zd-scan-scheduler.js` và `zd-userscript-common.js`, chuyển `nom-ruby` trước rồi
      `cjk-ruby`; so sánh đầu ra build trước/sau.
      Ghi chú: làm một phần, nên chưa đánh dấu. Đã có `zd-userscript-common.js` với
      `zdCreateBackoffPoll` (nhịp rescan thích ứng của cả hai runtime, có test đơn vị riêng và nằm
      trong `tsconfig.json`); hai bản cũ được thay bằng một lời gọi, các test hẹn giờ giả của cả hai
      runtime giữ nguyên. Cố ý chưa làm: `zd-scan-scheduler.js` (hàng đợi, `MutationObserver`, ngân sách
      thời gian, shadow root) vì `nom-ruby` quét đồng bộ theo lát thời gian và theo dõi quyền sở hữu
      node, còn `cjk-ruby` bất đồng bộ quanh yêu cầu mạng, cache và thử lại, và test DOM của `cjk-ruby`
      bị bỏ qua khi thiếu jsdom nên không kiểm chứng được một bản hợp nhất. Cũng chưa gộp: `addStyle`
      (ba bản khác nhau: popup có nhánh `GM.addStyle`, `cjk-ruby` dùng `installStyle` có try/catch),
      `chooseMode` (`cjk-ruby` có thêm điều kiện `mobileOnly`, dùng `location` thay vì
      `window.location`), `registerModeMenu` (chỉ khác nhãn/khoá nhưng truy cập `location` khác nhau,
      lợi ích quá nhỏ), chính sách Trusted Types và debounce. `EXCLUDED_TAGS` của hai runtime khác
      nhau (`nom-ruby` thêm rp, button, option, code, pre, kbd, samp; `cjk-ruby` thêm template) nên
      giữ riêng, mỗi bên có chú thích trỏ sang bên kia.
- [x] M1: tách `popupdict.runtime.js` thành 4–5 module theo danh sách ở M1; thay các phép thử
      `typeof zooX` bằng một điểm mở rộng; rút gọn `readRuntimeSources`.
      Ghi chú: `popupdict.runtime.js` còn 571 dòng (từ 1 646), tách ra `popup-render.js` (152),
      `popup-highlighter.js` (150), `popup-result.js` (282), `popup-nom-review.js` (531); mã được
      chuyển nguyên văn, không đổi tên. Cập nhật: `popupdict-local.runtime.js` (2 071 dòng) đã tách
      nguyên văn thành 10 tệp `local-*.js` (`e0f484d`; lớn nhất `local-selection-bar.js` 319 dòng;
      `popupdict-local.runtime.js` còn 20 dòng: tiêu đề và `zooLocal`); `nom-ruby.runtime.js`
      (1 290 dòng) còn 463 dòng sau khi chuyển quét, ghi chú DOM và vòng đời sang `nom-ruby-scan.js`
      (337), `nom-ruby-annotate.js` (390), `nom-ruby-lifecycle.js` (135) (`9ff46af`; phần luật theo
      site, chọn chế độ và CSS ở lại vì mang placeholder của builder). `cjk-ruby.runtime.js`
      (1 271 dòng) cố ý chưa tách vì test DOM của nó bị bỏ qua khi thiếu jsdom. `zooLocal` (khai báo `null` trước các nguồn runtime, build
      local gán vào cuối `popupdict-local.runtime.js`) thay năm phép thử `typeof`; lint của build công
      khai không còn danh sách global riêng cho local. `readRuntimeSources` dùng hai danh sách có
      thứ tự. Chưa làm: `main`/`startPopup` (hơn 300 dòng) giữ nguyên thân hàm vì chia nhỏ nó không
      còn là phép chuyển nguyên văn; (đã lỗi thời, xem cập nhật ở trên: khi đó `popupdict-local.runtime.js`
      còn 2 071 dòng, `nom-ruby.runtime.js` 1 290 và `cjk-ruby.runtime.js` 1 271 dòng). Mục tiêu
      "không tệp nào quá ~800 dòng" nay chỉ còn chưa đạt với `cjk-ruby.runtime.js`.
- [x] M4: `make test-fast`; đưa kịch bản Playwright của giai đoạn 0 vào CI như job riêng, không
      chặn merge cho tới khi ổn định.
      Ghi chú: job CI chạy `scripts/browser-smoke.js` (kiểm tra website và userscript trong
      Chromium thật), `continue-on-error`. Kịch bản đo hiệu năng của giai đoạn 0 (trang dài,
      5 iframe, heap) nay là `make browser-perf` (`14002c3`), chưa chạy trong CI; `bench-nom.js` đã có `--json`.
- [x] M5: `docs/README.md` làm mục lục; ghi rõ nguồn/sinh ra trong `docs/dictionary-data.md`.
      Ghi chú: chưa xoá, di chuyển hay đổi tên gì; số phận `vnedict.json`, `vnedict.txt`,
      `evdict.txt` vẫn chờ quyết định ở giai đoạn 4.

Tiêu chí xong: không runtime nào > 800 dòng; không hàm nào > 100 dòng; `check-types` phủ mọi
module không đụng DOM; đầu ra build chỉ khác ở phần mã được di chuyển.

Ghi chú: tệp lớn nhất của `popupdict`/`nom-ruby` nay là 596 và 463 dòng, nhưng `cjk-ruby.runtime.js`
còn 1 271 dòng và vẫn có hàm dài hơn 100 dòng (`main` của popup, `zooWireNomForm` ≈ 225 dòng...), nên
hai tiêu chí đầu chưa đạt. Hai lần tách (`e0f484d`, `9ff46af`) được kiểm bằng bộ so sánh: cùng tập khai
báo hàm với cùng văn bản, cùng các câu lệnh cấp cao nhất theo cùng thứ tự, đầu ra minify giống hệt.

### Giai đoạn 4 — Cần quyết định trước khi làm

- [ ] P1 bước 3: tách từ điển sang `@resource` — chờ quyết định của người duy trì: cần thử trên
      Tampermonkey, Violentmonkey và iOS; đây là hướng còn lại để giảm ≈ 196 ms chạy script mỗi frame
      (mục 9; chưa thử nên chưa biết mức giảm).
- [ ] P7: mã hoá gọn + Worker cho từ điển website (tăng `schemaVersion`) — chờ quyết định của người
      duy trì: đổi schema từ điển website.
- [ ] M5: số phận `zd-extension/db_src/vnedict.json` và `evdict.txt` — chờ quyết định của người duy
      trì: chỉ người duy trì được xoá hoặc ngừng theo dõi dữ liệu nguồn.
- [ ] M5: đổi tên thư mục `zd-extension/` — chờ quyết định của người duy trì: thay đổi rộng, chạm
      đường dẫn trong HTML, test và repo `book-translator`.
- [x] M5: `.jade` → `.pug` — xong (`785e3b7`): `git mv` mọi mẫu, `*.html` sinh ra giống hệt từng
      byte, Pug không còn cảnh báo.

## 7. Những gì nên giữ nguyên

- Engine khớp Nôm và các test tương đương của nó; không tối ưu thêm khi chưa có số đo chỉ ra nó
  là nút thắt (hiện là 42 ms cho 4 200 kết quả khớp — phần DOM mới là chi phí chính).
- `JSON.parse` thay cho object literal, chỉ mục tiền tố dựng lười, `readAhead` có `canContinuePast`.
- Build tách biệt theo lần chạy, đóng dấu phiên bản theo nội dung, manifest phát hành.
- Quy tắc sửa nguồn trước, artifact sau; không thêm bundler hay framework.

## 8. Bằng chứng

| Hạng mục | Cách kiểm |
| --- | --- |
| Kích thước artifact | `make rebuild-userscripts rebuild-extension-vnedict-json minify-userscripts`, `ls -l`, `gzip -c` |
| Thời gian parse, heap | `JSON.parse` trên dữ liệu trích bằng `extractAssignedJson`, trung vị 7 lần, `node --expose-gc` |
| `Object.keys` | trung vị 21 lần trên `ZOO_DICTIONARY` đã parse |
| Quét | `node scripts/bench-nom.js` |
| Kiểm chứng | `make verify`: 503 test, 499 đạt, 0 lỗi, 4 bỏ qua; `check-generated` và `check-types` đạt |
| Đọc mã | đọc trọn `zd-nom-match.js`, `zd-dictionary-runtime.js`, `js/popupdict.js`, `overlay-labels.js`, các builder và `scripts/lib/userscript.js`; đọc phần lớn `popupdict.runtime.js`, `nom-ruby.runtime.js`, `zd-words.js`; `cjk-ruby.runtime.js`, `popupdict-local.runtime.js`, `zd-pron-core.js` và `dictionary-identity.js` chỉ xem cấu trúc và các điểm nóng |

Giới hạn: không chạy trong trình duyệt hay trình quản lý userscript thật; các nhận định về
layout/style (P3, P4 phần `isContentEditable`, P6) là suy luận từ mã và cần số đo ở giai đoạn 0
trước khi coi là đã xác nhận. Lần rà soát này không sửa mã nguồn nào.

## 9. Số đo sau khi thực hiện

Đo bằng `scripts/browser-perf.js` (`make browser-perf`) trong Chromium 153 thật (Playwright, headless,
Linux trong container), mỗi cấu hình 3 lần, ô là trung vị (nhỏ nhất–lớn nhất). "Trước" là userscript
dựng từ `3c4df61` (commit ngay trước khi sửa, dựng trong một `git worktree` riêng với cùng dữ liệu
`db_src`); "Sau" là bản dựng tại `626ef90` (đã gồm nhịp quét thích ứng, bỏ qua frame nhỏ và parse nhàn rỗi).
Đây là một máy, một phiên bản Chromium, không có trình quản lý userscript (script được chèn bằng thẻ
`<script>` nội tuyến, như Violentmonkey làm), nên con số tuyệt đối chỉ so sánh được với nhau.

Cách đo từng chỉ số: "chạy mã" là thời gian trong trang quanh việc chèn thẻ `<script>` (nguồn đã đưa
vào trang trước đó nên thời gian truyền qua DevTools không bị tính); "tác vụ dài nhất" lấy từ
`PerformanceObserver('longtask')`, chỉ thấy tác vụ trên 50 ms; "tổng thời gian tác vụ" là hiệu của
`TaskDuration` (CDP `Performance.getMetrics`) từ lúc chèn tới 400 ms sau, thấy được cả việc dưới ngưỡng
50 ms; heap là `Runtime.getHeapUsage` sau hai lần `HeapProfiler.collectGarbage` (iframe cùng gốc dùng
chung một isolate, nên đó là tổng của mọi frame); khoảng trống tối đa của luồng chính là khoảng cách
lớn nhất giữa hai nhịp của một bộ hẹn giờ 4 ms.

### Popup userscript, trang thường (một đoạn tiếng Việt ngắn, chưa tra từ nào lúc nạp)

| Chỉ số | Trước (`3c4df61`) | Sau (HEAD) |
| --- | --- | --- |
| Chạy mã (`evalMs`, ms) | 281 (280–288) | 196 (195–244) |
| Tác vụ dài nhất (ms) | 298 (296–305) | 213 (212–261) |
| Tổng thời gian tác vụ (ms) | 310 (309–318) | 220 (218–268) |
| Heap sau GC (MB) | 23.9 (23.9–23.9) | 10.8 (10.8–10.8) |
| Heap tăng so với trước khi nạp (MB) | 23.4 (23.4–23.4) | 10.3 (10.3–10.3) |

### Popup userscript, trang có 5 iframe cùng gốc 300×200 (6 bản script chạy)

| Chỉ số | Trước (`3c4df61`) | Sau (HEAD) |
| --- | --- | --- |
| Chạy mã, cộng 6 frame (ms) | 1736 (1730–1782) | 1175 (1155–1178) |
| Tác vụ dài nhất (ms) | 332 (326–340) | 218 (217–233) |
| Tổng thời gian tác vụ (ms) | 1830 (1822–1876) | 1258 (1237–1261) |
| Heap sau GC (MB) | 130 (130–130) | 12.6 (12.6–12.6) |
| Heap tăng (MB) | 128 (128–128) | 10.6 (10.6–10.6) |

### Popup userscript, lần hover đầu trên từ tiếng Việt

"Hover ngay" là con trỏ đi thẳng vào từ ngay sau khi nạp; "sau lúc yên" là con trỏ đi qua chỗ trống,
trang yên 0,8 s (để việc parse nhàn rỗi chạy), rồi mới vào từ. "Lúc yên" là tác vụ nhàn rỗi đó.

| Chỉ số | Trước (`3c4df61`) | Sau (HEAD) |
| --- | --- | --- |
| Trang thường, hover ngay: độ trễ tới khi hiện popup (ms) | 21.0 (21.0–23.0) | 137 (136–172) |
| tác vụ dài nhất lúc hover (ms) | 0.0 (0.0–0.0) | 130 (128–153) |
| heap sau hover (MB) | 25.0 (25.0–25.0) | 25.0 (25.0–25.0) |
| Trang thường, sau một lúc yên: độ trễ (ms) | 19.0 (17.0–20.0) | 20.0 (19.0–27.0) |
| tác vụ dài nhất lúc hover (ms) | 0.0 (0.0–0.0) | 0.0 (0.0–0.0) |
| tác vụ dài nhất lúc yên (ms) | 0.0 (0.0–0.0) | 98.0 (97.0–134) |
| 5 iframe, hover ngay: độ trễ (ms) | 20.0 (18.0–24.0) | 136 (131–191) |
| tác vụ dài nhất lúc hover (ms) | 0.0 (0.0–0.0) | 128 (124–168) |
| heap sau hover (MB) | 131 (131–131) | 37.1 (37.1–37.1) |
| 5 iframe, sau lúc yên: độ trễ (ms) | 17.0 (15.0–17.0) | 19.0 (17.0–21.0) |
| tác vụ dài nhất lúc yên (ms) | 0.0 (0.0–0.0) | 99.0 (95.0–100) |
| tác vụ dài nhất lúc hover (ms) | 0.0 (0.0–0.0) | 0.0 (0.0–0.0) |

### nom-ruby, trang sinh sẵn 3 000 đoạn tiếng Việt (≈300 KB chữ, 42 000 `<ruby>`)

| Chỉ số | Trước (`3c4df61`) | Sau (HEAD) |
| --- | --- | --- |
| Chạy mã (ms) | 418 (413–428) | 67.1 (54.1–80.4) |
| Tác vụ dài nhất (ms) | 422 (416–432) | 96.0 (84.0–178) |
| Khoảng trống tối đa của luồng chính (ms) | 3604 (3556–3793) | 173 (147–214) |
| Thời gian tới khi ngừng thay đổi (ms) | 424 (418–434) | 3827 (3748–3885) |
| Tổng thời gian tác vụ (ms) | 3609 (3560–3797) | 3873 (3743–3884) |
| Số `<ruby>` | 42000 (42000–42000) | 42000 (42000–42000) |
| Heap sau GC (MB) | 7.1 (7.1–7.1) | 7.2 (7.1–7.2) |

### Đối chiếu với "Tiêu chí xong"

Giai đoạn 1 ("trang không có tiếng Việt không còn tác vụ nào > 5 ms từ Zoopdog lúc nạp; heap mỗi
frame giảm ≥ 35 MB với popup; test đếm xanh; `make verify` xanh"):

- Test đếm xanh và `make verify` xanh: **đạt**.
- Không tác vụ nào > 5 ms lúc nạp: **không đạt**. Mỗi frame vẫn mất ≈ 196 ms (196–244) để chèn script,
  tác vụ dài nhất 213 ms; với 5 iframe là ≈ 1,2 s cộng dồn. Giảm so với trước (281 ms mỗi frame) nhưng
  còn rất xa 5 ms. Chuỗi từ điển 6,2 MB riêng đã tốn ≈ 79 ms lần đầu (đo riêng: chèn một script chỉ có
  chuỗi đó, 79 ms rồi 18 ms ở các lần sau trong cùng trang, nên con số này có phần là bộ nhớ đệm
  biên dịch); phần còn lại của ≈ 196 ms (kích thước nguồn 7 MB đi qua Blink và V8) chưa được tách.
  Chi phí này chỉ mất đi khi dữ liệu rời khỏi thân script (`@resource`, Giai đoạn 4, chờ quyết định).
- Heap mỗi frame giảm ≥ 35 MB: **không đạt**. Trang thường giảm 13,1 MB (23,9 → 10,8 MB sau GC);
  trang 5 iframe giảm 117 MB cho 6 frame, tức ≈ 19,6 MB mỗi frame (130 → 12,6 MB). Ước tính ~40 MB
  của bản rà soát đo bằng Node; trong Chromium từ điển đã parse chỉ nặng ≈ 14 MB (heap sau hover đầu
  25 MB so với 10,8 MB), nên ngưỡng 35 MB không thể đạt được bằng cách hoãn parse.
- Cái giá phải trả: chi phí parse không biến mất mà chuyển từ lúc nạp sang lúc con trỏ hoạt động.
  Hover ngay vào một từ làm lần tra đầu chậm 137 ms (136–172) thay vì 21 ms, kèm tác vụ dài 130 ms. Nếu
  con trỏ có khoảng yên trước đó, parse chạy ở lúc nhàn rỗi (tác vụ dài 98 ms) và lần hover đầu quay về
  20 ms. Mỗi frame mà con trỏ chạm vào, kể cả trang chỉ có chữ Anh, vẫn trả ≈ 100–130 ms CPU và ≈ 14 MB
  khi con trỏ đi qua; chỉ frame không bao giờ nhận con trỏ thì không trả.

Giai đoạn 2 ("trên trang mẫu dài không có tác vụ nào > 50 ms do lượt quét; cuộn ở chế độ overlay
không gọi `getComputedStyle` cho phần tử ngoài viewport"):

- Không tác vụ nào > 50 ms do lượt quét: **không đạt**. Tác vụ dài nhất giảm từ 422 ms xuống 96 ms
  (84–178; lần đo cao nhất vượt 170 ms), vẫn trên 50 ms. Phần chèn script đồng bộ ban đầu 67 ms đã
  gồm dựng bộ khớp. Khoảng trống tối đa của luồng chính giảm rõ, từ 3 604 ms xuống 173 ms (147–214),
  tức là trang không còn đóng băng gần 3,6 s. Khoảng trống 3,6 s của bản trước nằm ngoài phần script
  (script chỉ chạy 418 ms) và `longtask` không báo nó, nên đó là việc style/layout/vẽ của 42 000
  `<ruby>`: đây là suy luận, chưa tách bằng trace.
- Đổi lại, chú âm xong chậm hơn nhiều: 3 827 ms so với 424 ms (nom-ruby trước đó chèn hết trong một
  tác vụ rồi để trình duyệt tính layout hàng giây). Tổng thời gian tác vụ gần như bằng nhau (3 609 → 3 873 ms, +7%), số
  `<ruby>` cuối cùng bằng nhau (42 000) và heap không đổi.
- Cuộn ở chế độ overlay không gọi `getComputedStyle` cho phần tử ngoài viewport: **không đo trong trình
  duyệt** ở đây, và P6 mới làm một phần (xem ghi chú Giai đoạn 2); phần "không đo cha ngoài màn hình"
  chỉ có test đếm trên DOM giả.

Những gì chưa đo được: trình quản lý userscript thật (Tampermonkey/Violentmonkey) và CSP nghiêm ngặt,
trang thật nhiều iframe quảng cáo, thiết bị di động, và độ lệch giữa các máy (chỉ một máy, 3 lần mỗi
cấu hình).
