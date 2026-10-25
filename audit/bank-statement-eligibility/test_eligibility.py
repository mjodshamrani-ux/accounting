"""The eligibility checker against planted faults: a clean page passes every
check, and each page built with one refusal the reader declares is found by
the check for it.

  PYTHONPATH=<pymupdf 2.0> python3 -B -m unittest discover -s audit/bank-statement-eligibility -p test_eligibility.py -v
"""
import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import columns  # noqa: E402
import eligibility as el  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix='eligibility-'))


def statement(name, build=None, **text):
    """A page of two statement lines 16 points apart under a rule."""
    doc = pymupdf.open()
    page = doc.new_page(width=420, height=300)
    page.insert_text((40, 80), '2026-04-01 Transfer INV-26-0004 1,250.00', fontsize=10, **text)
    page.insert_text((40, 96), '2026-04-02 Card settlement 980.15', fontsize=10)
    page.draw_line((36, 104), (384, 104), color=(0.6, 0.6, 0.6), width=0.5)
    if build:
        build(doc, page)
    path = TMP / f'{name}.pdf'
    doc.save(path)
    return path


def found(path):
    """The page checks' findings. These pages are fragments of a statement,
    without its header, so the reading by columns is tested on whole
    statements in Columns below."""
    return {k: v for k, v in el.check_pdf(path)['found'].items() if k != 'columns'}


