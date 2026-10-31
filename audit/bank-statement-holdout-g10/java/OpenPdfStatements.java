import com.lowagie.text.Document;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.PageSize;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.ArabicLigaturizer;
import com.lowagie.text.pdf.BaseFont;
import com.lowagie.text.pdf.ColumnText;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfWriter;
import java.awt.Color;
import java.io.File;
import java.io.FileOutputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.NodeList;

/**
 * Draws each G10 OpenPDF statement from its XML description with OpenPDF,
 * the LGPL fork of iText 4: each statement page a PdfPTable placed by
 * OpenPDF, its footer placed by ColumnText at the foot of the page. A
 * right-to-left statement sets the RTL run direction on its tables, and
 * OpenPDF shapes Arabic itself into presentation forms (ArabicLigaturizer).
 * Helvetica and Courier are the standard fonts, not embedded; any other font
 * is a TrueType file embedded as a subset. OpenPDF dates the file by the
 * clock; render.py fixes those dates afterwards.
 *
 *   java OpenPdfStatements <statements.xml>
 */
public class OpenPdfStatements {
  public static void main(String[] args) throws Exception {
    org.w3c.dom.Document xml =
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new File(args[0]));
    NodeList statements = xml.getElementsByTagName("statement");
    for (int i = 0; i < statements.getLength(); i++) render((org.w3c.dom.Element) statements.item(i));
  }

  static Rectangle paper(String name) {
    switch (name) {
      case "A4": return PageSize.A4;
      case "A4-landscape": return PageSize.A4.rotate();
      case "Letter": return PageSize.LETTER;
      case "Legal": return PageSize.LEGAL;
      default: throw new IllegalArgumentException(name);
    }
  }

  static BaseFont font(String name) throws Exception {
    switch (name) {
      case "Helvetica": return BaseFont.createFont(BaseFont.HELVETICA, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED);
      case "Courier": return BaseFont.createFont(BaseFont.COURIER, BaseFont.WINANSI, BaseFont.NOT_EMBEDDED);
      default: return BaseFont.createFont(name, BaseFont.IDENTITY_H, BaseFont.EMBEDDED);
    }
  }

  static void render(org.w3c.dom.Element s) throws Exception {
    boolean rtl = s.getAttribute("rtl").equals("1");
    int direction = rtl ? PdfWriter.RUN_DIRECTION_RTL : PdfWriter.RUN_DIRECTION_NO_BIDI;
    float size = Float.parseFloat(s.getAttribute("size"));
    BaseFont base = font(s.getAttribute("font"));
    String rules = s.getAttribute("rules");
    boolean filled = s.getAttribute("heading").equals("filled");
    Rectangle page = paper(s.getAttribute("paper"));
    Document doc = new Document(page, 36, 36, 34, 52);
    PdfWriter writer = PdfWriter.getInstance(doc, new FileOutputStream(s.getAttribute("out")));
    doc.addTitle(s.getAttribute("title"));
    doc.addCreator(Document.getVersion());
    doc.open();
    NodeList pages = s.getElementsByTagName("page");
    for (int p = 0; p < pages.getLength(); p++) {
      org.w3c.dom.Element pg = (org.w3c.dom.Element) pages.item(p);
      if (p > 0) doc.newPage();
      PdfPTable letterhead = new PdfPTable(1);
      letterhead.setWidthPercentage(100);
      letterhead.setRunDirection(direction);
      NodeList heads = pg.getElementsByTagName("line");
      for (int i = 0; i < heads.getLength(); i++) {
        org.w3c.dom.Element line = (org.w3c.dom.Element) heads.item(i);
        PdfPCell cell = new PdfPCell(new Phrase(line.getTextContent(),
            new Font(base, Float.parseFloat(line.getAttribute("size")))));
        cell.setBorder(Rectangle.NO_BORDER);
        cell.setPadding(0);
        cell.setPaddingBottom(Float.parseFloat(line.getAttribute("after")));
        cell.setRunDirection(direction);
        cell.setArabicOptions(ArabicLigaturizer.ar_novowel);
        letterhead.addCell(cell);
      }
      doc.add(letterhead);
      String[] widths = s.getAttribute("widths").split(",");
      float[] relative = new float[widths.length];
      for (int i = 0; i < widths.length; i++) relative[i] = Float.parseFloat(widths[i]);
      PdfPTable table = new PdfPTable(relative);
      table.setWidthPercentage(100);
      table.setRunDirection(direction);
      table.setHeaderRows(1);
      table.setSpacingBefore(6);
      NodeList rows = pg.getElementsByTagName("row");
      for (int r = 0; r < rows.getLength(); r++) {
        org.w3c.dom.Element row = (org.w3c.dom.Element) rows.item(r);
        boolean head = row.getAttribute("kind").equals("head");
        NodeList cells = row.getElementsByTagName("cell");
        for (int c = 0; c < cells.getLength(); c++) {
          org.w3c.dom.Element cell = (org.w3c.dom.Element) cells.item(c);
          PdfPCell pc = new PdfPCell(new Phrase(cell.getTextContent(), new Font(base, size)));
          pc.setColspan(Integer.parseInt(cell.getAttribute("span")));
          // OpenPDF mirrors the alignment of a right-to-left cell, so
          // ALIGN_RIGHT is the cell's end in either direction.
          boolean end = cell.getAttribute("align").equals("end");
          pc.setHorizontalAlignment(end ? Element.ALIGN_RIGHT : Element.ALIGN_LEFT);
          pc.setRunDirection(direction);
          pc.setArabicOptions(ArabicLigaturizer.ar_novowel);
          // Each cell is as tall as its font's descender needs.
          pc.setUseDescender(true);
          pc.setPaddingTop(1.5f);
          pc.setPaddingBottom(2f);
          pc.setPaddingLeft(3f);
          pc.setPaddingRight(3f);
          if (rules.equals("grid")) {
            pc.setBorder(Rectangle.BOX);
            pc.setBorderWidth(0.4f);
            pc.setBorderColor(new Color(0x44, 0x44, 0x44));
          } else if (rules.equals("rows") && !head) {
            pc.setBorder(Rectangle.BOTTOM);
            pc.setBorderWidth(0.3f);
            pc.setBorderColor(new Color(0x9a, 0x9a, 0x9a));
          } else {
            pc.setBorder(Rectangle.NO_BORDER);
          }
          if (head && filled) pc.setBackgroundColor(new Color(0xdd, 0xe3, 0xea));
          if (head && !filled) {
            pc.setBorder(pc.getBorder() | Rectangle.BOTTOM);
            pc.setBorderWidthBottom(0.8f);
            pc.setBorderColorBottom(new Color(0x22, 0x22, 0x22));
          }
          table.addCell(pc);
        }
      }
      doc.add(table);
      org.w3c.dom.Element foot = (org.w3c.dom.Element) pg.getElementsByTagName("footer").item(0);
      ColumnText.showTextAligned(writer.getDirectContent(), Element.ALIGN_CENTER,
          new Phrase(foot.getTextContent(), new Font(base, 8)), page.getWidth() / 2, 30, 0, direction,
          ArabicLigaturizer.ar_novowel);
    }
    doc.close();
  }
}
