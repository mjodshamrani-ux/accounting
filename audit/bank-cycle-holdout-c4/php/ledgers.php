<?php
/*
 * The C4 company ledgers written by OpenSpout, as a PHP application streams
 * a bank ledger export.
 *
 *   php ledgers.php <vendor dir> <ledgers.json>
 *
 * Writes every ledger whose writer is 'openspout', one sheet named as the
 * spec says, row by row: a text cell as a string (OpenSpout writes strings
 * inline), {"n": text} as a number, {"d": iso} as a date, each styled with
 * its "fmt" when it has one, and an empty cell as an empty cell. OpenSpout
 * stamps docProps/core.xml with the clock's time and offers no setting for
 * it, so a re-render differs there and nowhere else.
 */
require $argv[1] . '/autoload.php';

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Options;
use OpenSpout\Writer\XLSX\Properties;
use OpenSpout\Writer\XLSX\Writer;

$job = json_decode(file_get_contents($argv[2]), true);
foreach ($job['ledgers'] as $ledger) {
    if ($ledger['writer'] !== 'openspout') {
        continue;
    }
    $options = new Options();
    $options->setProperties(new Properties(title: 'Bank ledger', creator: 'C4 ledger export'));
    $writer = new Writer($options);
    $writer->openToFile($ledger['out']);
    $writer->getCurrentSheet()->setName($ledger['sheet']);
    $styles = [];
    $style = function (?string $code) use (&$styles) {
        if ($code === null) {
            return null;
        }
        return $styles[$code] ??= (new Style())->setFormat($code);
    };
    foreach ($ledger['rows'] as $row) {
        $cells = [];
        foreach ($row as $cell) {
            if (is_array($cell) && array_key_exists('n', $cell)) {
                $n = $cell['n'];
                $value = preg_match('/^-?\d+$/', $n) ? intval($n, 10) : floatval($n);
                $cells[] = new Cell\NumericCell($value, $style($cell['fmt'] ?? null));
            } elseif (is_array($cell) && array_key_exists('d', $cell)) {
                $cells[] = new Cell\DateTimeCell(new DateTimeImmutable($cell['d'] . 'T00:00:00Z'),
                                                 $style($cell['fmt'] ?? null));
            } elseif ($cell === '') {
                $cells[] = Cell::fromValue(null);
            } else {
                $cells[] = Cell::fromValue($cell);
            }
        }
        $writer->addRow(new Row($cells));
    }
    $writer->close();
}
