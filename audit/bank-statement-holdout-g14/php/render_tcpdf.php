<?php
/*
 * The G14 statements TCPDF writes, as a PHP application draws its own
 * statement with TCPDF: a letterhead of Cell lines, then the table row by
 * row, each cell a MultiCell as tall as the row's tallest cell, and the page
 * number in the Footer() TCPDF calls on each page. The 'html' statements are
 * one HTML table per page given to writeHTML, TCPDF's own HTML engine.
 * Arabic is shaped and ordered by TCPDF itself in its right-to-left mode.
 *
 *   php render_tcpdf.php <vendor dir> <statements.json>
 *
 * statements.json comes from render_tcpdf.py: each statement's file, paper,
 * font, style and printed pages, every text in reading order and every
 * number as printed. A page that TCPDF breaks before its last row is an
 * error here, as is a description TCPDF breaks inside a word.
 */
require $argv[1] . '/autoload.php';

const STAMP = 1801440000; // 2027-01-31T12:00:00Z, the files' fixed dates

class Statement extends TCPDF
{
    public $footers = [];
    public $footerFont = [];
    public $rtl = false;

    public function __construct($story, $orientation, $format)
    {
        parent::__construct($orientation, 'pt', $format, true, 'UTF-8', false);
        // TCPDF writes an invisible 'Powered by TCPDF' line with a link on
        // the last page unless a subclass turns it off (see README).
        $this->tcpdflink = false;
        // TCPDF draws each file's identifier from the clock; the statement's
        // number fixes it, so the same input gives the same bytes.
        $this->file_id = md5('bank-statement-holdout-g14 ' . $story);
        $this->setDocCreationTimestamp(STAMP);
        $this->setDocModificationTimestamp(STAMP);
    }

    public function Header()
    {
    }

    public function Footer()
    {
        $this->SetY(-28);
        $this->SetFont($this->footerFont[0], '', $this->footerFont[1]);
        $this->SetTextColor(60, 60, 60);
        $text = $this->footers[$this->getPage() - 1];
        if ($text === null) {
            $text = 'Page ' . $this->getAliasNumPage() . ' of ' . $this->getAliasNbPages();
        }
        $this->Cell(0, 12, $text, 0, 0, 'C');
    }
}

function font_of($pdf, $s, $work)
{
    $f = $s['font'];
    if ($f['kind'] === 'file') {
        $name = TCPDF_FONTS::addTTFfont($f['regular'], 'TrueTypeUnicode', '', 32, $work . '/');
        $bold = TCPDF_FONTS::addTTFfont($f['bold'], 'TrueTypeUnicode', '', 32, $work . '/');
        $pdf->AddFont($name, '', $work . '/' . $name . '.php');
        $pdf->AddFont($name, 'B', $work . '/' . $bold . '.php');
        return $name;
    }
    return $f['name'];
}

function cell_row($pdf, $s, $widths, $cells, $aligns, $height, $border, $fill)
{
    $lines = 1;
    $paddings = $pdf->getCellPaddings();
    foreach ($cells as $i => $text) {
        // TCPDF breaks a word wider than its cell inside the word; that is
        // an error in this writer, not a statement.
        foreach (explode(' ', $text) as $word) {
            if ($pdf->GetStringWidth($word) > $widths[$i] - $paddings['L'] - $paddings['R']) {
                fwrite(STDERR, "{$s['id']}: \"$word\" is wider than its cell\n");
                exit(1);
            }
        }
        $lines = max($lines, $pdf->getNumLines($text, $widths[$i], false, true, '', $border));
    }
    $h = $lines * $height;
    foreach ($cells as $i => $text) {
        $pdf->MultiCell($widths[$i], $h, $text, $border, $aligns[$i], $fill, 0, '', '', true, 0, false, true, $h, 'T');
    }
    $pdf->Ln($h);
    return $lines;
}

