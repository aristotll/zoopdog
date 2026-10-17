# Rà soát khả năng bảo trì và hiệu năng

Ngày: 2026-10-14 (Asia/Kuala_Lumpur). HEAD tham chiếu: `ec95810b05aef81f3280ff800272f6756073104b`; các đường lỗi được xác minh trên working tree hiện tại.

Phạm vi gồm runtime website, core phát âm/đồng âm, shared word primitives, nom matcher, userscript annotation/popup, builder/data libraries, CSV store, watcher/release, Makefile, kiểm thử và canonical specs. Không giới hạn ở diff gần đây. Không chỉnh sửa thư viện bên thứ ba, dữ liệu từ điển, source runtime hoặc các file local mode đang có thay đổi. Chỉ thêm bộ tài liệu của change này.

## Phát hiện theo ưu tiên

### R1 — [P1] Giao một token không đủ để xóa cả bundle nghĩa

Vị trí: `scripts/lib/dictionary-identity.js:441–442`; consumer ở `536–577`, validator ở `628–632`.

`isRedundantVariant` coi hai bundle có một synonym chung là tương đương. Grouping chọn một bundle theo số token/độ dài rồi bỏ bundle còn lại; validator lại dùng chính predicate đó nên vẫn báo hợp lệ dù mất các token riêng. Dữ liệu thật: `bao bọc` có `cover, envelope, covering` và `to envelope, protect`, nhưng API builder chỉ giữ bundle đầu và mất `protect`. POS `verb` còn được chuyển từ bundle bị bỏ sang bundle thắng.

Fixture tối thiểu: `sharp, biting, cutting` + `sharp, acute, keen` chỉ còn bundle đầu. Cần quan hệ bao phủ có hướng và kiểm tra mọi token/POS/headword; giữ cả hai khi chỉ giao một phần. Hồi quy phải kiểm tra cả fixture lẫn `bao bọc`, và cố ý đưa output thiếu token vào validator.

### R2 — [P1] Rewrite node sau của cụm ruby để lại chữ cũ

Vị trí: `scripts/userscript/nom-ruby.runtime.js:530–532`.

`annotateAcrossNodes` chỉ đưa phần chèn của source segment đầu vào bookkeeping. Sau khi annotate hai wrapper `tình ` + `cảm`, trang đổi reference text node thứ hai thành `bạn`: visible text trở thành **tình bạncảm**, với ruby **情 / 伴 / 感**. Nội dung cũ không được cleanup vì source node sau không có ownership tương ứng. Lỗi ảnh hưởng widget/caption cập nhật từng từ.

Cần ghi mọi source segment và cleanup annotation cũ của cả span khi một segment đổi. Hồi quy phải bao phủ node đầu/giữa/cuối, removal và nhiều match chung source, đồng thời giữ đúng nội dung mới của trang.

### R3 — [P2] CSV thiếu quote đóng vẫn được chấp nhận và nuốt các entry sau

Vị trí: `scripts/lib/nom-entries-csv.js:83–86`.

EOF không kiểm tra `inQuotes`. Input `vi,nom,explain\nba,巴,"\nbốn,四,\n` được parse thành một entry ba với explain `bốn,四,`; serialize lại chỉ còn row ba. Việc thiếu một dấu nháy trong shard được hand-maintain có thể âm thầm biến các row sau thành một field, rồi mất entry độc lập khi upsert/ghi lại.

Cần parser từ chối quote chưa đóng cùng vị trí lỗi, và loader báo shard cụ thể trước ghi. Bổ sung fixture quoting/cột sai và round-trip multiline hợp lệ; không tự sửa dữ liệu nguồn.

### R4 — [P2] Release song song có thể minify userscript cũ

Vị trí: `Makefile:47`.

Các prerequisite build và minify ngang hàng. `make -j4 release-userscripts` được phép minify trước khi hai builder hoàn tất, nên có thể đưa dist cũ vào release mới hoặc thất bại ở clone chưa có userscript root.

Đã chạy Makefile thật với NODE mock chỉ log sự kiện: minify kết thúc khoảng 300 ms trước các builder, rồi publisher mock mới chạy. Không chạy publisher thật. Cần edge build → minify → publish; test start/end và failure propagation trên graph thật, không chỉ inspect chuỗi Makefile.

### R5 — [P2] CharacterData bypass exclusion của tổ tiên

Vị trí: `scripts/userscript/nom-ruby.runtime.js:221–222`.

Initial traversal bỏ qua code/editor, nhưng mutation trực tiếp queue text node và gọi annotation mà không kiểm tra tổ tiên. Fixture `<code>foo</code>` sau startup đổi text thành `bạn` tạo ruby **伴** trong code. Cùng đường vào có thể sửa nội dung vùng editable hoặc các excluded tags khi chúng cập nhật text node.

Cần một helper eligibility dùng chung và kiểm tra lại lúc flush. Test từng nhóm excluded tags, nested descendants, text node chuyển vào editor khi đang queue và text hợp lệ ngoài vùng bị loại.

### R6 — [P2] Append nhỏ vào body vẫn quét toàn bộ text cũ