class Planted(unittest.TestCase):
    def test_clean_page_passes_every_check(self):
        result = el.check_pdf(statement('clean'))
        self.assertEqual({k: v for k, v in result['found'].items() if k != 'columns'}, {})
        self.assertEqual(result['found']['columns'][0]['code'], 'HEADER')
        self.assertIsNotNone(result['leastRuleGapPt'])

    def test_rotation(self):
        self.assertIn('rotation', found(statement('rotation', lambda d, p: p.set_rotation(90))))

    def test_direction(self):
        def turned(doc, page):
            page.insert_text((200, 200), 'Closing balance 12,000.00', fontsize=10, rotate=90)
        self.assertIn('direction', found(statement('direction', turned)))

    def test_images(self):
        def logo(doc, page):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 4, 4), False)
            pix.clear_with(120)
            page.insert_image(pymupdf.Rect(300, 20, 320, 30), pixmap=pix)
        self.assertIn('images', found(statement('images', logo)))

    def test_widgets(self):
        def field(doc, page):
            w = pymupdf.Widget()
            w.field_name, w.field_type = 'amount', pymupdf.PDF_WIDGET_TYPE_TEXT
            w.rect = pymupdf.Rect(300, 150, 380, 165)
            page.add_widget(w)
        self.assertIn('widgets', found(statement('widgets', field)))

    def test_layers(self):
        def layer(doc, page):
            oc = doc.add_ocg('hidden', on=False)
            page.insert_text((40, 140), 'Adjustment 500.00', fontsize=10, oc=oc)
        self.assertIn('layers', found(statement('layers', layer)))

    def test_encryption(self):
        doc = pymupdf.open(statement('plain'))
        path = TMP / 'encryption.pdf'
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw='owner', user_pw='user')
        self.assertIn('encryption', found(path))

    def test_size(self):
        doc = pymupdf.open()
        for _ in range(101):
            doc.new_page().insert_text((40, 80), 'Page', fontsize=10)
        path = TMP / 'long.pdf'
        doc.save(path)
        self.assertIn('size', el.check_pdf(path)['found'])

    def test_page_edge(self):
        def edge(doc, page):
            page.insert_text((40, 4), 'Statement of account', fontsize=10)
        self.assertIn('pageEdge', found(statement('edge', edge)))

    def test_hidden_text(self):
        def hidden(doc, page):
            page.insert_text((40, 140), '9,999.00', fontsize=10, render_mode=3)
        self.assertIn('hiddenText', found(statement('hidden', hidden)))

    def test_contrast(self):
        def pale(doc, page):
            page.insert_text((40, 140), 'Fee 15.00', fontsize=10, color=(0.85, 0.85, 0.85))
        self.assertIn('contrast', found(statement('contrast', pale)))

    def test_contrast_on_a_dark_fill_is_kept_and_white_on_it_passes(self):
        def heading(doc, page):
            page.draw_rect(pymupdf.Rect(36, 120, 384, 140), color=None, fill=(0.1, 0.1, 0.3))
            page.insert_text((40, 134), 'Date  Description  Balance', fontsize=10, color=(1, 1, 1))
        self.assertNotIn('contrast', found(statement('white-on-dark', heading)))

    def test_white_letters_on_a_fill_their_font_box_passes(self):
        # G12: the reader judges a run's visibility by its glyphs' ink, so a
        # fill that holds the letters (126.6 to 136.3 with the margin) is
        # enough though the font's box rises to 126.2, as in jsPDF's Arabic
        # heads.
        def heading(doc, page):
            page.draw_rect(pymupdf.Rect(36, 126.4, 384, 136.5), color=None, fill=(0.07, 0.43, 0.38))
            page.insert_text((40, 134), 'Date  Description  Balance', fontsize=10, color=(1, 1, 1))
        self.assertNotIn('contrast', found(statement('white-ink-on-fill', heading)))

    def test_visibility_by_ink_is_recorded_as_exercised(self):
        def tight(doc, page):
            page.draw_rect(pymupdf.Rect(36, 126.4, 384, 136.5), color=None, fill=(0.07, 0.43, 0.38))
            page.insert_text((40, 134), 'Date  Description  Balance', fontsize=10, color=(1, 1, 1))

        def roomy(doc, page):
            page.draw_rect(pymupdf.Rect(36, 120, 384, 140), color=None, fill=(0.1, 0.1, 0.3))
            page.insert_text((40, 134), 'Date  Description  Balance', fontsize=10, color=(1, 1, 1))
        self.assertEqual(el.check_pdf(statement('ink-tight', tight))['exercised'].get('visibleByInk'), 1)
        self.assertNotIn('visibleByInk', el.check_pdf(statement('ink-roomy', roomy))['exercised'])

    def test_visibility_by_ink_is_counted_by_the_declared_font_box(self):
        # G14's R08: FreeSerif from mPDF, its heading fill holding every
        # letter's ink but not the ascent and descent its descriptor declares,
        # by which the reader judged before G12; MuPDF's own glyph box is the
        # font size and would count nothing. R07's monospaced heading passes
        # by either box.
        root = Path(__file__).resolve().parent.parent / 'bank-statement-holdout-g14' / 'frozen'
        self.assertEqual(el.check_pdf(root / 'R08-statement.pdf')['exercised'].get('visibleByInk'), 14)
        self.assertNotIn('visibleByInk', el.check_pdf(root / 'R07-statement.pdf')['exercised'])

    def test_white_letters_whose_ink_leaves_the_fill(self):
        # The capitals rise to 126.7: a fill from 128 leaves their tops white
        # on the white page.
        def heading(doc, page):
            page.draw_rect(pymupdf.Rect(36, 128, 384, 136.5), color=None, fill=(0.07, 0.43, 0.38))
            page.insert_text((40, 134), 'Date  Description  Balance', fontsize=10, color=(1, 1, 1))
        self.assertIn('contrast', found(statement('white-ink-off-fill', heading)))

    def test_rule_through_a_glyph(self):
        def struck(doc, page):
            page.draw_line((36, 77), (384, 77), color=(0.6, 0.6, 0.6), width=0.5)
        self.assertIn('ruleClearance', found(statement('rule', struck)))

    def test_a_thin_rule_is_padded_by_half_a_point_as_the_reader_pads_it(self):
        # The ink of 'Fee 15.00' ends at 180.23. A rule 0.3 wide at 180.68 is
        # 0.30 from it by half its width, clear of the 0.1 margin; the reader
        # pads every stroke by half a point at least, and so meets the ink
        # (G14: R04, TCPDF's 0.57-point rules).
        def thin(doc, page):
            page.insert_text((40, 180), 'Fee 15.00', fontsize=10)
            page.draw_line((36, 180.68), (384, 180.68), color=(0.6, 0.6, 0.6), width=0.3)
        self.assertIn('ruleClearance', found(statement('thin-rule', thin)))

    def test_a_filled_sliver_under_text_is_a_background(self):
        # MuPDF draws a heading's background in pieces; a pale one 2 points
        # wide under a letter is not a rule, as the reader judges fills.
        def sliver(doc, page):
            page.draw_rect(pymupdf.Rect(60, 70, 62, 82), color=None, fill=(0.9, 0.92, 0.91), overlay=False)
        self.assertEqual(found(statement('sliver', sliver)), {})

    def test_lines_whose_ink_meets(self):
        def crowded(doc, page):
            page.insert_text((40, 186), 'Opening balance 4,000.00', fontsize=12)
            page.insert_text((40, 193), 'Closing balance 9,000.00', fontsize=12)
        self.assertIn('lineInk', found(statement('lines', crowded)))

    def test_lines_apart_by_little_still_pass(self):
        # 10-point lines 12 points apart: no ink meets.
        def tight(doc, page):
            page.insert_text((40, 186), 'Opening balance 4,000.00', fontsize=10)
            page.insert_text((40, 198), 'Closing balance 9,000.00', fontsize=10)
        self.assertNotIn('lineInk', found(statement('tight', tight)))

    def test_a_letter_a_little_off_its_baseline_is_on_its_line(self):
        # Amiri stacks some letters, and a writer sets them a fraction of a
        # point off the baseline: the reader keeps them on the line.
        def stacked(doc, page):
            page.insert_text((40, 186), 'Withdrawal', fontsize=12)
            page.insert_text((88, 186.6), 'al', fontsize=12)
        self.assertNotIn('lineInk', found(statement('stacked', stacked)))

    def test_line_control_finds_a_planted_shift(self):
        path = statement('control')
        self.assertIsNone(el.line_ink(str(path), 0, 0.05))
        # The second line moved 12 of its 16 points up, onto the first; down,
        # it meets nothing.
        self.assertIsNotNone(el.line_ink(str(path), 0, 0.05, shift=12))
        self.assertIsNone(el.line_ink(str(path), 0, 0.05, shift=-12))

    def test_a_turned_page_is_measured_across_its_lines(self):
        result = el.check_pdf(statement('turned-control', lambda d, p: p.set_rotation(90)))
        self.assertTrue(any(result['lineControl']['found']))
        self.assertNotIn('lineControl', result['found'])

    def test_a_page_whose_lines_cannot_be_seen_is_not_measured(self):
        def gone(doc, page):
            page.clean_contents()
            xref = page.get_contents()[0]
            doc.update_stream(xref, b'q 0 0 1 1 re W n ' + doc.xref_stream(xref) + b' Q')
        self.assertIn('lineControl', found(statement('gone', gone)))

    def test_text_covered_by_a_later_fill(self):
        def covered(doc, page):
            page.draw_rect(pymupdf.Rect(150, 70, 230, 84), color=None, fill=(1, 1, 1))
        self.assertIn('visibleInk', found(statement('covered', covered)))

    def test_text_cut_by_a_clip(self):
        def clipped(doc, page):
            # A clip from y 222 up: the first line's baseline is at 220.
            page.clean_contents()
            xref = page.get_contents()[0]
            doc.update_stream(xref, b'q 36 222 348 20 re W n ' + doc.xref_stream(xref) + b' Q')
        self.assertIn('visibleInk', found(statement('clipped', clipped)))


