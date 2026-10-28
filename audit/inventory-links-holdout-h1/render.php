<?php
// INV-3 H1, the PHP writer: fputcsv with its own quoting (a field with a
// comma, quote, space, tab, backslash or line break is quoted), LF after
// every row. Reads [{path, cells}] as JSON on stdin.
$jobs = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
foreach ($jobs as $job) {
    $out = fopen($job['path'], 'wb');
    foreach ($job['cells'] as $row) {
        if (count($row) === 0) {
            fwrite($out, "\n");
            continue;
        }
        fputcsv($out, $row, ',', '"', '', "\n");
    }
    fclose($out);
}
