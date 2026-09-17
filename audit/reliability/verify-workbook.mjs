// Independent output reader: OOXML ZIP + SAX + BigInt. No ExcelJS or engine imports.
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

function xml(text) {
  const root = { name: '#document', children: [], text: '', attrs: {} };
  const stack = [root];
  const parser = new SaxesParser();
  parser.on('doctype', () => {
    throw Error('Unexpected document type in exported XML');
  });
  parser.on('opentag', (tag) => {
    const node = {
      name: tag.name.split(':').at(-1),
      attrs: tag.attributes,
      children: [],
      text: '',
    };
    stack.at(-1).children.push(node);
    stack.push(node);
  });
  parser.on('text', (t) => {
    stack.at(-1).text += t;
  });
  parser.on('cdata', (t) => {
    stack.at(-1).text += t;
  });
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(text).close();
  return root.children[0];
}
const child = (node, name) => {
  const found = node?.children.filter((c) => c.name === name) ?? [];
  assert.ok(found.length <= 1, `Duplicate exported XML element ${name}`);
  return found[0];
};
const descendants = (node, name) =>
  node.children.flatMap((c) => [
    ...(c.name === name ? [c] : []),
    ...descendants(c, name),
  ]);
const allText = (node) =>
  node ? node.text + node.children.map(allText).join('') : '';
const sum = (values) => values.reduce((a, b) => a + BigInt(b), 0n);
const scaleOf = (decimals) => 10n ** BigInt(decimals);

export function decimalMinor(text, decimals) {
  assert.ok(Number.isInteger(decimals) && decimals >= 0 && decimals <= 3);
  assert.ok(String(text).length <= 128, 'Output decimal is too long');
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(text));
  assert.ok(m, `Invalid decimal in output: ${text}`);
  const digits = BigInt(m[2] + (m[3] || ''));
  const exponent = decimals + Number(m[4] || 0) - (m[3]?.length || 0);
  assert.ok(
    Number.isInteger(exponent) && Math.abs(exponent) <= 128,
    'Output exponent is outside the verifier bound',
  );
  let minor;
  if (exponent >= 0) minor = digits * 10n ** BigInt(exponent);
  else {
    const divisor = 10n ** BigInt(-exponent);
    assert.equal(
      digits % divisor,
      0n,
      `Export changed currency precision: ${text}`,
    );
    minor = digits / divisor;
  }
  return m[1] === '-' ? -minor : minor;
}