Vị trí: `scripts/userscript/nom-ruby.runtime.js:126`.

Mọi child-list mutation queue `mutationRecord.target`. Khi target là body hoặc container lớn, flush duyệt lại mọi nhánh cũ. Trên fixture 100 paragraph không có match, sau initial scan, append một div rỗng vào body gây **300 lượt đọc nodeValue của 100 text node cũ**. Feed/SPA càng lớn càng chịu chi phí không liên quan mỗi batch.

Cần dirty regions và vùng nối có giới hạn, giữ regression recover-missed-first-line và cross-wrapper. Hồi quy đo số node phân tích trên hai kích thước DOM thay vì chỉ dùng thời gian tuyệt đối.

### R7 — [P2] Lookup nhận Object.prototype.constructor làm entry

Vị trí: `scripts/userscript/popupdict.runtime.js:575–579`.

Dictionary được nhúng qua JSON.parse có prototype thường. Với từ điển chỉ chứa `bạn`, `lookupContext('constructor')` trả Object constructor làm results; renderer gọi `results.map` và ném TypeError. Hover từ tiếng Anh phổ biến này trở thành lỗi thay vì miss.

Cần own-property check. Fixture phải đi qua JSON.parse và kiểm tra cả key vắng mặt lẫn `constructor` thực sự có entry.

### R8 — [P2] Input chỉ có khoảng trắng làm cả hai adapter phát âm lỗi

Vị trí: `js/zd-pron.js:49–52`; đồng âm ở `zd-extension/js/zd-pron-core.js:517–519` và `js/zd-pron.js:94`.

Điều kiện `!input.value` không bắt whitespace. pronunciationGuide trả status empty và zd rỗng; regex.match trả null, sau đó `zdParagraphs.forEach` ném TypeError. Trên trang đồng âm, core trả chuỗi `&nbsp;` cho spaces-only thay vì mảng, và `results.forEach` ném TypeError. VM chạy source adapter thật xác nhận cả hai.

Cần xử lý empty ở adapter và core trả mảng rỗng thống nhất cho mọi dialect; placeholder HTML thuộc rendering. Test spaces/tab/newline và chuyển tiếp sang input hợp lệ.

### R9 — [P2] Giới hạn kết quả không ngăn tràn stack theo số token

Vị trí: `zd-extension/js/zd-pron-core.js:491–494`.

`getPermutations` đệ quy sâu bằng số token, dù mỗi token chỉ có một khả năng. `getMultiWordHomophones(Array(4000).fill('xyz').join(' '), 10000)` ném **RangeError: Maximum call stack size exceeded**. Tích chỉ có một kết quả nên không chạm limit, và paste văn bản dài làm callback đồng bộ thất bại.

Cần iterator/vòng lặp không phụ thuộc token stack depth, join tại kết quả hoàn chỉnh, giữ thứ tự và limit hiện có. Test 4.000 singleton tokens cùng tích nhiều nhánh nhỏ và trường hợp vượt limit.

## Kết quả xác minh

- `make verify`: exit 0; **345 test, 344 pass, 0 fail, 1 skip**. Audit tùy chọn `ZD_REVIEW_DICTIONARY=1` không được bật. Cả syntax checks của make verify đã hoàn tất.
- Parent đã chạy lại độc lập mọi phép tái hiện R1–R9 được reviewer tìm ra, với source thật và dữ liệu trong RAM. Những phép tái hiện phơi bày hành vi lỗi hiện tại; chúng không phải test đã sửa thành công.
- R1: API builder thật loại protect; fixture giao một phần vẫn qua verifyLossless.
- R2/R5/R6: dùng VM và DOM harness sẵn có của `test/nom-ruby-runtime.test.js`; kết quả lần lượt là `tình bạncảm`, ruby trong code và 300 lượt đọc text cũ.
- R3: parse/serialize CSV trong RAM làm mất row bốn.
- R4: Makefile thật với NODE mock chứng minh minify chạy trước build hoàn tất; không có request GitHub.
- R7: lookup trả results kiểu function cho key inherited.
- R8: VM source `js/zd-pron.js` thật ném lỗi null.forEach và results.forEach.
- R9: Node thực thi core với 4.000 token ném RangeError.
- OpenSpec: strict validation đạt; status xác nhận 4/4 artifact đã tạo, với 28 task triển khai chưa đánh dấu. Lifecycle check đạt và không archive change nào. Rà soát độc lập bộ tài liệu không thấy blocker; đã giữ nguyên contract unsupported-input và blank-line/header CSV.
- Chưa kiểm tra trình duyệt thật hoặc đo latency trên thiết bị di động. Các kết luận về DOM dựa trên harness; lỗi sản xuất do các đường source được chỉ rõ, còn benchmark tương tác thật thuộc task triển khai.
- Source-safe: giữ nguyên những thay đổi đã có trong local mode, test local runtime và các shard/order Chữ Nôm. `make verify` có quyền tạo fixture tạm/artifact gitignored theo quy trình repo.

## Phép tái hiện đọc nguồn