class AsDrawn(unittest.TestCase):
    def test_a_statement_drawn_as_it_is_hides_no_ink(self):
        # FOP nests its matrices; merged and rounded (MuPDF's clean_contents),
        # every glyph edge moved a fraction of a pixel and read as hidden ink.
        root = Path(__file__).resolve().parent.parent
        path = root / 'bank-statement-holdout-g10' / 'frozen' / 'P02-statement.pdf'
        self.assertEqual(el.visible_ink(str(path), 0), 0)


class Decision(unittest.TestCase):
    def package(self, story):
        root = Path(tempfile.mkdtemp(prefix='package-', dir=TMP))
        (root / 'frozen').mkdir()
        (root / 'frozen' / 'EXPECTED.json').write_text(json.dumps({'stories': [story]}))
        return root

    def test_a_case_the_page_cannot_accept(self):
        p = self.package({'id': 'S1', 'statement': 'verified', 'bankOnly': ['b:fee'], 'cashOnly': [],
                          'review': [{'reason': 'duplicate-reference'}]})
        self.assertTrue(el.check_decision(p, 'S1')['problems'])

    def test_no_outstanding_item(self):
        p = self.package({'id': 'S1', 'statement': 'verified', 'bankOnly': [], 'cashOnly': [],
                          'review': [{'reason': 'date-gap'}]})
        self.assertTrue(el.check_decision(p, 'S1')['problems'])

    def test_a_story_that_can_be_decided(self):
        p = self.package({'id': 'S1', 'statement': 'verified', 'bankOnly': [], 'cashOnly': ['c:dit'],
                          'review': [{'reason': 'amount-date-suggestion'}]})
        self.assertEqual(el.check_decision(p, 'S1')['problems'], [])

    def test_the_page_rule_is_read_from_the_product(self):
        self.assertEqual(el.acceptable_in_source(), el.ACCEPTABLE)


