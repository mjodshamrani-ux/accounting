<?php
/*
 * The G20 typed XLSX cashbook, written by OpenSpout as a PHP application
 * streams an export: the CSV's headers on the first row, then one entry per
 * row, the date as an Excel date shown yyyy-mm-dd, each amount as a number in
 * riyals shown #,##0.00, the other amount cell empty. OpenSpout writes its
 * strings inline and stamps docProps/core.xml with the clock's time; it
 * offers no setting for that time.
 *
 *   php cashbook.php <vendor dir> <cashbooks.json>
 */
require $argv[1] . '/autoload.php';

use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Options;
use OpenSpout\Writer\XLSX\Properties;
use OpenSpout\Writer\XLSX\Writer;

$job = json_decode(file_get_contents($argv[2]), true);
foreach ($job['cashbooks'] as $book) {
    if ($book['kind'] !== 'typed') {
        continue;
    }
    $options = new Options();
    $options->setProperties(new Properties(title: 'Cashbook'));
    $writer = new Writer($options);
    $writer->openToFile($book['out']);
    $writer->getCurrentSheet()->setName('Cashbook');
    $dates = (new Style())->setFormat('yyyy-mm-dd');
    $money = (new Style())->setFormat('#,##0.00');
    $writer->addRow(Row::fromValues($book['headers']));
    foreach ($book['entries'] as $e) {
        $cells = [
            new Cell\DateTimeCell(new DateTimeImmutable($e['date'] . 'T00:00:00Z'), $dates),
            Cell::fromValue($e['voucher']),
            Cell::fromValue($e['description']),
            Cell::fromValue($e['reference']),
        ];
        foreach ([$e['receipt'], $e['payment']] as $minor) {
            $cells[] = $minor ? new Cell\NumericCell($minor / 100, $money) : Cell::fromValue(null);
        }
        $writer->addRow(new Row($cells));
    }
    $writer->close();
}