export async function readOutputWorkbook(bytes) {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = Object.keys(zip.files);
  assert.ok(
    !names.some((n) => /externalLinks\/|vbaProject|embeddings\//i.test(n)),
    'No external links/macros/embedded payloads',
  );
  const read = async (name) => {
    const f = zip.file(name);
    assert.ok(f, `Missing ${name}`);
    return xml(await f.async('string'));
  };
  const stringsFile = zip.file('xl/sharedStrings.xml');
  const strings = stringsFile
    ? xml(await stringsFile.async('string'))
        .children.filter((n) => n.name === 'si')
        .map((n) => descendants(n, 't').map(allText).join(''))
    : [];
  const workbook = await read('xl/workbook.xml');
  const epoch = child(workbook, 'workbookPr')?.attrs.date1904;
  assert.ok(
    epoch === undefined || ['0', '1', 'false', 'true'].includes(epoch),
    'Invalid workbook date system',
  );
  const relationships = await read('xl/_rels/workbook.xml.rels');
  assert.ok(
    relationships.children.every((n) => n.attrs.TargetMode !== 'External'),
  );
  const targets = new Map(
    relationships.children.map((n) => [n.attrs.Id, n.attrs.Target]),
  );
  const styles = await read('xl/styles.xml');
  const customFormats = new Map(
    (child(styles, 'numFmts')?.children || []).map((n) => [
      n.attrs.numFmtId,
      n.attrs.formatCode,
    ]),
  );
  customFormats.set('3', '#,##0');
  customFormats.set('4', '#,##0.00');
  const xfs = child(styles, 'cellXfs')?.children || [];
  const sheets = new Map();
  for (const entry of child(workbook, 'sheets').children) {
    const target = targets.get(entry.attrs['r:id']);
    assert.equal(typeof target, 'string', 'Missing worksheet relationship');
    assert.ok(!sheets.has(entry.attrs.name), 'Duplicate worksheet name');
    const source = await read(
      target.startsWith('/') ? target.slice(1) : `xl/${target}`,
    );
    const cells = new Map();
    const rows = new Map();
    for (const row of child(source, 'sheetData')?.children || []) {
      assert.match(
        row.attrs.r,
        /^[1-9]\d*$/,
        'Invalid exported row coordinate',
      );
      assert.ok(!rows.has(Number(row.attrs.r)), 'Duplicate exported row');
      const data = new Map();
      for (const node of row.children.filter((c) => c.name === 'c')) {
        const raw = allText(child(node, 'v'));
        const type = node.attrs.t || 'n';
        assert.notEqual(
          type,
          'e',
          `Excel error ${entry.attrs.name}:${node.attrs.r}`,
        );
        const value =
          type === 's'
            ? strings[Number(raw)]
            : type === 'inlineStr'
              ? allText(child(node, 'is'))
              : raw;
        assert.equal(typeof value, 'string', 'Invalid shared-string index');
        const xf = xfs[Number(node.attrs.s || 0)];
        const cell = {
          address: node.attrs.r,
          type,
          value,
          formula: child(node, 'f') ? allText(child(node, 'f')) : undefined,
          format: customFormats.get(xf?.attrs.numFmtId),
          alignment: child(xf, 'alignment')?.attrs || {},
        };
        assert.match(
          cell.address,
          /^[A-Z]+[1-9]\d*$/,
          'Invalid exported cell coordinate',
        );
        assert.equal(
          Number(cell.address.match(/\d+$/)[0]),
          Number(row.attrs.r),
        );
        assert.ok(!cells.has(cell.address), 'Duplicate exported cell');
        cells.set(cell.address, cell);
        data.set(cell.address.replace(/\d+$/, ''), cell);
      }
      rows.set(Number(row.attrs.r), data);
    }
    const view = child(source, 'sheetViews')?.children[0];
    sheets.set(entry.attrs.name, {
      name: entry.attrs.name,
      state: entry.attrs.state || 'visible',
      rows,
      cells,
      rtl: view?.attrs.rightToLeft === '1',
      source,
    });
  }
  return { sheets, date1904: epoch === '1' || epoch === 'true' };
}

/** Recalculate only the workbook's documented arithmetic functions. Cached
 * results are never inputs to this calculation, and no spreadsheet/engine
 * library participates. All scalar arithmetic uses a shared BigInt scale. */
function formulaEvaluator(sheets, decimals) {
  const memo = new Map(),
    active = new Set();
  const scale = scaleOf(decimals);
  const split = (text, separators) => {
    const parts = [];
    let start = 0,
      depth = 0,
      quote = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) {
          if (text[i + 1] === quote) i++;
          else quote = '';
        }
      } else if (c === '"' || c === "'") quote = c;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        assert.ok(depth >= 0);
      } else if (depth === 0 && separators.includes(c)) {
        parts.push(text.slice(start, i), c);
        start = i + 1;
      }
    }
    assert.ok(!quote && depth === 0, `Unbalanced formula ${text}`);
    parts.push(text.slice(start));
    return parts;
  };
  const columnNumber = (letters) =>
    [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const columnName = (n) => {
    let out = '';
    while (n) {
      n--;
      out = String.fromCharCode(65 + (n % 26)) + out;
      n = Math.floor(n / 26);
    }
    return out;
  };
  const range = (expression, currentSheet) => {
    const m =
      /^(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ ]*))!)?\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/.exec(
        expression.trim(),
      );
    assert.ok(m, `Unsupported reference ${expression}`);
    const name = m[1] || m[2] || currentSheet;
    const sheet = sheets.get(name);
    assert.ok(sheet, `Unknown formula sheet ${name}`);
    const a = columnNumber(m[3]),
      b = columnNumber(m[5] || m[3]);
    const first = Number(m[4]),
      last = Number(m[6] || m[4]);
    assert.ok(
      a <= b && first <= last && (b - a + 1) * (last - first + 1) <= 1000000,
      'Formula range bound',
    );
    const cells = [];
    for (let row = first; row <= last; row++)
      for (let col = a; col <= b; col++)
        cells.push({
          sheet: name,
          cell: sheet.cells.get(`${columnName(col)}${row}`),
        });
    return cells;
  };
  const value = ({ sheet, cell }) => {
    if (!cell || (cell.value === '' && cell.formula === undefined)) return 0n;
    if (cell.formula !== undefined) return calculate(sheet, cell);
    return cell.type === 'n' ? decimalMinor(cell.value, decimals) : 0n;
  };
  const criterion = (raw) => {
    assert.match(raw, /^"(?:[^"]|"")*"$/);
    const text = raw.slice(1, -1).replace(/""/g, '"');
    assert.ok(!/[<>=*?]/.test(text), 'Only literal criteria are supported');
    return text;
  };
  const evaluate = (expression, sheet) => {
    const parts = split(expression, '+-');
    if (parts.length > 1) {
      let n = evaluate(parts[0], sheet);
      for (let i = 1; i < parts.length; i += 2)
        n += (parts[i] === '+' ? 1n : -1n) * evaluate(parts[i + 1], sheet);
      return n;
    }
    if (/^\d+(?:\.\d+)?$/.test(expression))
      return decimalMinor(expression, decimals);
    const call = /^(SUM|COUNTA|COUNTIF|SUMIF)\((.*)\)$/.exec(expression);
    if (!call) {
      const refs = range(expression, sheet);
      assert.equal(refs.length, 1);
      return value(refs[0]);
    }
    const args = split(call[2], ',').filter((_, i) => i % 2 === 0);
    if (call[1] === 'SUM')
      return sum(args.flatMap((arg) => range(arg, sheet)).map(value));
    if (call[1] === 'COUNTA') {
      assert.equal(args.length, 1);
      return (
        BigInt(
          range(args[0], sheet).filter(
            ({ cell }) =>
              cell &&
              (cell.value !== '' ||
                ['s', 'str', 'inlineStr'].includes(cell.type) ||
                cell.formula !== undefined),
          ).length,
        ) * scale
      );
    }
    assert.equal(args.length, call[1] === 'COUNTIF' ? 2 : 3);
    const matches = range(args[0], sheet),
      wanted = criterion(args[1]);
    if (call[1] === 'COUNTIF')
      return (
        BigInt(matches.filter(({ cell }) => cell?.value === wanted).length) *
        scale
      );
    const amounts = range(args[2], sheet);
    assert.equal(amounts.length, matches.length);
    return sum(
      matches.flatMap(({ cell }, i) =>
        cell?.value === wanted ? [value(amounts[i])] : [],
      ),
    );
  };
  const calculate = (sheet, cell) => {
    const id = `${sheet}!${cell.address}`;
    if (memo.has(id)) return memo.get(id);
    assert.ok(
      !active.has(id) && active.size < 100,
      'Cyclic/excessive exported formula',
    );
    active.add(id);
    const n = evaluate(cell.formula, sheet);
    active.delete(id);
    memo.set(id, n);
    return n;
  };
  return calculate;
}

