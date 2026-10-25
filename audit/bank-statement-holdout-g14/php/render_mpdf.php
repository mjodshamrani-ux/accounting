<?php
/*
 * The G14 statements mPDF writes, as a PHP application writes its statement
 * with mPDF: each printed page one HTML table under a letterhead, styled by
 * CSS, the page number in an HTML footer, mPDF's own {PAGENO} and {nbpg}
 * where the statement says so. Arabic is shaped by mPDF's own OpenType
 * layout and ordered by its bidi code.
 *
 *   php render_mpdf.php <vendor dir> <statements.json>
 *
 * statements.json comes from render_mpdf.py. A statement that does not come
 * out with one PDF page for each printed page is an error here.
 */

namespace Mpdf\Writer {
    // mPDF dates a file and draws its identifier from the clock. The same
    // fixed time is given to the writer that stamps them, so the same input
    // gives the same bytes; nothing in mPDF itself is changed.
    function time()
    {
        return 1801440000; // 2027-01-31T12:00:00Z
    }
}

namespace {
    require $argv[1] . '/autoload.php';

    function e($t)
    {
        return htmlspecialchars($t, ENT_QUOTES, 'UTF-8');
    }

    function page_html($s, $page)
    {
        $st = $s['style'];
        $rtl = $s['layout'] === 'ar';
        $html = '<div class="bank">' . e($s['bank']) . '</div><div class="title">' . e($s['documentTitle'])
            . '</div><div class="account">' . e($s['accountLine']) . '</div>';
        $html .= '<table class="t"' . ($rtl ? ' dir="rtl"' : '') . '><thead><tr>';
        foreach ($s['headers'] as $i => $text) {
            $html .= '<th style="width: ' . $s['widths'][$i] . '%">' . e($text) . '</th>';
        }
        $html .= '</tr></thead><tbody>';
        foreach ($page['rows'] as $n => [$kind, $cells]) {
            $class = $st['rules'] === 'stripes' && $n % 2 ? ' class="odd"' : '';
            $html .= '<tr' . $class . '>';
            if ($kind === 'label') {
                $html .= '<td colspan="4" class="label">' . e($cells[0]) . '</td><td></td><td></td><td class="n">'
                    . e($cells[1]) . '</td>';
            } elseif ($kind === 'totals') {
                $html .= '<td colspan="4" class="label">' . e($cells[0]) . '</td><td class="n">' . e($cells[1])
                    . '</td><td class="n">' . e($cells[2]) . '</td><td></td>';
            } elseif ($kind === 'continuation') {
                $html .= '<td></td><td></td><td>' . e($cells[0]) . '</td><td></td><td></td><td></td><td></td>';
            } else {
                foreach ($cells as $i => $text) {
                    $html .= '<td' . ($i >= 4 ? ' class="n"' : '') . '>' . e($text) . '</td>';
                }
            }
            $html .= '</tr>';
        }
        return $html . '</tbody></table>';
    }

    function css($s)
    {
        $st = $s['style'];
        $rtl = $s['layout'] === 'ar';
        $start = $rtl ? 'right' : 'left';
        $end = $rtl ? 'left' : 'right';
        $rule = ['grid' => 'border: 0.5pt solid #777;', 'rows' => 'border-bottom: 0.5pt solid #999;',
            'stripes' => '', 'none' => ''][$st['rules']];
        $heading = ['filled' => 'background-color: ' . $s['headingFill'] . '; color: #ffffff;',
            'filled-tight' => 'background-color: ' . $s['headingFill'] . '; color: #ffffff; line-height: 1;'
                . ' padding-top: 0.5pt; padding-bottom: 1pt;',
            'grey' => 'background-color: #e6e6e6;', 'rule' => 'border-bottom: 0.8pt solid #333;'][$st['heading']];
        return 'body { font-family: ' . $s['bodyFont'] . '; font-size: ' . $s['size'] . 'pt; }
            .bank { font-size: 13pt; font-weight: bold; text-align: ' . $start . '; }
            .title { font-size: 10pt; text-align: ' . $start . '; }
            .account { font-size: 8pt; text-align: ' . $start . '; margin-bottom: 8pt; }
            table.t { width: 100%; border-collapse: collapse; }
            table.t th { text-align: ' . $start . '; font-weight: bold; padding: 2pt 3pt; ' . $heading . ' }
            table.t td { ' . $rule . ' padding: 1.5pt 3pt; vertical-align: top; text-align: ' . $start . '; }
            table.t td.n { text-align: ' . $end . '; white-space: nowrap; }
            table.t td.label { font-weight: bold; }
            tr.odd td { background-color: #eef3f8; }
            .footer { text-align: center; font-size: 8pt; color: #3c3c3c; }';
    }

    $job = json_decode(file_get_contents($argv[2]), true);
    foreach ($job['statements'] as $s) {
        $config = [
            'tempDir' => $job['work'] . '/mpdf',
            'format' => $s['paper'] === 'A4-landscape' ? 'A4-L' : 'A4',
            'margin_left' => 13, 'margin_right' => 13, 'margin_top' => 13, 'margin_bottom' => 16,
            'margin_footer' => 7,
        ];
        $mpdf = new \Mpdf\Mpdf($config);
        $mpdf->SetCreator('mPDF');
        $mpdf->SetTitle($s['documentTitle']);
        if ($s['layout'] === 'ar') {
            $mpdf->SetDirectionality('rtl');
        }
        $mpdf->WriteHTML(css($s), \Mpdf\HTMLParserMode::HEADER_CSS);
        foreach ($s['pages'] as $n => $page) {
            // mPDF writes a page's footer as it closes the page, so each
            // page's own footer is set once the page is open.
            if ($n > 0) {
                $mpdf->AddPage();
            }
            $footer = $page['footer'] ?? 'Page {PAGENO} of {nbpg}';
            $mpdf->SetHTMLFooter('<div class="footer">' . e($footer) . '</div>');
            $mpdf->WriteHTML(page_html($s, $page), \Mpdf\HTMLParserMode::HTML_BODY);
            if (count($mpdf->pages) !== $n + 1) {
                fwrite(STDERR, "{$s['id']}: page " . ($n + 1) . " ran over\n");
                exit(1);
            }
        }
        $mpdf->Output($s['out'], \Mpdf\Output\Destination::FILE);
    }
}
