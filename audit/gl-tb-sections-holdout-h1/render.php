<?php
// GLT-1 holdout H1, the PHP writer: fputcsv with its defaults (quotes fields
// with a separator, quote, space, tab or line break; LF). Reads
// [{path, cells}] as JSON on stdin.
$files = json_decode(file_get_contents('php://stdin'), true, 512, JSON_THROW_ON_ERROR);
foreach ($files as $f) {
    $out = fopen($f['path'], 'w');
    foreach ($f['cells'] as $row) {
        fputcsv($out, $row, ',', '"', '\\', "\n");
    }
    fclose($out);
}
