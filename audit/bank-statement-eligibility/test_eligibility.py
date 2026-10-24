"""The eligibility checker against planted faults: a clean page passes every
check, and each page built with one refusal the reader declares is found by
the check for it.

  PYTHONPATH=<pymupdf 2.0> python3 -B -m unittest discover -s audit/bank-statement-eligibility -p test_eligibility.py -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
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
    return el.check_pdf(path)['found']


class Planted(unittest.TestCase):
    def test_clean_page_passes_every_check(self):
        result = el.check_pdf(statement('clean'))
        self.assertEqual(result['found'], {})
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

    def test_rule_through_a_glyph(self):
        def struck(doc, page):
            page.draw_line((36, 77), (384, 77), color=(0.6, 0.6, 0.6), width=0.5)
        self.assertIn('ruleClearance', found(statement('rule', struck)))

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


if __name__ == '__main__':
    unittest.main()