HEADERS = ['Date', 'Value Date', 'Description', 'Reference', 'Withdrawal', 'Deposit', 'Balance']
STARTS = [40, 100, 160, 290]    # columns read from their left edge
ENDS = [430, 500, 570]          # amount columns, right-aligned


def put(page, y, cells, end_shift=0, start_shift=0):
    for k, text in enumerate(cells):
        if not text:
            continue
        if k < 4:
            x = STARTS[k] + (start_shift if k == 0 and y > 80 else 0)
        else:
            x = ENDS[k - 4] - pymupdf.get_text_length(text, fontname='helv', fontsize=8) - (end_shift if y > 80 else 0)
        page.insert_text((x, y), text, fontsize=8, fontname='helv')


def whole(name, pages, headers=HEADERS, **shift):
    """A statement whose pages are lists of table rows, each seven cells."""
    doc = pymupdf.open()
    for n, rows in enumerate(pages, 1):
        page = doc.new_page(width=600, height=400)
        page.insert_text((40, 40), 'Harbor Line Bank', fontsize=12)
        page.insert_text((40, 58), 'Account: SA00 1000 · Currency: SAR · Period: 2026-04-01 — 2026-04-30', fontsize=8)
        put(page, 80, headers)
        for i, row in enumerate(rows):
            put(page, 96 + 14 * i, row, **shift)
        page.insert_text((270, 370), f'Page {n} of {len(pages)}', fontsize=8)
    path = TMP / f'{name}.pdf'
    doc.save(path)
    return pymupdf.open(path)


ONE = [['Opening balance', '', '', '', '', '', '1,000.00'],
       ['2026-04-02', '2026-04-02', 'Card settlement', 'CS-01', '', '250.00', '1,250.00'],
       ['2026-04-03', '2026-04-03', 'Rent', 'RT-02', '400.00', '', '850.00'],
       ['Closing balance', '', '', '', '', '', '850.00'],
       ['Total withdrawals / deposits', '', '', '', '400.00', '250.00', '']]


def two(continuation):
    return [[['Opening balance', '', '', '', '', '', '1,000.00'],
             ['2026-04-02', '2026-04-02', 'Card settlement for', 'CS-01', '', '250.00', '1,250.00'],
             ['Balance carried forward', '', '', '', '', '', '1,250.00']],
            [['Balance brought forward', '', '', '', '', '', '1,250.00'],
             ['', '', continuation, '', '', '', ''],
             ['Closing balance', '', '', '', '', '', '1,250.00'],
             ['Total withdrawals / deposits', '', '', '', '0.00', '250.00', '']]]


def stop(doc):
    r = columns.check_statement(doc)
    return r and (r['code'], r['page'], r['line'])


def exercised(doc):
    used = Counter()
    return columns.check_statement(doc, used), {k: v for k, v in used.items() if v}


def runs(name):
    """A statement whose Balance heading starts its column, an overdrawn
    balance printed with its DR 0.75 em after the amount, and a date printed
    as touching runs in two fonts, as a writer that changes font for the
    separators does."""
    doc = pymupdf.open()
    page = doc.new_page(width=600, height=400)
    page.insert_text((40, 40), 'Harbor Line Bank', fontsize=12)
    page.insert_text((40, 58), 'Account: SA00 1000 · Currency: SAR · Period: 2026-04-01 — 2026-04-30', fontsize=8)
    put(page, 80, HEADERS[:6] + [''])
    page.insert_text((520, 80), 'Balance', fontsize=8, fontname='helv')

    def balance(y, text, debit=False):
        page.insert_text((560 - pymupdf.get_text_length(text, fontname='helv', fontsize=8), y), text, fontsize=8,
                         fontname='helv')
        if debit:
            page.insert_text((566, y), 'DR', fontsize=8, fontname='helv')
    put(page, 96, ['Opening balance'])
    balance(96, '100.00')
    x = 40
    for text, font in (('2026', 'helv'), ('-', 'cour'), ('04', 'helv'), ('-', 'cour'), ('03', 'helv')):
        page.insert_text((x, 110), text, fontsize=8, fontname=font)
        x += pymupdf.get_text_length(text, fontname=font, fontsize=8)
    put(page, 110, ['', '2026-04-03', 'Rent', 'RT-02', '400.00', ''])
    balance(110, '300.00', debit=True)
    put(page, 124, ['Closing balance'])
    balance(124, '300.00', debit=True)
    put(page, 138, ['Total withdrawals / deposits', '', '', '', '400.00', '0.00'])
    page.insert_text((270, 370), 'Page 1 of 1', fontsize=8)
    path = TMP / f'{name}.pdf'
    doc.save(path)
    return pymupdf.open(path)