function cell_page($pdf, $s, $page, $font)
{
    $st = $s['style'];
    $widths = $s['widths'];
    $size = $s['size'];
    $line = $s['lineHeight'];
    $border = ['grid' => 1, 'rows' => 'B', 'none' => 0][$st['rules']];
    $pdf->AddPage();
    $pdf->SetFont($font, 'B', 13);
    $pdf->Cell(0, 18, $s['bank'], 0, 1, $s['layout'] === 'ar' ? 'R' : 'L');
    $pdf->SetFont($font, '', 10);
    $pdf->Cell(0, 14, $s['documentTitle'], 0, 1, $s['layout'] === 'ar' ? 'R' : 'L');
    $pdf->SetFont($font, '', 8);
    $pdf->Cell(0, 12, $s['accountLine'], 0, 1, $s['layout'] === 'ar' ? 'R' : 'L');
    $pdf->Ln(6);
    // The heading: left-aligned in an English table, as TCPDF aligns a
    // Cell by default; filled, filled in rows as tall as the type, or
    // ruled.
    $pdf->SetFont($font, 'B', $size);
    if ($st['heading'] === 'filled' || $st['heading'] === 'filled-tight') {
        $pdf->SetFillColor(...$s['headingFill']);
        $pdf->SetTextColor(255, 255, 255);
        $h = $st['heading'] === 'filled-tight' ? $s['tightHeight'] : $line + 4;
        if ($st['heading'] === 'filled-tight') {
            // Rows as tall as the type: TCPDF keeps a cell at least its
            // font size times this ratio, 1.25 by default.
            $pdf->setCellHeightRatio(1.0);
        }
        // Filled without a border: TCPDF fills and strokes a bordered cell
        // in one operation (see README).
        foreach ($s['headers'] as $i => $text) {
            $pdf->Cell($widths[$i], $h, $text, 0, 0, '', true);
        }
        $pdf->Ln($h);
        $pdf->setCellHeightRatio(K_CELL_HEIGHT_RATIO);
    } else {
        foreach ($s['headers'] as $i => $text) {
            $pdf->Cell($widths[$i], $line + 4, $text, 'B', 0, '');
        }
        $pdf->Ln($line + 4);
    }
    $pdf->SetTextColor(0, 0, 0);
    $pdf->SetFont($font, '', $size);
    $amount = $s['layout'] === 'ar' ? 'L' : 'R';
    $text = $s['layout'] === 'ar' ? 'R' : 'L';
    foreach ($page['rows'] as [$kind, $cells]) {
        if ($kind === 'label') {
            $row = [$cells[0], '', '', '', '', '', $cells[1]];
        } elseif ($kind === 'totals') {
            $row = [$cells[0], '', '', '', $cells[1], $cells[2], ''];
        } elseif ($kind === 'continuation') {
            $row = ['', '', $cells[0], '', '', '', ''];
        } else {
            $row = $cells;
        }
        if ($kind === 'label' || $kind === 'totals') {
            // A control line's label runs across the first four columns.
            $pdf->SetFont($font, 'B', $size);
            $w = $widths[0] + $widths[1] + $widths[2] + $widths[3];
            $pdf->Cell($w, $line + 2, $row[0], $border, 0, $text);
            foreach ([4, 5, 6] as $i) {
                $pdf->Cell($widths[$i], $line + 2, $row[$i], $border, 0, $amount);
            }
            $pdf->Ln($line + 2);
            $pdf->SetFont($font, '', $size);
            continue;
        }
        cell_row($pdf, $s, $widths, $row, [$text, $text, $text, $text, $amount, $amount, $amount], $line, $border,
                 false);
    }
}

function html_page($pdf, $s, $page, $font)
{
    $pdf->AddPage();
    $pdf->SetFont($font, '', $s['size']);
    $w = array_map(fn($x) => round(100 * $x / array_sum($s['widths']), 2) . '%', $s['widths']);
    $e = fn($t) => htmlspecialchars($t, ENT_QUOTES, 'UTF-8');
    $html = '<h2>' . $e($s['bank']) . '</h2><p>' . $e($s['documentTitle']) . '<br/><small>' . $e($s['accountLine'])
        . '</small></p><table cellpadding="3"><thead><tr bgcolor="#e4e4e4">';
    foreach ($s['headers'] as $i => $text) {
        $html .= '<th width="' . $w[$i] . '"><b>' . $e($text) . '</b></th>';
    }
    $html .= '</tr></thead><tbody>';
    // TCPDF lays out each row by its own cells' widths, so every cell
    // carries one; a label's cell spans the first four columns.
    $span = fn($a, $b) => round(100 * array_sum(array_slice($s['widths'], $a, $b - $a)) / array_sum($s['widths']), 2) . '%';
    $rule = ' style="border-bottom: 0.5pt solid #888888"';
    foreach ($page['rows'] as [$kind, $cells]) {
        $html .= '<tr>';
        if ($kind === 'label' || $kind === 'totals') {
            $amounts = $kind === 'label' ? ['', '', $cells[1]] : [$cells[1], $cells[2], ''];
            $html .= '<td colspan="4" width="' . $span(0, 4) . '"' . $rule . '><b>' . $e($cells[0]) . '</b></td>';
            foreach ($amounts as $k => $text) {
                $html .= '<td width="' . $w[4 + $k] . '" align="right"' . $rule . '>' . $e($text) . '</td>';
            }
        } else {
            $row = $kind === 'continuation' ? ['', '', $cells[0], '', '', '', ''] : $cells;
            foreach ($row as $i => $text) {
                $html .= '<td width="' . $w[$i] . '"' . ($i >= 4 ? ' align="right"' : '') . $rule . '>' . $e($text)
                    . '</td>';
            }
        }
        $html .= '</tr>';
    }
    $html .= '</tbody></table>';
    $pdf->writeHTML($html, true, false, true, false, '');
}

$job = json_decode(file_get_contents($argv[2]), true);
foreach ($job['statements'] as $s) {
    [$orientation, $format] = ['A4' => ['P', 'A4'], 'Letter' => ['P', 'LETTER']][$s['paper']];
    $pdf = new Statement($s['id'], $orientation, $format);
    $pdf->SetCreator('TCPDF');
    $pdf->SetTitle($s['documentTitle']);
    $pdf->setPrintHeader(false);
    $pdf->SetMargins(36, 36, 36);
    $pdf->SetAutoPageBreak(true, 40);
    $pdf->setCellPaddings(2.5, 1, 2.5, 1);
    $font = font_of($pdf, $s, $job['work']);
    if ($s['layout'] === 'ar') {
        $pdf->setRTL(true);
    }
    $pdf->footerFont = [$font, 8];
    foreach ($s['pages'] as $n => $page) {
        $pdf->footers[$n] = $page['footer'];
        $before = $pdf->getNumPages();
        $s['style']['api'] === 'html' ? html_page($pdf, $s, $page, $font) : cell_page($pdf, $s, $page, $font);
        if ($pdf->getNumPages() !== $before + 1) {
            fwrite(STDERR, "{$s['id']}: page " . ($n + 1) . " ran over\n");
            exit(1);
        }
    }
    $pdf->Output($s['out'], 'F');
}
