// Rust 1.97, the standard library only. CRLF between records and no line
// end after the last one, unless the last record is blank (it would vanish).
// A field is quoted when it holds a comma, a quote, CR or LF, or begins or
// ends with a space. Input: one record per line, each field as hex of its
// UTF-8 bytes, fields separated by one space; an empty line is a blank record.
use std::io::Read;
use std::io::Write;
fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut text = String::new();
    std::fs::File::open(&args[1]).unwrap().read_to_string(&mut text).unwrap();
    let lines: Vec<&str> = text.split('\n').collect();
    let records = &lines[..lines.len() - 1];
    let mut out: Vec<u8> = Vec::new();
    for (n, line) in records.iter().enumerate() {
        let fields: Vec<Vec<u8>> = if line.is_empty() { vec![] } else { line.split(' ').map(unhex).collect() };
        for (i, f) in fields.iter().enumerate() {
            if i > 0 { out.push(b','); }
            let quote = f.iter().any(|&b| b == b',' || b == b'"' || b == b'\r' || b == b'\n')
                || f.first() == Some(&b' ') || f.last() == Some(&b' ');
            if quote {
                out.push(b'"');
                for &b in f { if b == b'"' { out.push(b'"'); } out.push(b); }
                out.push(b'"');
            } else { out.extend_from_slice(f); }
        }
        if n + 1 < records.len() || fields.is_empty() { out.extend_from_slice(b"\r\n"); }
    }
    std::fs::File::create(&args[2]).unwrap().write_all(&out).unwrap();
}
