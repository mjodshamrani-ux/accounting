package tarasuf.holdout;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;

/**
 * The G17 text XLSX cashbooks, written by fastexcel as a Java service's export would.
 *
 * <p>Writes every cashbook whose kind is 'text': each cell as text, the dates as yyyy-mm-dd and the
 * amounts as plain decimals with two places, the other amount cell left empty. The input is the
 * renderer's cashbooks.json; it is read with a small pattern, as it is flat and written by render.py.
 */
public final class Cashbooks {
  private static final Pattern BOOK = Pattern.compile("\\{\"out\": \"([^\"]+)\", \"kind\": \"(\\w+)\"");
  private static final Pattern ENTRY = Pattern.compile(
      "\\{\"date\": \"([^\"]*)\", \"voucher\": \"([^\"]*)\", \"description\": \"([^\"]*)\", "
          + "\"reference\": \"([^\"]*)\", \"receipt\": (\\d+), \"payment\": (\\d+)\\}");

  private Cashbooks() {}

  static String plain(long minor) {
    return minor == 0 ? "" : String.format("%d.%02d", minor / 100, minor % 100);
  }

  public static void main(String[] args) throws Exception {
    String json = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
    String[] headers = {"Date", "Voucher", "Description", "Reference", "Receipts", "Payments"};
    Matcher books = BOOK.matcher(json);
    List<int[]> starts = new ArrayList<>();
    List<String[]> heads = new ArrayList<>();
    while (books.find()) {
      starts.add(new int[] {books.start(), books.end()});
      heads.add(new String[] {books.group(1), books.group(2)});
    }
    for (int b = 0; b < heads.size(); b++) {
      if (!heads.get(b)[1].equals("text")) {
        continue;
      }
      int end = b + 1 < starts.size() ? starts.get(b + 1)[0] : json.length();
      Matcher entries = ENTRY.matcher(json.substring(starts.get(b)[1], end));
      try (OutputStream os = Files.newOutputStream(Path.of(heads.get(b)[0]))) {
        Workbook wb = new Workbook(os, "G17 cashbook export", "1.0");
        Worksheet ws = wb.newWorksheet("Cashbook");
        for (int c = 0; c < headers.length; c++) {
          ws.value(0, c, headers[c]);
        }
        int r = 1;
        while (entries.find()) {
          ws.value(r, 0, entries.group(1));
          ws.value(r, 1, entries.group(2));
          ws.value(r, 2, entries.group(3));
          ws.value(r, 3, entries.group(4));
          String receipt = plain(Long.parseLong(entries.group(5)));
          String payment = plain(Long.parseLong(entries.group(6)));
          if (!receipt.isEmpty()) {
            ws.value(r, 4, receipt);
          }
          if (!payment.isEmpty()) {
            ws.value(r, 5, payment);
          }
          r++;
        }
        wb.finish();
      }
    }
  }
}
