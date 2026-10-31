import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Date;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.sax.SAXResult;
import javax.xml.transform.stream.StreamSource;
import org.apache.fop.apps.FOUserAgent;
import org.apache.fop.apps.Fop;
import org.apache.fop.apps.FopFactory;
import org.apache.fop.apps.MimeConstants;

/**
 * Lays out each G10 FOP statement from its XSL-FO with Apache FOP and its
 * own PDF writer. The creation date is fixed; the title is set from the FO.
 *
 *   java FopStatements <fop.xconf> <in.fo> <out.pdf> [<in.fo> <out.pdf> ...]
 */
public class FopStatements {
  public static void main(String[] args) throws Exception {
    FopFactory factory = FopFactory.newInstance(new File(args[0]).getAbsoluteFile());
    for (int i = 1; i + 1 < args.length; i += 2) {
      FOUserAgent agent = factory.newFOUserAgent();
      agent.setCreationDate(new Date(1792713600000L)); // 2026-10-23T00:00:00Z
      agent.setCreator("Apache FOP " + org.apache.fop.Version.getVersion());
      try (OutputStream out = new BufferedOutputStream(new FileOutputStream(args[i + 1]))) {
        Fop fop = factory.newFop(MimeConstants.MIME_PDF, agent, out);
        Transformer identity = TransformerFactory.newInstance().newTransformer();
        identity.transform(new StreamSource(new File(args[i])), new SAXResult(fop.getDefaultHandler()));
      }
    }
  }
}
