import java.io.File;
import java.io.FileOutputStream;
import java.time.LocalDate;
import java.util.Date;
import java.util.Optional;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Writes the G10 XLSX cashbooks with Apache POI, as an accounting system's
 * export would: a typed cashbook with dates as dates and amounts as numbers
 * (a whole riyal or an amount of one decimal stored as such), or a text
 * cashbook with every cell a string in text format. The workbook's creation
 * date is fixed; render.py fixes the zip entries' dates afterwards.
 *
 *   java PoiCashbooks <cashbooks.xml>
 */
public class PoiCashbooks {
  public static void main(String[] args) throws Exception {
    NodeList books = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new File(args[0]))
        .getElementsByTagName("cashbook");
    for (int b = 0; b < books.getLength(); b++) {
      Element book = (Element) books.item(b);
      boolean typed = book.getAttribute("kind").equals("typed");
      try (XSSFWorkbook wb = new XSSFWorkbook()) {
        wb.getProperties().getCoreProperties().setCreated(Optional.of(new Date(1792713600000L)));
        Sheet sheet = wb.createSheet("Cashbook");
        CellStyle day = wb.createCellStyle();
        day.setDataFormat(wb.createDataFormat().getFormat("yyyy-mm-dd"));
        CellStyle money = wb.createCellStyle();
        money.setDataFormat(wb.createDataFormat().getFormat("#,##0.00"));
        CellStyle text = wb.createCellStyle();
        text.setDataFormat(wb.createDataFormat().getFormat("@"));
        String[] headers = book.getAttribute("headers").split("\\|");
        Row head = sheet.createRow(0);
        for (int c = 0; c < headers.length; c++) head.createCell(c).setCellValue(headers[c]);
        NodeList entries = book.getElementsByTagName("entry");
        for (int i = 0; i < entries.getLength(); i++) {
          Element e = (Element) entries.item(i);
          Row row = sheet.createRow(i + 1);
          String[] fields = {"date", "voucher", "description", "reference", "receipt", "payment"};
          for (int c = 0; c < fields.length; c++) {
            String v = e.getAttribute(fields[c]);
            if (v.isEmpty()) continue;
            Cell cell = row.createCell(c);
            if (typed && c == 0) {
              cell.setCellValue(LocalDate.parse(v));
              cell.setCellStyle(day);
            } else if (typed && c >= 4) {
              long minor = Long.parseLong(v);
              cell.setCellValue(minor % 100 == 0 ? (double) (minor / 100) : minor / 100.0);
              cell.setCellStyle(money);
            } else {
              cell.setCellValue(c >= 4 ? String.format("%d.%02d", Long.parseLong(v) / 100, Long.parseLong(v) % 100) : v);
              if (!typed) cell.setCellStyle(text);
            }
          }
        }
        try (FileOutputStream out = new FileOutputStream(book.getAttribute("out"))) {
          wb.write(out);
        }
      }
    }
  }
}
