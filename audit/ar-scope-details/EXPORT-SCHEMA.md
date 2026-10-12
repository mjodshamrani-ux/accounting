# AR scope/details export and session schema

Schema version: `ar-scope-details-1`. This schema is an integration contract for the independent checker. The checker reads raw workbook OOXML and original source bytes; it does not import product code.

## Session

UTF-8 JSON with exactly `format`, `version`, `files`, `readings`, `scope`, `events`. `format` is `tarasuf-ar-session`. Legacy-only readings retain `version: ar-limited-1`; any explicit new reading requires `version: ar-scope-details-1`. No derived result, source inventory, scope-header cache, totals, or allocation is saved. Each of the two files has exactly `name`, `sha256`, `data` (canonical base64 of original bytes). Restoration reads those bytes, verifies hashes, validates readings and scope, rebuilds provenance, and applies context-bound events. Maximum source 8 MiB, session 32 MiB, events 1000. New sessions never silently migrate legacy readings. Changing the envelope version without changing reading families is rejected.

## Workbook

Exactly these nine worksheets, in this order: Summary, Movements, Cases, Membership, Ledger inventory, Statement inventory, Reading, Decisions, Sources. First row is column headers. All preexisting columns retain names and positions. Legacy-only workbook layouts and values remain unchanged. New/mixed exports append columns listed below. XLSX serialized bytes are limited to 96 MiB. Strings use OOXML ST_Xstring escapes to preserve raw text; formula-like text stays literal text. JSON columns contain JSON text, never formulas. Empty unavailable values are blank cells. Nullable totals appear as blank numeric-value cells, accompanied by explicit total availability rows in Summary.

Summary columns: `Property`, `Value`. Existing rows retain their order and meaning; Version uses the actual result version. New/mixed rows appended: `Receipt allocations` = `[]`; `Financial completeness asserted` = `false`; `Ledger total available`, `Statement total available` = boolean text; `Source issues JSON`; `Error inventory refs JSON`; `Source scopes JSON`. Totals are diagnostic original-movement sums, never open-balance sums.

Movements existing columns: Movement ID, Side, Source row, Posting ID, Document type, Own document number, Posting date, Amount minor units, Related invoice, Description, Case ID, Status, Basis, Related evidence JSON. New/mixed columns appended: `Source family`, `Original signed amount raw`, `Open balance raw`, `Open balance role`, `Parent scope ID`, `Parent cell JSON`, `Inherited source cells JSON`, `Line span JSON`. Legacy-side appended fields are blank except Source family=`ar-limited-1`. New original raw is preserved exactly; open raw is descriptive evidence only and role=`descriptive-unverified`. Inherited cells record the five inherited scope identities, each with hash, sheet index/name, original scope-value row/column/raw, parent scope ID, detail row, and parent-cell coordinates. Movement IDs keep side/hash/sheet/original row. CSV rows are logical record positions; optional lineSpan records actual text lines separately.

Cases existing columns: Case ID, Document type, Own document number, Status, Basis, Reason, Member count, Note. New/mixed appended column: `Error inventory refs JSON`; it holds the global diagnostic inventory refs only for source-errors cases; otherwise `[]`.

Membership columns unchanged: Case ID, Movement ID, Side, Source row. Rejected inventory entries are never financial members.

Each inventory existing columns: Source row, Kind, Error, Original column 1 ... Original column N; N is maximum raw record width on that side (zero when empty). New/mixed appended columns: `Inventory ID`, `Classification`, `Errors JSON`, `Line span JSON`. Preserve every selected original record, including scope keys, delimiters, blank records, and invalid rows. Inventory IDs remain separate from financial movement IDs.

Reading columns unchanged: Side, Field, Value. New reading fields include family, header, parent, open; numbers are serialized as decimal text. Scope inheritance does not invent detail identity columns.

Decisions columns unchanged: Sequence, Context, Action, Members JSON, Note, Recorded at UTC. Preserve event order and literal note/time/context.

Sources columns unchanged: Side, Role, Source name, Source SHA-256, Sheet, Chunk, Original bytes base64. Base64 split into ordered chunks of at most 30000 characters. Reassembling per-side chunks yields the exact original source bytes and SHA-256, even when structural errors prevent valid financial members.

## Machine layout

```json
{"schema":"ar-scope-details-1","sheets":["Summary","Movements","Cases","Membership","Ledger inventory","Statement inventory","Reading","Decisions","Sources"],"newColumns":{"Movements":["Source family","Original signed amount raw","Open balance raw","Open balance role","Parent scope ID","Parent cell JSON","Inherited source cells JSON","Line span JSON"],"Cases":["Error inventory refs JSON"],"inventory":["Inventory ID","Classification","Errors JSON","Line span JSON"]},"limits":{"sourceBytes":8388608,"sessionBytes":33554432,"exportBytes":100663296,"events":1000,"base64ChunkChars":30000}}
```

## Proof evidence layout

