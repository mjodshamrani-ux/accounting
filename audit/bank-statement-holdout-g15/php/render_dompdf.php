<?php
/*
 * The G15 Dompdf statements, written as a PHP application writes its
 * statement with Dompdf: an HTML page per statement page, its letterhead,
 * one table and the footer, the page broken after it, styled by CSS, the
 * fonts given by @font-face from local files.
 *
 * The files' dates are fixed: Dompdf's Cpdf and its adapter read the clock
 * by date() in their own namespaces, so those functions are given the fixed
 * time here; the file identifier, which Cpdf draws from the clock and
 * mt_rand(), is set to a hash of the statement's id; and the binary comment
 * on the header's second line comes from rand(), seeded.
 *
 *   php render_dompdf.php <vendor dir> <statements.json>
 */
namespace Dompdf {
    const STAMP = 1801440000; // 2027-01-31T12:00:00Z
    function date($format, $timestamp = null)
    {
        return \date($format, $timestamp ?? STAMP);
    }
}

namespace Dompdf\Adapter {
    function date($format, $timestamp = null)
    {
        return \date($format, $timestamp ?? \Dompdf\STAMP);
    }
}

namespace {
    date_default_timezone_set('UTC');
    require $argv[1] . '/autoload.php';

    use Dompdf\Dompdf;
    use Dompdf\Options;

    function e($text)
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    function css($s)
    {
        $style = $s['style'];
        $size = $s['size'];
        $paper = $s['paper'] === 'A4-landscape' ? 'A4 landscape' : ($s['paper'] === 'Letter' ? 'letter portrait' : 'A4 portrait');
        $rule = '0.5pt solid #777777';
        $cell = $style['rules'] === 'grid' ? "border: $rule;" : ($style['rules'] === 'rows' ? "border-bottom: $rule;" : '');
        $head = match ($style['heading']) {
            'filled' => "background: {$s['headingFill']}; color: #ffffff;",
            'grey' => 'background: #e4e4e4;',
            default => "border-bottom: $rule;",
        };
        $stripes = $style['rules'] === 'stripes' ? 'tr.odd td { background: #eef3f7; }' : '';
        // Headings left-aligned over right-aligned amounts, where the style says so.
        $headings = ($style['headings'] ?? '') === 'left' ? 'th.amount { text-align: left; }' : '';
        $line = round($size * 1.45, 2);
        return <<<CSS
@page { size: $paper; margin: 36pt; }
@font-face { font-family: '{$s['family']}'; font-weight: normal; src: url('file://{$s['regular']}') format('truetype'); }
@font-face { font-family: '{$s['family']}'; font-weight: bold; src: url('file://{$s['bold']}') format('truetype'); }
body { font-family: '{$s['family']}'; font-size: {$size}pt; line-height: {$line}pt; color: #000000; margin: 0; }
.page { page-break-after: always; }
.page.last { page-break-after: auto; }
.bank { font-size: {$s['bankSize']}pt; line-height: {$s['bankLine']}pt; font-weight: bold; }
.title { font-size: {$s['titleSize']}pt; line-height: {$s['titleLine']}pt; }
.account { margin: 4pt 0 10pt 0; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 3pt 3pt; vertical-align: top; text-align: left; $cell }
th { font-weight: bold; $head }
.amount { text-align: right; }
tr.control td { font-weight: bold; }
$stripes
$headings
.footer { margin-top: 14pt; text-align: center; }
CSS;
    }

    function row($kind, $cells, $odd)
    {
        $class = ($kind === 'movement' || $kind === 'continuation' ? '' : 'control') . ($odd ? ' odd' : '');
        $out = "<tr class=\"$class\">";
        if ($kind === 'movement') {
            foreach ($cells as $i => $text) {
                $out .= '<td' . ($i >= 4 ? ' class="amount"' : '') . '>' . e($text) . '</td>';
            }
        } elseif ($kind === 'label') {
            $out .= '<td colspan="4">' . e($cells[0]) . '</td><td></td><td></td><td class="amount">' . e($cells[1]) . '</td>';
        } elseif ($kind === 'totals') {
            $out .= '<td colspan="4">' . e($cells[0]) . '</td><td class="amount">' . e($cells[1])
                . '</td><td class="amount">' . e($cells[2]) . '</td><td></td>';
        } else {
            $out .= '<td></td><td></td><td>' . e($cells[0]) . '</td><td></td><td></td><td></td><td></td>';
        }
        return $out . '</tr>';
    }

    function html($s)
    {
        $s['bankSize'] = $s['size'] + 4;
        $s['bankLine'] = round(($s['size'] + 4) * 1.3, 2);
        $s['titleSize'] = $s['size'] + 2;
        $s['titleLine'] = round(($s['size'] + 2) * 1.3, 2);
        $heads = '';
        foreach ($s['headers'] as $i => $h) {
            $heads .= '<th style="width: ' . $s['widths'][$i] . '%"' . ($i >= 4 ? ' class="amount"' : '') . '>' . e($h) . '</th>';
        }
        $body = '';
        $last = count($s['pages']) - 1;
        foreach ($s['pages'] as $n => $page) {
            $rows = '';
            foreach ($page['rows'] as $k => [$kind, $cells]) {
                $rows .= row($kind, $cells, $k % 2 === 1);
            }
            $body .= '<div class="page' . ($n === $last ? ' last' : '') . '">'
                . '<div class="bank">' . e($s['bank']) . '</div><div class="title">' . e($s['documentTitle']) . '</div>'
                . '<div class="account">' . e($s['accountLine']) . '</div>'
                . "<table><thead><tr>$heads</tr></thead><tbody>$rows</tbody></table>"
                . '<div class="footer">' . e($page['footer']) . '</div></div>';
        }
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>' . css($s) . '</style></head><body>'
            . $body . '</body></html>';
    }

    $job = json_decode(file_get_contents($argv[2]), true);
    foreach ($job['statements'] as $s) {
        $options = new Options();
        $options->setChroot([$job['fonts'], $job['work']]);
        $options->setFontDir($job['work'] . '/fonts');
        $options->setFontCache($job['work'] . '/fonts');
        $options->setTempDir($job['work']);
        $options->setIsRemoteEnabled(false);
        $options->setDefaultFont($s['family']);
        $dompdf = new Dompdf($options);
        $dompdf->loadHtml(html($s), 'UTF-8');
        $dompdf->setPaper($s['paper'] === 'Letter' ? 'letter' : 'A4', $s['paper'] === 'A4-landscape' ? 'landscape' : 'portrait');
        $dompdf->render();
        $dompdf->getCanvas()->get_cpdf()->fileIdentifier = md5('tarasuf-g15-' . $s['id']);
        mt_srand(15);
        $bytes = $dompdf->output(['compress' => 1]);
        if ($dompdf->getCanvas()->get_page_count() !== count($s['pages'])) {
            fwrite(STDERR, "{$s['id']}: {$dompdf->getCanvas()->get_page_count()} pages drawn for " . count($s['pages']) . "\n");
            exit(1);
        }
        file_put_contents($s['out'], $bytes);
    }
}