// expected rows and case memberships have already been checked against the
// generator's independent visible-evidence oracle, never copied as new truth.
export async function verifyWorkbook(bytes, expected) {
  const { sheets, date1904 } = await readOutputWorkbook(bytes);
  const visible = [
    'Summary',
    'Matches',
    'Needs Review',
    'Unmatched',
    'Reconciliation Bridge',
    'Review Sign-off',
  ];
  assert.deepEqual(
    [...sheets.values()]
      .filter((s) => s.state === 'visible')
      .map((s) => s.name),
    visible,
  );
  for (const name of visible)
    assert.equal(sheets.get(name).rtl, true, `${name} RTL view`);
  const rowsById = new Map(expected.rows.map((r) => [r.id, r]));
  assert.equal(rowsById.size, expected.rows.length);
  const get = (row, col) => {
    assert.ok(row, 'Missing required output row');
    return row.get(col)?.value ?? '';
  };
  const numeric = (row, col, minor) => {
    const c = row.get(col);
    assert.ok(c, `Missing numeric ${col}`);
    assert.equal(c.type, 'n');
    assert.equal(
      decimalMinor(c.value, expected.decimals),
      BigInt(minor),
      `${col} amount`,
    );
    assert.equal(
      c.format,
      '#,##0' + (expected.decimals ? '.' + '0'.repeat(expected.decimals) : ''),
    );
  };
  const date = (cell, iso) => {
    assert.equal(cell.type, 'n');
    assert.equal(cell.format, 'yyyy-mm-dd');
    const days = BigInt(
      Math.trunc(
        (Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000,
      ),
    );
    assert.equal(decimalMinor(cell.value, 0), days - (date1904 ? 1462n : 0n));
  };
  let numericCells = 0,
    dates = 0,
    sourceRows = 0;
  for (const [name, side] of [
    ['Supplier transactions', 'supplier'],
    ['Ledger transactions', 'ledger'],
  ]) {
    const found = new Set();
    const sheet = sheets.get(name);
    assert.ok(sheet);
    for (const [rn, row] of sheet.rows) {
      if (rn === 1) continue;
      const id = get(row, 'A');
      const oracle = rowsById.get(id);
      assert.ok(oracle, `Unexpected exported source ${id}`);
      assert.equal(oracle.side, side);
      assert.ok(!found.has(id));
      found.add(id);
      assert.equal(get(row, 'B'), oracle.sheet);
      assert.equal(Number(get(row, 'C')), oracle.row);
      assert.equal(get(row, 'E'), oracle.reference, 'Reference text preserved');
      if (oracle.reference)
        assert.ok(
          ['s', 'str', 'inlineStr'].includes(row.get('E')?.type),
          'Reference must remain text',
        );
      assert.equal(get(row, 'G'), oracle.description);
      assert.equal(get(row, 'I'), oracle.originalAmount);
      numeric(row, 'H', oracle.minor);
      date(row.get('D'), oracle.date);
      numericCells++;
      dates++;
      sourceRows++;
    }
    assert.equal(
      found.size,
      expected.rows.filter((r) => r.side === side).length,
    );
  }
  const evidence = sheets.get('Match Evidence');
  assert.ok(evidence);
  const caseMembers = new Map();
  const seen = new Set();
  for (const [rn, row] of evidence.rows) {
    if (rn === 1) continue;
    const id = get(row, 'G'),
      oracle = rowsById.get(id);
    assert.ok(oracle);
    assert.ok(!seen.has(id), 'Source cannot be exported twice');
    seen.add(id);
    const caseId = get(row, 'A');
    if (!caseMembers.has(caseId))
      caseMembers.set(caseId, {
        id: caseId,
        status: get(row, 'C'),
        classification: get(row, 'B'),
        rule: get(row, 'D'),
        members: [],
      });
    const c = caseMembers.get(caseId);
    assert.equal(c.status, get(row, 'C'));
    assert.equal(c.classification, get(row, 'B'));
    assert.equal(c.rule, get(row, 'D'));
    assert.ok(c.rule, 'Every decision needs a rule');
    c.members.push(id);
    assert.equal(get(row, 'F'), oracle.side);
    assert.equal(get(row, 'H'), oracle.sheet);
    assert.equal(Number(get(row, 'I')), oracle.row);
    if (oracle.page) assert.equal(Number(get(row, 'J')), oracle.page);
    assert.equal(get(row, 'L'), oracle.primaryReference || oracle.reference);
    if (expected.currency) assert.equal(get(row, 'R'), expected.currency);
    numeric(row, 'S', oracle.minor);
    date(row.get('K'), oracle.date);
    numericCells++;
    dates++;
  }
  assert.deepEqual(
    [...seen].sort(),
    [...rowsById.keys()].sort(),
    'Every source represented once',
  );
  for (const c of expected.cases) {
    const actual = caseMembers.get(c.id);
    assert.ok(actual);
    assert.equal(actual.status, c.status);
    assert.deepEqual([...actual.members].sort(), [...c.ids].sort());
    if (c.rule) assert.equal(actual.rule, c.rule);
    if (c.classification) assert.equal(actual.classification, c.classification);
  }
  assert.equal(caseMembers.size, expected.cases.length);
  const tracked = new Set();
  const counts = {
    auto: 0,
    manual: 0,
    matchedRows: 0,
    review: 0,
    reviewRows: 0,
    unmatched: 0,
    unmatchedRows: 0,
    rejected: 0,
  };
  for (const name of ['Matches', 'Needs Review', 'Unmatched'])
    for (const [rn, row] of sheets.get(name).rows) {
      if (rn === 1) continue;
      const id = get(row, 'A'),
        c = caseMembers.get(id);
      assert.ok(c);
      assert.ok(!tracked.has(id));
      tracked.add(id);
      const a = c.members
          .map((id) => rowsById.get(id))
          .filter((r) => r.side === 'supplier'),
        b = c.members
          .map((id) => rowsById.get(id))
          .filter((r) => r.side === 'ledger');
      const av = sum(a.map((r) => r.minor)),
        bv = sum(b.map((r) => r.minor));
      if (name === 'Matches') {
        assert.equal(c.status, 'Matched');
        assert.equal(av, bv);
        numeric(row, 'E', av);
        numeric(row, 'H', bv);
        numericCells += 2;
        assert.equal(Number(get(row, 'O')), a.length);
        assert.equal(Number(get(row, 'P')), b.length);
        assert.equal(
          get(row, 'D'),
          [...new Set(a.map((r) => r.primaryReference || r.reference))].join(
            ' | ',
          ),
        );
        assert.equal(
          get(row, 'G'),
          [...new Set(b.map((r) => r.primaryReference || r.reference))].join(
            ' | ',
          ),
        );
        date(row.get('C'), a.map((r) => r.date).sort()[0]);
        date(row.get('F'), b.map((r) => r.date).sort()[0]);
        assert.equal(get(row, 'K'), c.rule);
        assert.equal(get(row, 'M'), c.status);
        assert.ok(['Auto', 'Manual'].includes(get(row, 'Q')));
        counts[get(row, 'Q') === 'Manual' ? 'manual' : 'auto']++;
        counts.matchedRows += c.members.length;
      }
      if (name === 'Needs Review') {
        assert.ok(['Needs Review', 'Rejected'].includes(c.status));
        numeric(row, 'E', av);
        numeric(row, 'F', bv);
        numeric(row, 'G', av - bv);
        numericCells += 3;
        assert.equal(get(row, 'M'), c.status);
        assert.equal(get(row, 'B'), c.classification);
        assert.equal(Number(get(row, 'N')), a.length);
        assert.equal(Number(get(row, 'O')), b.length);
        if (c.status === 'Rejected') counts.rejected++;
        else {
          counts.review++;
          counts.reviewRows += c.members.length;
        }
      }
      if (name === 'Unmatched') {
        assert.equal(c.status, 'Unmatched');
        assert.equal(c.members.length, 1);
        numeric(row, 'H', av + bv);
        const source = [...a, ...b][0];
        assert.equal(get(row, 'B'), source.side);
        assert.equal(
          get(row, 'E'),
          source.primaryReference || source.reference,
        );
        assert.equal(get(row, 'G'), source.description);
        assert.equal(Number(get(row, 'K')), 1);
        date(row.get('C'), source.date);
        numericCells++;
        counts.unmatched++;
        counts.unmatchedRows += c.members.length;
      }
    }
  assert.equal(tracked.size, caseMembers.size);
  const summaryValues = new Map(
    [...sheets.get('Summary').rows.values()].map((r) => [
      get(r, 'A'),
      r.get('B'),
    ]),
  );
  if (expected.currency)
    assert.equal(summaryValues.get('Currency')?.value, expected.currency);
  if (expected.balances) {
    for (const [field, label] of Object.entries({
      supplierOpening: 'Supplier Opening Balance',
      ledgerOpening: 'Ledger Opening Balance',
      supplierClosing: 'Supplier Closing Balance',
      ledgerClosing: 'Ledger Closing Balance',
    })) {
      const minor = expected.balances[field],
        cell = summaryValues.get(label);
      if (minor === null)
        assert.ok(!cell || cell.value === '', `${label} must stay unavailable`);
      else if (minor !== undefined) numeric(new Map([['B', cell]]), 'B', minor);
    }
  }
  for (const [label, value] of Object.entries({
    'Auto Matched Cases': counts.auto,
    'Matched Source Rows': counts.matchedRows,
    'Needs Review Cases': counts.review,
    'Needs Review Source Rows': counts.reviewRows,
    'Unmatched Cases': counts.unmatched,
    'Unmatched Source Rows': counts.unmatchedRows,
    'Manual Matches': counts.manual,
    'Rejected Candidates': counts.rejected,
  })) {
    assert.equal(
      decimalMinor(summaryValues.get(label).value, 0),
      BigInt(value),
      label,
    );
  }
  const bridge = sheets.get('Reconciliation Bridge');
  const labeled = new Map(
    [...bridge.rows.values()]
      .filter((r) => get(r, 'D'))
      .map((r) => [get(r, 'D'), r]),
  );
  const rowEffects = [],
    bridgeCases = new Set();
  for (const [rn, row] of bridge.rows) {
    const c = caseMembers.get(get(row, 'A'));
    if (!c) continue;
    assert.ok(!bridgeCases.has(c.id), 'Bridge case repeated');
    bridgeCases.add(c.id);
    const members = c.members.map((id) => rowsById.get(id));
    const av = sum(
        members.filter((r) => r.side === 'supplier').map((r) => r.minor),
      ),
      bv = sum(members.filter((r) => r.side === 'ledger').map((r) => r.minor));
    numeric(row, 'C', av);
    numeric(row, 'D', bv);
    numeric(row, 'E', bv - av);
    numericCells += 3;
    rowEffects.push(bv - av);
  }
  for (const c of caseMembers.values()) {
    const effect = sum(
      c.members.map((id) => {
        const r = rowsById.get(id);
        return r.side === 'ledger' ? BigInt(r.minor) : -BigInt(r.minor);
      }),
    );
    if (effect !== 0n || ['Needs Review', 'Rejected'].includes(c.status))
      assert.ok(bridgeCases.has(c.id), 'Missing bridge/review case');
  }
  const openingRow = [...bridge.rows.values()].find(
    (r) => get(r, 'A') === 'OPENING_DIFFERENCE',
  );
  const opening = expected.bridge?.openingAdjustment ?? 0;
  assert.equal(
    !!openingRow,
    BigInt(opening) !== 0n,
    'Opening difference row completeness',
  );
  if (openingRow) numeric(openingRow, 'E', opening);
  numeric(
    labeled.get('Net Bridge Adjustments'),
    'E',
    sum(rowEffects) + BigInt(opening),
  );
  numericCells++;
  if (expected.bridge) {
    numeric(
      labeled.get('Adjusted Supplier Balance'),
      'E',
      expected.bridge.adjusted,
    );
    numeric(labeled.get('Residual'), 'E', expected.bridge.residual);
    numericCells += 2;
  } else {
    assert.equal(get(labeled.get('Adjusted Supplier Balance'), 'E'), '');
    assert.equal(get(labeled.get('Residual'), 'E'), '');
  }
  for (const label of [
    'Net Bridge Adjustments',
    'Adjusted Supplier Balance',
    'Residual',
  ]) {
    const cell = summaryValues.get(label),
      value = get(labeled.get(label), 'E');
    assert.equal(
      cell?.value ?? '',
      value,
      `${label} summary/bridge consistency`,
    );
  }
  for (const [field, label] of [
    ['supplierClosing', 'Supplier Closing Balance'],
    ['ledgerClosing', 'Ledger Closing Balance'],
  ]) {
    if (!expected.balances || expected.balances[field] === undefined) continue;
    if (expected.balances[field] === null)
      assert.equal(get(labeled.get(label), 'E'), '');
    else numeric(labeled.get(label), 'E', expected.balances[field]);
  }
  let formulas = 0;
  const calculate = formulaEvaluator(sheets, expected.decimals);
  for (const sheet of sheets.values())
    for (const cell of sheet.cells.values())
      if (cell.formula !== undefined) {
        assert.ok(
          ['Summary', 'Reconciliation Bridge'].includes(sheet.name),
          'Source content became a formula',
        );
        assert.ok(!/HYPERLINK|https?:|WEBSERVICE|\[|\]/i.test(cell.formula));
        assert.equal(cell.type, 'n', 'Formula cache must be numeric');
        assert.equal(
          calculate(sheet.name, cell),
          decimalMinor(cell.value, expected.decimals),
          `Formula/cache mismatch ${sheet.name}!${cell.address}`,
        );
        formulas++;
      }
  return { sourceRows, numericCells, dates, formulas, cases: caseMembers.size };
}