`evidence-index.json` contains schema, syntheticOnly, fixtures path, cases and lifecycle entries. Each completed case references `input.json` (bundle metadata), `result.json` (actual product result), `session.json` (actual saved bytes), `restored.json` (actual replay result), and `export.xlsx` (actual export bytes), with SHA-256 digests. Source/read rejection cases contain error codes and original input references; no invented result. Lifecycle subdirectories repeat this layout for reopened, accepted, mixed-native/CSV, and legacy compatibility cases. Product results are claims for independent comparison, not expectations. No manual truth or oracle import is used by the product proof driver.

## JSON and coordinates

`Parent cell JSON` is a JSON string such as `"16:1"` (one-based original detail row:parent column). `Inherited source cells JSON` is an object keyed by `entity`, `ledger`, `customer`, `account`, `currency`. Each value is exactly `{hash,sheet,sheetName,row,column,raw,parentScopeId,detailRow,parentCell}`. `sheet` is zero-based selected-sheet index; `row` and `column` are one-based original coordinates. `raw` is literal header-value text. `parentCell` is the coordinate string above. `sheetName` is `CSV` for CSV or actual XLSX worksheet name.

`Source scopes JSON` is an array of `{side,scopeId,reference,cells,detailsMarkerRow,headerRow,endRow}`. `cells` is keyed by the exact twelve scope key names from the sealed contract; each value uses the source-cell shape above, with `detailRow:0` and `parentCell:""`. All marker/header/end coordinates are one-based. `Source issues JSON` is an array of `{side,code,category,inventoryIds}` (category is the independent source-error vocabulary). `Error inventory refs JSON` is an array of inventory ID strings, not movement IDs. New inventory ID pattern is `<side>:<sha256>:<sheetIndex>:inventory:<originalRow>`; movement ID pattern is `<side>:<sha256>:<sheetIndex>:<originalRow>`. `Line span JSON` is `[firstTextLine,lastTextLine]` with one-based text lines, or blank for native sources.

New reading context field order is `family,sheet,header,parent,posting,kind,document,date,amount,related,open,description,role,perspective,basis,confirmed`. Legacy reading context order is `sheet,header,posting,kind,document,date,amount,entity,ledger,customer,account,currency,related,description,role,perspective,basis,confirmed`. Scope order is `entity,ledger,customer,account,currency,start,end,confirmed`. Event context is the exact compact JSON serialization `[version,[ledgerHash,statementHash],[ledgerReadingValues,statementReadingValues],scopeValues]`. `Reading` rows follow the saved reading object's insertion order; field/value equality is authoritative, not that object's insertion order.

Inventory `Kind` is one of header, blank, movement, error. New `Classification` distinguishes scope-marker, scope-header, details-marker, detail-header, end-marker, blank, movement/detail, error; raw record identity and diagnostic evidence are authoritative even when classifications become error. Error is the first recorded product diagnostic code; Errors JSON preserves all codes for that record. The independent checker should compare financial eligibility, preserved raw values, error evidence existence and rejected-row separation, and may normalize documented product diagnostic code aliases to oracle categories. Structural errors suppress all financial members from that source. Detail errors preserve only other valid movements as diagnostic members; any source error prevents automatic pairs throughout the source pair.

The proof driver is product integration code and does not import sealed truth/oracle. Its author inadvertently read the oracle's initial utility/constants section while inspecting source-reader tooling; the sealed independently authored oracle/truth and the product-blind export checker remain unchanged. No expectations were ported from that section.

Sources `Sheet` is always actual selected worksheet name (`CSV` or native sheet name), including legacy exports; it is distinct from zero-based reading/cell `sheet`. Literal CSV grammar for the new family is comma, preserves blank records as zero fields, and retains quoted multiline text. All native literal cells are rebuilt from the actual selected worksheet XML and actual shared-string table after inherited ZIP/namespace/display validation; numeric raw spelling is the original `<v>` text, shared/inline strings are decoded literal text, and missing cells stay blank. Generic-reader merged master propagation never replaces the raw rejected-source inventory. The new family rejects numeric serial dates even when the generic reader can convert them. Raw bytes remain unchanged.

## Diagnostic export capacity

New/mixed exports reject with `AR_EXPORT_EVIDENCE_LIMIT` before constructing workbook tables when any Summary diagnostic JSON cell (source issues, global error inventory refs, source scopes) exceeds 32767 UTF-16 units, or when the global error-ref JSON length times the number of source-errors cases exceeds 8388608 UTF-16 units. The global JSON is serialized once and reused, preventing quadratic string allocation. The existing nine-table layout is preserved; evidence is never truncated. This means 20000 invalid records plus 20000 valid diagnostic members can be read and reconciled but cannot be exported in this layout. Sessions still preserve the original bytes for those sources. A focused test also demonstrates successful export of 250 valid document pairs with an additional rejected row, and rejection of a smaller error population whose repeated case references exceed the aggregate budget. These are capacity controls, not financial-acceptance shortcuts.
