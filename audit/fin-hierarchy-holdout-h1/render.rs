// FIN-1 H1 writer, written here in Rust without crates: every field quoted,
// CRLF line ends, and a UTF-8 byte-order mark when the file asks for one, as
// spreadsheet "CSV UTF-8" exports write it. Reads framed records on stdin
// from render.py: "F" path, "B0"/"B1", row count, then per row a field
// count and per field its byte length and bytes, each count on its own line.
use std::io::{self, Read, Write};

fn line(data: &[u8], at: &mut usize) -> String {
    let start = *at;
    while data[*at] != b'\n' {
        *at += 1;
    }
    let text = String::from_utf8(data[start..*at].to_vec()).unwrap();
    *at += 1;
    text
}

fn main() {
    let mut data = Vec::new();
    io::stdin().read_to_end(&mut data).unwrap();
    let mut at = 0;
    while at < data.len() {
        let head = line(&data, &mut at);
        let path = head.strip_prefix('F').unwrap().to_string();
        let bom = line(&data, &mut at) == "B1";
        let rows: usize = line(&data, &mut at).parse().unwrap();
        let mut out: Vec<u8> = Vec::new();
        if bom {
            out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        for _ in 0..rows {
            let fields: usize = line(&data, &mut at).parse().unwrap();
            for i in 0..fields {
                let length: usize = line(&data, &mut at).parse().unwrap();
                let value = &data[at..at + length];
                at += length;
                if i > 0 {
                    out.push(b',');
                }
                out.push(b'"');
                for &b in value {
                    if b == b'"' {
                        out.push(b'"');
                    }
                    out.push(b);
                }
                out.push(b'"');
            }
            out.extend_from_slice(b"\r\n");
        }
        std::fs::File::create(&path).unwrap().write_all(&out).unwrap();
    }
}