def code(doc):
    return (stop(doc) or (None,))[0]


class Columns(unittest.TestCase):
    """The reader's reading by columns (columns.py), on planted statements
    and on sealed ones whose reading the reader has recorded."""

    def test_a_whole_statement_reads(self):
        self.assertIsNone(stop(whole('columns-clean', [ONE])))

    def test_a_value_starts_within_the_cell_padding_of_its_column(self):
        # 2.5 points before the header's left edge is inside; 2.6 is not.
        self.assertIsNone(stop(whole('columns-pad-in', [ONE], start_shift=-2.4)))
        self.assertEqual(code(whole('columns-pad-out', [ONE], start_shift=-2.6)), 'COLUMN')

    def test_amounts_ending_a_slot_before_their_header(self):
        # As Q03 of G12: a DR slot of 14.4 points after every amount.
        self.assertEqual(code(whole('columns-slot', [ONE], end_shift=14.4)), 'COLUMN')
        self.assertIsNone(stop(whole('columns-slot-small', [ONE], end_shift=2.4)))

    def test_a_continuation_in_its_column_and_across_columns(self):
        self.assertIsNone(stop(whole('columns-continued', two('(continued) at the till'))))
        # Run on across the reference column, a word lies across its edge: the
        # reader stops there, at "for" (checked with the reader). Q06, whose
        # words fall wholly inside the reference column, is read as a
        # movement without its date instead (below).
        self.assertEqual(stop(whole('columns-across', two('(continued) at the till of the branch for the whole of April'))),
                         ('COLUMN', 2, 5))

    def test_a_header_not_declared(self):
        self.assertEqual(code(whole('columns-header', [ONE], headers=HEADERS[:3] + ['Ref.'] + HEADERS[4:])), 'HEADER')

    def test_a_description_line_without_its_movement(self):
        stray = [ONE[0], ['', '', 'Card settlement', '', '', '', '']] + ONE[1:]
        self.assertEqual(stop(whole('columns-stray', [stray])), ('LINE', 1, 5))

    def test_sealed_statements_read_as_the_reader_read_them(self):
        # Completed by the reader: right-to-left DR balances as one item (Q10)
        # and as two the reader joins (H04), dates in touching runs (Q02),
        # lam-alef ligatures (K05, N04).
        # Refused by it, with its page and line (run records; K04 and P09 with
        # the earlier guards off, G13).
        root = Path(__file__).resolve().parent.parent
        cases = {('g12', 'Q10'): None, ('g6', 'H04'): None, ('g12', 'Q02'): None, ('g8', 'K05'): None,
                 ('g9', 'N04'): None,
                 ('g12', 'Q03'): ('COLUMN', 1, 5), ('g12', 'Q06'): ('FIELD', 6, 6),
                 ('g8', 'K01'): ('COLUMN', 1, 5), ('g8', 'K04'): ('COLUMN', 1, 6), ('g10', 'P09'): ('COLUMN', 1, 7)}
        for (package, sid), want in cases.items():
            doc = pymupdf.open(root / f'bank-statement-holdout-{package}' / 'frozen' / f'{sid}-statement.pdf')
            self.assertEqual(stop(doc), want, sid)

    def test_the_rules_a_statement_needs_are_counted(self):
        # The labels Opening balance and Closing balance cross the Date
        # column's edge and are placed by their words.
        self.assertEqual(exercised(whole('columns-counted', [ONE])), (None, {'wordParts': 2}))
        # Ending 2.4 points before their header, the two balances of the
        # movements no longer start inside it and are placed by its end.
        self.assertEqual(exercised(whole('columns-end', [ONE], end_shift=2.4)),
                         (None, {'wordParts': 2, 'endAligned': 2}))
        self.assertEqual(exercised(runs('columns-runs')),
                         (None, {'wordParts': 2, 'drAfterAmount': 2, 'dateRuns': 1}))
        self.assertEqual(exercised(whole('columns-continued-counted', two('(continued) at the till'))),
                         (None, {'wordParts': 4, 'continuation': 1}))

    def test_what_it_copies_is_still_the_readers(self):
        self.assertEqual(columns.drift(), [])


if __name__ == '__main__':
    unittest.main()
