<?php
/*
 * The G14 XLSX cashbooks, written by PhpSpreadsheet as a PHP application
 * exports its cashbook: the CSV's headers on the first row, then one entry
 * per row. A 'typed' cashbook holds its dates as Excel dates shown
 * yyyy-mm-dd and its amounts as numbers shown #,##0.00, an empty amount
 * left empty; a 'text' cashbook holds every cell as the CSV's text.
 *
 *   php cashbooks.php <vendor dir> <cashbooks.json>
 */
require $argv[1] . '/autoload.php';

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Shared\Date;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;

const STAMP = 1801440000; // 2027-01-31T12:00:00Z, the files' fixed dates

$job = json_decode(file_get_contents($argv[2]), true);
foreach ($job['cashbooks'] as $book) {
    $spreadsheet = new Spreadsheet();
    $spreadsheet->getProperties()->setCreator('PhpSpreadsheet')->setCreated(STAMP)->setModified(STAMP)
        ->setLastModifiedBy('PhpSpreadsheet');
    $sheet = $spreadsheet->getActiveSheet();
    $sheet->setTitle('Cashbook');
    foreach ($book['headers'] as $i => $text) {
        $sheet->setCellValueExplicit([$i + 1, 1], $text, DataType::TYPE_STRING);
    }
    foreach ($book['entries'] as $r => $e) {
        $row = $r + 2;
        $minor = [$e['receipt'], $e['payment']];
        if ($book['kind'] === 'typed') {
            [$y, $m, $d] = array_map('intval', explode('-', $e['date']));
            $sheet->setCellValue([1, $row], Date::formattedPHPToExcel($y, $m, $d));
            $sheet->getStyle([1, $row])->getNumberFormat()->setFormatCode('yyyy-mm-dd');
        } else {
            $sheet->setCellValueExplicit([1, $row], $e['date'], DataType::TYPE_STRING);
        }
        foreach (['voucher', 'description', 'reference'] as $k => $key) {
            $sheet->setCellValueExplicit([$k + 2, $row], $e[$key], DataType::TYPE_STRING);
        }
        foreach ($minor as $k => $value) {
            if (!$value) {
                continue;
            }
            if ($book['kind'] === 'typed') {
                $sheet->setCellValue([$k + 5, $row], $value / 100);
                $sheet->getStyle([$k + 5, $row])->getNumberFormat()->setFormatCode('#,##0.00');
            } else {
                $text = intdiv($value, 100) . '.' . str_pad((string) ($value % 100), 2, '0', STR_PAD_LEFT);
                $sheet->setCellValueExplicit([$k + 5, $row], $text, DataType::TYPE_STRING);
            }
        }
    }
    (new Xlsx($spreadsheet))->save($book['out']);
}