Chạy các đoạn JavaScript sau bằng Node tại repo root. Chúng đọc source/build API, dùng dữ liệu trong RAM và thay NODE của Makefile bằng logger; không sửa dữ liệu repository hoặc phát hành thật.

### Dữ liệu, runtime annotation và popup (R1, R2, R3, R5, R6, R7)

```javascript

const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{createRequire}=require('node:module');
const f=path.resolve('test/nom-ruby-runtime.test.js');
const fixture=fs.readFileSync(f,'utf8').split("test('annotates text present")[0];
vm.runInNewContext(fixture+"\nconst a=runRuntime({'bạn':'伴'});\nconst code=a.document.createElement('code'), text=a.document.createTextNode('foo');\ncode.appendChild(text);a.body.appendChild(code);a.tick();text.nodeValue='bạn';a.tick();\nconsole.log('excluded',visibleText(code),rubyAnnotations(code));\nconst b=runRuntime({'tình cảm':'情感','bạn':'伴'});\nconst row=b.document.createElement('div');row.className='row';const refs=[];\n['tình ','cảm'].forEach(value=>{const w=b.document.createElement('span');w.className='item';const n=b.document.createTextNode(value);refs.push(n);w.appendChild(n);row.appendChild(w);});\nb.body.appendChild(row);b.tick();refs[1].nodeValue='bạn';b.tick();console.log('rewrite',visibleText(row),rubyAnnotations(row));\nconst c=runRuntime({});let reads=0;\nfor(let i=0;i<100;i++){const p=c.document.createElement('p'),n=c.document.createTextNode('unmatched');let value=n.data;Object.defineProperty(n,'nodeValue',{get(){reads++;return value;},set(next){value=next;}});p.appendChild(n);c.body.appendChild(p);}\nc.tick();reads=0;c.body.appendChild(c.document.createElement('div'));c.tick();console.log('oldTextReads',reads);\n",{require:createRequire(f),__dirname:path.dirname(f),console});
const popup=fs.readFileSync('scripts/userscript/popupdict.runtime.js','utf8');
const funcs=popup.slice(popup.indexOf('  function normalizeLookup('),popup.indexOf('  // Element.contains()'));
const ctx={ZOO_DICTIONARY:JSON.parse('{"bạn":[]}'),ZOO_MAX_WORDS:4};vm.createContext(ctx);vm.runInContext(funcs+';var result=lookupContext("constructor");',ctx);
console.log('lookup',ctx.result.key,typeof ctx.result.results);
const {groupEntries}=require('./scripts/lib/dictionary-identity');
console.log('partialBundle',JSON.stringify(groupEntries([{vn:'ví dụ',en:[{def:'sharp, biting, cutting',pos:''},{def:'sharp, acute, keen',pos:''}]}])));
const {buildFullDictionary}=require('./scripts/build-popupdict-userscript');
console.log('baoBoc',JSON.stringify(buildFullDictionary().dictionary['bao bọc']));
const {parseShardCsv,serializeShardCsv}=require('./scripts/lib/nom-entries-csv');
const parsed=parseShardCsv('vi,nom,explain\nba,巴,"\nbốn,四,\n');console.log('badCsv',JSON.stringify(parsed),'reserialized',JSON.stringify(serializeShardCsv(parsed)));

```

### Adapter phát âm, stack và release graph (R4, R8, R9)

```javascript

const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const data=require('./zd-extension/js/zd-pron-data');
const {allPossibleRealWords}=require('./zd-extension/js/realwords');
const core=require('./zd-extension/js/zd-pron-core').createPronunciationCore(data,allPossibleRealWords);
const input={value:'   ',addEventListener(){}},output={style:{},firstChild:null,appendChild(){},classList:{add(){}}};
const document={getElementsByClassName(){return [];},getElementById(){return input;},querySelector(){return output;},createElement(){return output;}};
const context={document,window:{},dialects:data.dialects,pronunciationGuide:core.pronunciationGuide,getMultiWordHomophones:core.getMultiWordHomophones,drawTonesAndGradients(){},zdBrowserRuntime:{runWhenReady(){}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/zd-pron.js','utf8'),context);
for(const name of ['pronounceMe','homophoneMe']){try{vm.runInContext(name+'()',context);console.log(name,'OK');}catch(e){console.log(name,e.name,e.message);}}
try{core.getMultiWordHomophones(Array(4000).fill('xyz').join(' '),10000);}catch(e){console.log('4000 singleton tokens',e.name,e.message);}
const mockBody='const s=process.argv[1]; console.log(Date.now()+" START "+s); setTimeout(()=>console.log(Date.now()+" END "+s),s.includes("build-")?300:0)';
const mock='node -e '+JSON.stringify(mockBody)+' --';
const r=cp.spawnSync('make',['-j4','release-userscripts','NODE='+mock,'DRY_RUN=1'],{encoding:'utf8'});
console.log(r.stdout);process.exitCode=r.status;

```

## Liên kết triển khai

[Proposal](proposal.md), [design](design.md), [tasks](tasks.md). Các task vẫn để unchecked vì lượt này chỉ review và tạo đề xuất.
