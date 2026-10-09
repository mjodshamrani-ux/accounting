#!/usr/bin/env python3
"""Independent finite-family native evidence gate; never imports product code.

Usage: python3 scripts/section-qualified-currency-check.py PROOF_DIR
       python3 scripts/section-qualified-currency-check.py PROOF_DIR --controls NEW_DIR
Controls modify disposable copies of downloaded proofs, never product inputs.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'audit/p4-qualified-currency-v1'
FAMILY = 'p4-qualified-currency-v1'
VERSION = 'p4-qualified-currency-native-v1'
POLICY = {'SAR': 2, 'JPY': 0, 'KWD': 3}
# Reviewed public projections; original raw seals remain local.
PINS = {
    'draft': '83c0ce2ccafa08bfff3f20bfa0831eae145434c98ba779cada4c421d38afda79',
    'format-addendum': '1056e5b2a6bf558766475ef53f1c44eee0865528517474b2444df33b044a7852',
    'boundaries': '7d045f9fd964e07c78ceda6e6e46143927375815f291f08d27abb9898a724499',
    'browser': '94dffd30f325de9e0c755204c22b7a8dfa800f7a69715da58abeccf690518c0d',
    'browser-clarification': '5aca126df4fdd033b1773751e7c8f98a7a92e34f674ff92b1ba53dc02bc06a1c',
    'precode-original': 'f4083b3236d61b971b5359298a6b901cc23aac6cb690a538c1cfe372c59cf561',
    'precode-addenda-review': '2d1ee525fe4803e7fc8476ccfec542bd4aa4f7c888b2d57827b43077909020da',
    'precode-closure': '996336775e7e65cc64e8b13c07e6de673b5a5b2476cb018c5866047e30293710',
}
HASH = re.compile(r'^[0-9a-f]{64}$')
SOURCE_FILES = {
    'scripts/section-qualified-currency-browser.mjs', 'scripts/section-qualified-currency-check.py',
    'app/page.tsx', 'components/section-derived-review.tsx', 'lib/reconciliation/section-derived-reading.ts',
    'lib/reconciliation/section-continuation.ts', 'lib/reconciliation/section-currency-context.ts',
    'lib/i18n/section-derived-review.ts', 'lib/reconciliation/types.ts', 'package.json',
    'lib/reconciliation/input-readiness.ts', 'lib/reconciliation/format-inference.ts',
    'lib/reconciliation/io.ts', 'lib/reconciliation/source-preparation.ts', 'lib/reconciliation/core.ts',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(payload):
    return hashlib.sha256(payload).hexdigest()


def unique_object(pairs):
    obj = {}
    for key, value in pairs:
        require(key not in obj, 'duplicate JSON key: ' + key)
        obj[key] = value
    return obj


def load(file):
    return json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique_object)


def proof_file(proof, name):
    require(isinstance(name, str) and name and Path(name).name == name, 'unsafe proof filename')
    file = proof / name
    require(file.is_file(), 'missing proof file: ' + name)
    return file


def sealed_truth():
    for directory, expected in PINS.items():
        manifest_file = BASE / directory / 'MANIFEST.json'
        require(sha(manifest_file.read_bytes()) == expected, 'sealed manifest: ' + directory)
        manifest = load(manifest_file)
        for entry in manifest['files']:
            payload = (manifest_file.parent / entry['path']).read_bytes()
            require(len(payload) == entry['bytes'] and sha(payload) == entry['sha256'],
                    'sealed payload: ' + directory + '/' + entry['path'])
    return load(BASE / 'browser/acceptance-matrix.json')


def short(cell):
    return {k: cell[k] for k in ['row', 'page', 'column', 'literal']}


def cell_check(cell, expected, binding):
    numeric_types(cell)
    require(isinstance(cell, dict) and set(cell) == {
        'sourceHash', 'extractionHash', 'extractionRevision', 'sheet', 'row', 'page', 'column', 'literal'},
        'complete evidence fields')
    require(cell['sheet'] == 1, 'one-based evidence sheet')
    for key in ['sourceHash', 'extractionHash', 'extractionRevision']:
        require(cell[key] == binding[key], 'evidence ' + key)
    row = next((r for r in expected['inventory'] if r['row'] == cell['row'] and r['page'] == cell['page']), None)
    require(row is not None and type(cell['column']) is int and 1 <= cell['column'] <= 4,
            'evidence physical coordinate')
    require(cell['literal'] == row['values'][cell['column'] - 1], 'evidence original literal')


def choice_check(choice, truth):
    require(strict_equal(choice, truth), 'full choice binding/candidates/cuts/precision')


def strict_equal(actual, expected):
    """JSON equality must distinguish false/true from 0/1 and float from int."""
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return set(actual) == set(expected) and all(strict_equal(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(strict_equal(a, e) for a, e in zip(actual, expected))
    return actual == expected


def numeric_types(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'row', 'page', 'column', 'sheet', 'header', 'decimals', 'policyDecimals', 'width', 'viewport',
                       'document', 'body', 'originalRow', 'derivedRow', 'referenceParentRow', 'downloadCount',
                       'selectedPrecision', 'policyPrecision',
                       'date', 'reference', 'description', 'amount', 'debit', 'credit', 'currencyColumn', 'multiplier'}:
                # Literal reference/description values and absent derived rows are distinct schemas.
                if key in {'reference', 'description'} and isinstance(item, str):
                    pass
                elif key in {'derivedRow', 'policyPrecision'} and item is None:
                    pass
                else:
                    require(type(item) is int, 'exact integer JSON type: ' + key)
            if key in {'columns', 'amountMinor', 'dotDecimalMinor', 'dotGroupingMinor', 'excludedRows'}:
                require(isinstance(item, list) and all(type(n) is int for n in item), 'exact integer JSON array: ' + key)
            numeric_types(item)
    elif isinstance(value, list):
        for item in value:
            numeric_types(item)


def false_flags(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'financialApproval', 'scopeConfirmed', 'financialMatching', 'fieldAcceptance',
                       'confirmed', 'coverageConfirmed', 'financialScopeConfirmed', 'nativeReplayConfirmedFinancialScope'}:
                require(item is False, 'nonfinancial flag must be literal false: ' + key)
            false_flags(item)
    elif isinstance(value, list):
        for item in value:
            false_flags(item)


def validate(proof):
    contract = sealed_truth()
    report = load(proof_file(proof, 'observations.json'))
    require(report.get('version') == VERSION and report.get('passed') is True, 'completed native report')
    for key in ['fieldAcceptance', 'financialMatching', 'financialApproval', 'scopeConfirmed', 'expectedFromProduct']:
        require(report.get(key) is False, 'report false flag: ' + key)
    require(report.get('synthetic') is True and report.get('errors') == [], 'synthetic report/errors')
    false_flags(report)
    numeric_types(report)
    specs = contract['positiveCases'] + contract['targetedRefusalCases']
    require(len(specs) == 30 and len(report.get('cases', [])) == 30, 'exact nonempty 30-case coverage')
    identities = [(c.get('key'), c.get('lang'), c.get('id'), c.get('family')) for c in report['cases']]
    expected_ids = [(s['key'], s['lang'], s['id'], FAMILY) for s in specs]
    require(len(set(identities)) == 30 and set(identities) == set(expected_ids), 'exact unique native case identities')
    freeze_file = proof_file(proof, 'freeze.json')
    require(sha(freeze_file.read_bytes()) == report.get('freezeSha256'), 'prelaunch freeze hash')
    freeze = load(freeze_file)
    numeric_types(freeze)
    require(freeze.get('createdBeforeBrowserLaunch') is True and freeze.get('expectedFromProduct') is False,
            'prelaunch freeze declaration')
    require(strict_equal(freeze.get('contract'), contract) and freeze.get('manifestPins') == PINS, 'manual contract pins')
    required_files = set(SOURCE_FILES)
    for directory in PINS:
        manifest = BASE / directory / 'MANIFEST.json'
        required_files.add(manifest.relative_to(ROOT).as_posix())
        required_files.update((manifest.parent / entry['path']).relative_to(ROOT).as_posix() for entry in load(manifest)['files'])
    require(set(freeze.get('files', {})) == required_files, 'exact complete bound source/payload file coverage')
    for file, expected_hash in freeze['files'].items():
        require(sha((ROOT / file).read_bytes()) == expected_hash, 'unchanged bound source: ' + file)
    live_build = {file.relative_to(ROOT / 'dist').as_posix(): sha(file.read_bytes()) for file in (ROOT / 'dist').rglob('*') if file.is_file()}
    require('index.html' in live_build and live_build and strict_equal(freeze.get('buildFiles'), live_build), 'exact live served build names/index/content hashes')
    for name, source in [('driver-snapshot.mjs', 'scripts/section-qualified-currency-browser.mjs'),
                         ('checker-snapshot.py', 'scripts/section-qualified-currency-check.py')]:
        require(sha(proof_file(proof, name).read_bytes()) == freeze['files'][source], 'execution script snapshot')
    require(report.get('browser', {}).get('version') and report['browser'].get('nativeExecutable'), 'installed native browser evidence')
    require(type(report.get('processPid')) is int and report['processPid'] > 0, 'native process')
    require(report.get('requests') and all(r.get('allowed') is True for r in report['requests']), 'loopback requests only')
    bare = report.get('bareControls', [])
    require(len(bare) == 4 and {(c.get('lang'), c.get('id')) for c in bare} ==
            {(lang, s['id']) for s in contract['bareControls'] for lang in s['languages']}, 'exact AR/EN outside-family controls')
    for c in bare:
        require(c.get('outcome') == 'outside-new-family' and c.get('newCurrencyContext') is False and c.get('newCurrencyReceipt') is False
                and c.get('derivedCurrencyArtifact') is False and c.get('downloadCount') == 0 and c.get('pageErrors') == [], 'bare-family unchanged control')
        require(c.get('originalSha256') == load(BASE / 'draft/frozen' / (c['id'] + '.expected.json'))['originalSha256'], 'bare original pin')
    by_key = {c['key']: c for c in report['cases']}
    dot = {c['id']: c for c in load(BASE / 'format-addendum/manual-number-format-truth.json')['cases']}
    checks = []
    measurements = 0
    for spec in specs:
        case = by_key[spec['key']]
        require(case.get('outcome') == spec['outcome'] and case.get('passed') is True, 'case success/outcome: ' + spec['key'])
        require(case.get('pageErrors') == [] and case.get('noFinancialResult') is True, 'case page/financial result')
        require(case.get('originalSha256') == spec['originalSha256'], 'case source binding')
        expected_path = spec.get('expectedPath', spec.get('expectedTruthPath'))
        expected_hash = spec.get('expectedSha256', spec.get('expectedTruthSha256'))
        expected_file = BASE / 'browser' / expected_path
        require(sha(expected_file.read_bytes()) == expected_hash, 'case manual truth pin')
        expected = load(expected_file)
        require(strict_equal(case.get('cuts'), expected['cuts']), 'native original cuts')
        if spec in contract['positiveCases'] or spec.get('wrongSelectedDecimals') is not None:
            policy_decimals = expected.get('currencyContext', {}).get('decimals', spec.get('policyDecimals'))
            selected_decimals = spec.get('wrongSelectedDecimals')
            if case.get('initialReviewSurfaceAvailable') is False:
                require(spec in contract['targetedRefusalCases'] and strict_equal(case.get('precisionDisplay'),
                        {'selectedPrecision': selected_decimals, 'policyPrecision': None, 'surface': 'original-scope-control-inspect-refused'}), 'observed wrong precision scope control with refused Inspect')
            else:
                require(strict_equal(case.get('precisionDisplay'), {'selectedPrecision': policy_decimals if selected_decimals is None else selected_decimals, 'policyPrecision': policy_decimals}), 'visible selected precision and fixed finite policy')
        require(case.get('sourceInventory') == expected['inventory'], 'all original UI physical inventory')
        if case.get('initialReviewSurfaceAvailable') is True:
            require(case.get('derivativeInventory') == expected['inventory'] and case.get('displayedCitations'), 'native derivative inventory and citations are recorded')
        elif case.get('initialReviewSurfaceAvailable') is False:
            require(spec in contract['targetedRefusalCases'] and spec['refusalTiming'] != 'late-apply-validation-preserved', 'Inspect absence only earns early refusal')
            if not spec['extraKwdSubsteps']:
                require(case.get('originalBinding') is None and case.get('derivativeInventory') is None and case.get('displayedCitations') == [], 'refused Inspect mints no invented review evidence')
        else:
            raise ValueError('literal observed Inspect surface availability is required')
        for citation in case['displayedCitations']:
            require(set(citation) == {'key', 'literal'} and isinstance(citation['key'], str), 'native citation record')
            coordinate = citation['key'].split(':')
            require(len(coordinate) == 4 and all(re.fullmatch(r'[1-9][0-9]*', n) for n in coordinate), 'native evidence coordinate types')
            sheet, page, row, column = map(int, coordinate)
            physical = next((r for r in expected['inventory'] if r['row'] == row and r['page'] == page), None)
            require(sheet == 1 and physical is not None and 1 <= column <= 4 and citation['literal'] == (physical['values'][column - 1] or '∅'), 'every displayed native literal/coordinate')
        states = spec.get('requiredSurfaceStates', ['refusal'])
        require([m.get('state') for m in case.get('measurements', [])] == states, 'required responsive states')
        for state in case['measurements']:
            require([m.get('width') for m in state.get('measurements', [])] == [320, 390], 'exact responsive widths')
            for m in state['measurements']:
                require(m['viewport'] == m['width'] and m['document'] <= m['width'] + 1 and m['body'] <= m['width'] + 1,
                        'responsive overflow')
                require(proof_file(proof, m['screenshot']).stat().st_size > 0, 'native screenshot')
                measurements += 1
        if spec in contract['targetedRefusalCases']:
            require(case.get('downloadCount') == 0 and case.get('noArtifact') is True and case.get('noUsableReceipt') is True,
                    'refusal no partial/download/receipt')
            require('downloads' not in case and case.get('refusal'), 'observed refusal')
            if spec['refusalTiming'] == 'late-apply-validation-preserved':
                require(case.get('structuralReceiptMinted') is True and case.get('lateApplyRefused') is True,
                        'late Apply boundary')
            else:
                require(case.get('earlyReceiptRefused') is True, 'early currency admission refusal')
            if spec['source'] == 'kwd-excess-fraction':
                negative = load(BASE / 'browser-clarification/manual-negative-choice-binding.json')
                choice_check(case.get('ownOriginalNumberChoice'), negative['originalNumberFormatChoice'])
                require(case.get('originalDotInterpretationReviewed') is True, 'negative own dot acknowledgement')
                binding = case['originalBinding']
                require(binding['sourceHash'] == negative['originalSha256'] and HASH.fullmatch(binding['extractionHash'])
                        and binding['extractionRevision'], 'negative fresh binding')
            if spec['extraKwdSubsteps']:
                require(strict_equal(case.get('extraKwdSubsteps'), {s: True for s in spec['extraKwdSubsteps']}), 'every KWD early refusal substep')
                require(case.get('selectedExponentRefusal', {}).get('noArtifact') is True and case['selectedExponentRefusal'].get('noUsableReceipt') is True,
                        'KWD initial exponent refusal remains distinct from correct-exponent dot review controls')
            continue
        require(set(case.get('downloads', {})) == {'csv', 'original', 'provenance'}, 'complete native download triple')
        payload = proof_file(proof, case['downloads']['csv']).read_bytes()
        original = proof_file(proof, case['downloads']['original']).read_bytes()
        require(payload == (BASE / 'browser' / spec['csvPath']).read_bytes() and sha(payload) == spec['csvSha256'], 'exact CSV bytes/hash')
        require(original == (BASE / 'browser' / spec['originalPath']).read_bytes() and sha(original) == spec['originalSha256'], 'preserved PDF bytes/hash')
        rows = list(csv.reader(io.StringIO(payload.decode('utf-8-sig'), newline='')))
        require(rows == expected['csvRows'], 'all exact CSV fields')
        context_truth = expected['currencyContext']
        currency, decimals = context_truth['currency'], context_truth['decimals']
        require(POLICY[currency] == decimals and rows[0] == ['Date', 'Reference', 'Description', 'Signed amount (' + currency + ')'], 'qualified CSV header/exponent')
        literals = [row[3] for row in rows[1:]]
        scaled = [Decimal(x) * Decimal(10) ** decimals for x in literals]
        require(all(x == x.to_integral_value() for x in scaled), 'no rounded fractional minor units')
        minor = [int(x) for x in scaled]
        require(literals == expected['signedAmounts'] and minor == expected['amountMinor'] and sum(minor) == expected['totalMinor'], 'independent signed Decimal arithmetic')
        provenance = load(proof_file(proof, case['downloads']['provenance']))
        false_flags(provenance)
        numeric_types(provenance)
        sidecar_keys = {'version', 'kind', 'financialApproval', 'scopeConfirmed', 'originalName', 'originalSha256',
                        'derivedName', 'derivedSha256', 'extractionRevision', 'extractionHash', 'selectionHash',
                        'selectedProposalIds', 'originalReading', 'derivedReading', 'decimals', 'currencyContext', 'reviewer', 'inventory', 'links'}
        if spec['originalDotReviewRequired']:
            sidecar_keys.update({'originalNumberInterpretation', 'derivedNumberInterpretation'})
        require(set(provenance) == sidecar_keys and provenance['version'] == 'P4_SECTION_DERIVED_V1'
                and provenance['kind'] == 'explicitly-derived-section-csv', 'exact qualified provenance schema and structural kind')
        require(provenance['originalName'] == spec['key'] + '-0.pdf' and provenance['derivedName'] == spec['key'] + '-0.section-derived.csv', 'native original/derived triple filenames')
        require(provenance.get('financialApproval') is False and provenance.get('scopeConfirmed') is False, 'sidecar false financial/scope flags')
        require(provenance.get('originalSha256') == spec['originalSha256'] and provenance.get('derivedSha256') == spec['csvSha256'], 'sidecar triple hashes')
        require(provenance.get('decimals') == decimals, 'sidecar precision')
        ctx = provenance.get('currencyContext')
        require(isinstance(ctx, dict) and set(ctx) == {'code', 'decimals', 'precisionOrigin', 'headerCells'}, 'exactly one finite currency context')
        require({k: ctx[k] for k in ['code', 'decimals', 'precisionOrigin']} == {'code': currency, 'decimals': decimals, 'precisionOrigin': 'finite-contract-policy'}, 'finite currency context values')
        binding = case['originalBinding']
        require(binding == {'sourceHash': provenance['originalSha256'], 'extractionHash': provenance['extractionHash'], 'extractionRevision': provenance['extractionRevision']}
                and HASH.fullmatch(binding['extractionHash']) and isinstance(binding['extractionRevision'], str) and binding['extractionRevision'], 'live original extraction binding')
        require([{k: c[k] for k in ['sourceHash', 'row', 'page', 'column', 'literal']} for c in ctx['headerCells']] == expected['currencyEvidence'], 'every exact currency header citation')
        for cell in ctx['headerCells']:
            cell_check(cell, expected, binding)
        require(case.get('currencyCitations') == [{'key': f"1:{c['page']}:{c['row']}:{c['column']}", 'literal': c['literal']} for c in expected['currencyEvidence']], 'native currency citation display')
        displayed_expected = list(case['currencyCitations'])
        for link in expected['links']:
            if link['referenceOrigin'] != 'accepted-section-proposal':
                continue
            target = next(r for r in expected['inventory'] if r['row'] == link['originalRow'])
            parent = next(r for r in expected['inventory'] if r['row'] == link['referenceParentRow'])
            cited = [(target, 2), (parent, 1), (parent, 2)]
            for row in expected['inventory']:
                if row['row'] < target['row'] and row['values'][0] == 'Continued invoice':
                    cited.extend([(row, 1), (row, 2)])
            for row in expected['inventory']:
                if 1 < row['row'] < target['row'] and row['row'] in expected['headerRows']:
                    cited.extend((row, i) for i in range(1, 5))
            displayed_expected.extend({'key': f"1:{row['page']}:{row['row']}:{column}", 'literal': row['values'][column - 1] or '∅'} for row, column in cited)
        require(case['displayedCitations'] == displayed_expected, 'all mandatory native proposal role/value/header citations')
        inventory = provenance['inventory']
        require([{'row': r['originalRow'], 'page': r['page'], 'values': r['values']} for r in inventory] == expected['inventory'], 'whole provenance inventory')
        linked_rows = {l['originalRow']: l['derivedRow'] for l in expected['links']}
        require(all(r['derivedRow'] == linked_rows.get(r['originalRow']) for r in inventory), 'inventory derivative links')
        for native, row in zip(inventory, expected['inventory']):
            kind = ('header' if row['row'] in expected['headerRows'] else 'parent' if row['values'][0] == 'Invoice No'
                    else 'continuation' if row['values'][0] == 'Continued invoice' else 'movement')
            require(native.get('kind') == kind, 'original structural row classification')
        require(len(provenance['links']) == len(expected['links']), 'all links, no duplicates')
        for link, truth in zip(provenance['links'], expected['links']):
            for key in ['originalRow', 'page', 'derivedRow', 'reference', 'referenceOrigin']:
                require(link[key] == truth[key], 'link ' + key)
            for role, column in [('dateEvidence', 1), ('descriptionEvidence', 3), ('amountEvidence', 4)]:
                cell_check(link[role], expected, binding)
                require(link[role]['row'] == truth['originalRow'] and link[role]['column'] == column, 'movement role coordinate')
            require(link['amountEvidence']['literal'] == truth['amountLiteral'], 'link signed literal')
            cell_check(link['referenceEvidence'], expected, binding)
            if truth['referenceOrigin'] == 'explicit-source-cell':
                require('proposal' not in link and link['referenceEvidence']['row'] == truth['originalRow'] and link['referenceEvidence']['column'] == 2,
                        'original explicit reference citation')
            else:
                proposal = link['proposal']
                require(set(proposal) == {'id', 'reference', 'target', 'parent', 'parentSpan', 'continuation', 'continuationSpans', 'headers', 'rule', 'authority'}, 'exact qualified proposal schema')
                require(proposal['id'] == binding['extractionHash'] + ':' + str(truth['originalRow']), 'bound proposal identity')
                require(proposal['target']['row'] == truth['originalRow'] and proposal['target']['column'] == 2 and proposal['reference'] == truth['reference'], 'section proposal target/reference')
                parent = proposal.get('parentSpan', [proposal['parent']])
                parent_row = next(r for r in expected['inventory'] if r['row'] == truth['referenceParentRow'])
                require(proposal['authority'] == 'structural-review-only' and proposal['rule'] == ('explicit-section-reference' if truth['page'] == parent_row['page'] else 'explicit-page-continuation'), 'finite structural proposal authority/rule')
                require([short(c) for c in parent] == [{'row': parent_row['row'], 'page': parent_row['page'], 'column': i + 1, 'literal': parent_row['values'][i]} for i in [0, 1]], 'complete reference parent span')
                require(link['referenceEvidence']['row'] == truth['referenceParentRow'] and link['referenceEvidence']['column'] == 2 and link['referenceEvidence']['literal'] == truth['reference'], 'reference parent evidence')
                continuations = [r for r in expected['inventory'] if r['row'] < truth['originalRow'] and r['values'][0] == 'Continued invoice']
                spans = proposal.get('continuationSpans', [[c] for c in proposal['continuation']])
                require([[short(c) for c in span] for span in spans] == [[{'row': r['row'], 'page': r['page'], 'column': i + 1, 'literal': r['values'][i]} for i in [0, 1]] for r in continuations], 'all continuation role/value spans')
                continued_headers = [r for r in expected['inventory'] if r['row'] > 1 and r['row'] < truth['originalRow'] and r['row'] in expected['headerRows']]
                require([[short(c) for c in span] for span in proposal['headers']] == [[{'row': r['row'], 'page': r['page'], 'column': i + 1, 'literal': r['values'][i]} for i in range(4)] for r in continued_headers], 'all continuation header cells')
                require(proposal['parent'] == parent[1] and proposal['continuation'] == [span[1] for span in spans], 'direct role citations equal exact value-span citations')
                cells = [proposal['target'], proposal['parent'], *proposal['continuation'], *parent, *sum(spans, []), *sum(proposal['headers'], [])]
                for cell in cells:
                    cell_check(cell, expected, binding)
        selected = [binding['extractionHash'] + ':' + str(l['originalRow']) for l in expected['links'] if l['referenceOrigin'] == 'accepted-section-proposal']
        require(provenance['selectedProposalIds'] == selected, 'every required proposal selected exactly once')
        acks = provenance['reviewer']['acknowledgements']
        require(provenance['reviewer']['label'].strip() and provenance['reviewer']['rationale'].strip(), 'reviewer/rationale')
        require(all(acks.get(k) is True for k in ['originalRowsReviewed', 'referenceRolesReviewed', 'signedAmountsPreserved', 'derivedSourceUnderstood']), 'ordinary explicit acknowledgements')
        for is_original, reading in [(True, provenance['originalReading']), (False, provenance['derivedReading'])]:
            reading_keys = {'sheet', 'header', 'date', 'reference', 'description', 'amount', 'debit', 'credit', 'currencyColumn',
                            'mode', 'multiplier', 'numberFormat', 'dateFormat', 'reportType', 'opening', 'closing', 'periodStart', 'excluded'}
            if is_original:
                reading_keys.add('pdfReviewed')
                require(reading.get('pdfReviewed') is True, 'original native PDF explicitly reviewed')
            if spec['originalDotReviewRequired']:
                reading_keys.add('formatChoice')
                require(set(reading['formatChoice']) == {'numberFormat'}, 'only supported numeric interpretation choice')
            require(set(reading) == reading_keys, 'exact finite reading schema without direction/balance/date-choice overrides')
            for key, value in {'sheet': 0, 'header': 0, 'date': 0, 'reference': 1, 'description': 2, 'amount': 3,
                               'mode': 'signed', 'multiplier': 1, 'currencyColumn': -1, 'debit': -1, 'credit': -1,
                               'numberFormat': 'dot', 'dateFormat': 'ymd', 'reportType': 'transactions', 'periodStart': '',
                               'opening': '', 'closing': '', 'excluded': {}}.items():
                require(strict_equal(reading.get(key), value), 'finite reading: ' + key)
        if spec['originalDotReviewRequired']:
            t = dot[spec['id']]
            require(acks.get('originalDotInterpretationReviewed') is True, 'explicit original dot acknowledgement')
            choice_check(provenance.get('originalNumberInterpretation'), t['originalNumberFormatChoice'])
            choice_check(provenance.get('derivedNumberInterpretation'), t['derivedNumberFormatChoice'])
            choice_check(provenance['originalReading']['formatChoice']['numberFormat'], t['originalNumberFormatChoice'])
            choice_check(provenance['derivedReading']['formatChoice']['numberFormat'], t['derivedNumberFormatChoice'])
            require(case.get('originalNumberChoice') == t['originalNumberFormatChoice'] and case.get('derivedNumberChoice') == t['derivedNumberFormatChoice'], 'live choices match sidecar/manual')
            require(case.get('originalNumberFormat') == {'status': 'ambiguous', 'candidates': ['dot', 'comma']} and case.get('derivedNumberFormat') == {'status': 'ambiguous', 'candidates': ['dot', 'comma']}, 'fresh original/derived candidate reconstruction')
            require(case.get('amountInterpretations') == t['numericInterpretations'], 'native two KWD interpretations')
        else:
            require('originalNumberInterpretation' not in provenance and 'derivedNumberInterpretation' not in provenance
                    and 'originalDotInterpretationReviewed' not in acks, 'no redundant proven-format acknowledgement')
        fresh = case['freshReader']
        require(fresh.get('rows') == rows and fresh.get('amountMinor') == minor and fresh.get('signedLiterals') == literals and fresh.get('errors') == []
                and fresh.get('currency') == currency and fresh.get('decimals') == decimals and fresh.get('confirmed') is False and fresh.get('coverageConfirmed') is False,
                'fresh native CSV uses actual unconfirmed policy')
        require(case.get('reviewerReceiptInvalidation') is True and case.get('selectionReceiptInvalidation') is True, 'receipt invalidations')
        require(strict_equal(case.get('ordinaryFormRefusals'), {'missingReviewer': True, 'missingRationale': True, 'missingAcknowledgements': True}), 'each missing ordinary form requirement')
        require(strict_equal(case.get('unselectedProposalRefusal'), {'structuralReceiptMinted': True, 'lateApplyRefused': True, 'noArtifact': True, 'noUsableReceipt': True, 'downloadCount': 0}), 'unselected movements late refusal and receipt consumption')
        if spec['freshReloadRemountProbe']:
            require(strict_equal(case.get('freshReloadRemount'), {'freshReviewRequired': True, 'noArtifact': True, 'noUsableReceipt': True}), 'fresh original remount')
        if spec['pendingLifecycleProbe']:
            require(set(case.get('pendingLifecycle', {})) == {'clear', 'replaceSource', 'updateReviewer'}, 'all pending lifecycle probes')
            for event in case['pendingLifecycle'].values():
                require(event.get('heldOriginalDigest') == spec['originalSha256'] and event.get('releasedUnmodified') is True
                        and event.get('noArtifact') is True and event.get('noUsableReceipt') is True and event.get('downloadCount') == 0,
                        'pending original replay suppression')
        checks.append({'key': case['key'], 'amountMinor': minor, 'totalMinor': sum(minor), 'csvSha256': sha(payload), 'originalSha256': sha(original)})
    require(measurements == 132 and len(checks) == 18, 'exact primary measurement/positive coverage')
    return {'version': VERSION, 'passed': True, 'productImports': False, 'expectedFromProduct': False,
            'financialAuthority': False, 'cases': 30, 'widthMeasurements': measurements, 'checks': checks}


def controls(proof, destination):
    validate(proof)
    destination.mkdir(parents=True, exist_ok=False)
    mutations = {
        'empty-report': lambda r, p: r.update(cases=[]),
        'missing-case': lambda r, p: r['cases'].pop(),
        'duplicate-case': lambda r, p: r['cases'].__setitem__(-1, r['cases'][0]),
        'extra-case': lambda r, p: r['cases'].append(r['cases'][0]),
        'missing-source-file': lambda r, p: None,
        'source-byte': lambda r, p: None,
        'source': lambda r, p: p.update(originalSha256='0' * 64),
        'currency': lambda r, p: p['currencyContext'].update(code='SAR'),
        'precision': lambda r, p: p['currencyContext'].update(decimals=2),
        'citation': lambda r, p: p['currencyContext']['headerCells'][0].update(column=3),
        'missing-context': lambda r, p: p.pop('currencyContext'),
        'extra-context': lambda r, p: p['currencyContext'].update(extraContext={}),
        'duplicate-context-json': lambda r, p: None,
        'missing-header': lambda r, p: p['currencyContext']['headerCells'].pop(),
        'duplicate-header': lambda r, p: p['currencyContext']['headerCells'].append(p['currencyContext']['headerCells'][0]),
        'header-source': lambda r, p: p['currencyContext']['headerCells'][0].update(sourceHash='0' * 64),
        'header-literal': lambda r, p: p['currencyContext']['headerCells'][0].update(literal='Signed amount (SAR)'),
        'header-row': lambda r, p: p['currencyContext']['headerCells'][0].update(row=2),
        'header-page': lambda r, p: p['currencyContext']['headerCells'][0].update(page=2),
        'candidates': lambda r, p: p['originalNumberInterpretation'].update(candidates=['dot']),
        'extra-candidate': lambda r, p: p['originalNumberInterpretation'].update(candidates=['dot', 'comma', 'other']),
        'duplicate-candidate': lambda r, p: p['originalNumberInterpretation'].update(candidates=['dot', 'comma', 'dot']),
        'choice-source': lambda r, p: p['originalNumberInterpretation'].update(sourceHash='0' * 64),
        'choice-columns': lambda r, p: p['originalNumberInterpretation'].update(columns=[2]),
        'choice-header': lambda r, p: p['originalNumberInterpretation'].update(header=1),
        'choice-exponent': lambda r, p: p['originalNumberInterpretation'].update(decimals=2),
        'choice-cuts': lambda r, p: p['originalNumberInterpretation'].update(cuts=[]),
        'derived-source': lambda r, p: p['derivedNumberInterpretation'].update(sourceHash=p['originalSha256']),
        'derived-cuts': lambda r, p: p['derivedNumberInterpretation'].update(cuts=[25, 45, 70]),
        'derived-candidates': lambda r, p: p['derivedNumberInterpretation'].update(candidates=['dot', 'dot', 'comma']),
        'derived-column': lambda r, p: p['derivedNumberInterpretation'].update(columns=[2]),
        'derived-exponent': lambda r, p: p['derivedNumberInterpretation'].update(decimals=2),
        'missing-ack': lambda r, p: p['reviewer']['acknowledgements'].pop('originalDotInterpretationReviewed'),
        'false-ack': lambda r, p: p['reviewer']['acknowledgements'].update(originalDotInterpretationReviewed=False),
        'sidecar-financial': lambda r, p: p.update(financialApproval=True),
        'sidecar-scope': lambda r, p: p.update(scopeConfirmed=True),
        'missing-financial-flag': lambda r, p: p.pop('financialApproval'),
        'missing-scope-flag': lambda r, p: p.pop('scopeConfirmed'),
        'csv-byte': lambda r, p: None,
        'jpy-context-decimals-false': lambda r, p: p['currencyContext'].update(decimals=False),
        'jpy-sidecar-decimals-false': lambda r, p: p.update(decimals=False),
        'jpy-sheet-true': lambda r, p: p['currencyContext']['headerCells'][0].update(sheet=True),
        'jpy-page-true': lambda r, p: p['currencyContext']['headerCells'][0].update(page=True),
        'jpy-fresh-decimals-false': lambda r, p: next(c for c in r['cases'] if c['key'] == 'ar-jpy-cross-page')['freshReader'].update(decimals=False),
        'original-report-type': lambda r, p: p['originalReading'].update(reportType='open-items'),
        'original-period': lambda r, p: p['originalReading'].update(periodStart='2026-01-01'),
        'original-direction': lambda r, p: p['originalReading'].update(directionEvidence={}),
        'original-pdf-review': lambda r, p: p['originalReading'].update(pdfReviewed=False),
        'derived-report-type': lambda r, p: p['derivedReading'].update(reportType='open-items'),
        'derived-period': lambda r, p: p['derivedReading'].update(periodStart='2026-01-01'),
        'proposal-authority': lambda r, p: p['links'][0]['proposal'].update(authority='financially-approved'),
        'proposal-rule': lambda r, p: p['links'][0]['proposal'].update(rule='automatic-inference'),
        'direct-parent-source': lambda r, p: p['links'][0]['proposal']['parent'].update(sourceHash='0' * 64),
        'direct-parent-extraction': lambda r, p: p['links'][0]['proposal']['parent'].update(extractionHash='0' * 64),
        'direct-continuation-source': lambda r, p: p['links'][1]['proposal']['continuation'][0].update(sourceHash='0' * 64),
        'unexpected-proposal-header-bands': lambda r, p: p['links'][1]['proposal'].update(headerBands=[]),
        'omitted-helper-pin': lambda r, p: None,
        'omitted-app-pin': lambda r, p: None,
        'extra-source-pin': lambda r, p: None,
        'arbitrary-build-map': lambda r, p: None,
        'missing-build-index': lambda r, p: None,
        'missing-build-asset': lambda r, p: None,
        'extra-build-file': lambda r, p: None,
        'build-hash-mismatch': lambda r, p: None,
    }
    results = []
    for name, mutate in mutations.items():
        target = destination / name
        target.mkdir()
        # Preserve originals and link unchanged large screenshots; only copies are edited.
        for file in proof.iterdir():
            if file.is_file():
                if file.suffix == '.png':
                    (target / file.name).symlink_to(os.path.relpath(file.resolve(), target.resolve()))
                else:
                    shutil.copyfile(file, target / file.name)
        report = load(target / 'observations.json')
        case = next(c for c in report['cases'] if c['key'] == ('ar-jpy-cross-page' if name.startswith('jpy-') else 'ar-kwd-cross-page'))
        sidecar_file = target / case['downloads']['provenance']
        sidecar = load(sidecar_file)
        mutate(report, sidecar)
        if name in {'omitted-helper-pin', 'omitted-app-pin', 'extra-source-pin', 'arbitrary-build-map', 'missing-build-index', 'missing-build-asset', 'extra-build-file', 'build-hash-mismatch'}:
            freeze_file = target / 'freeze.json'
            freeze = load(freeze_file)
            if name == 'omitted-helper-pin':
                freeze['files'].pop('lib/reconciliation/section-currency-context.ts')
            elif name == 'omitted-app-pin':
                freeze['files'].pop('app/page.tsx')
            elif name == 'extra-source-pin':
                freeze['files']['docs/P4-QUALIFIED-CURRENCY-CONTRACT.ar.md'] = sha((ROOT / 'docs/P4-QUALIFIED-CURRENCY-CONTRACT.ar.md').read_bytes())
            elif name == 'arbitrary-build-map':
                freeze['buildFiles'] = {'arbitrary.js': '0' * 64}
            elif name == 'missing-build-index':
                freeze['buildFiles'].pop('index.html')
            elif name == 'missing-build-asset':
                freeze['buildFiles'].pop(next(n for n in freeze['buildFiles'] if n.endswith('.js')))
            elif name == 'extra-build-file':
                freeze['buildFiles']['arbitrary.js'] = '0' * 64
            else:
                freeze['buildFiles']['index.html'] = '0' * 64
            freeze_file.write_text(json.dumps(freeze, ensure_ascii=False, indent=2) + '\n')
            report['freezeSha256'] = sha(freeze_file.read_bytes())
        (target / 'observations.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        sidecar_file.write_text(json.dumps(sidecar, ensure_ascii=False, indent=2) + '\n')
        if name == 'duplicate-context-json':
            sidecar_file.write_text(sidecar_file.read_text().replace('"currencyContext": {', '"currencyContext": {},\n  "currencyContext": {', 1))
        if name == 'missing-source-file':
            (target / case['downloads']['original']).unlink()
        if name == 'source-byte':
            original_file = target / case['downloads']['original']
            original_file.write_bytes(original_file.read_bytes() + b' ')
        if name == 'csv-byte':
            csv_file = target / case['downloads']['csv']
            csv_file.write_bytes(csv_file.read_bytes() + b' ')
        try:
            validate(target)
        except (ValueError, KeyError, TypeError, OSError, StopIteration) as error:
            failure = {'control': name, 'refused': True, 'reason': str(error)}
            (target / 'checker-refusal.json').write_text(json.dumps(failure, indent=2) + '\n')
            results.append(failure)
        else:
            raise ValueError('tampered proof incorrectly accepted: ' + name)
    result = {'passed': True, 'productSidecarImportApi': False, 'claim': 'checker-refuses-modified-downloaded-provenance',
              'baselineProofRelativeToControlsRoot': os.path.relpath(proof.resolve(), destination.resolve()),
              'baselineFreezeSha256': sha((proof / 'freeze.json').read_bytes()),
              'baselineObservationsSha256': sha((proof / 'observations.json').read_bytes()),
              'sharedScreenshotPins': {file.name: sha(file.read_bytes()) for file in proof.glob('*.png')}, 'controls': results}
    (destination / 'controls.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('proof', type=Path)
    parser.add_argument('--controls', type=Path)
    args = parser.parse_args()
    try:
        result = controls(args.proof, args.controls) if args.controls else validate(args.proof)
        if not args.controls:
            (args.proof / 'independent-python.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(result, ensure_ascii=False))
    except (ValueError, KeyError, TypeError, OSError, StopIteration) as error:
        print(json.dumps({'passed': False, 'refused': True, 'reason': str(error)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
