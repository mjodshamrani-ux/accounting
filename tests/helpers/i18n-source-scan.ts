// Finds the Arabic text written in source files, with enough context to decide
// whether it is a message the interface shows. Used by the localisation tests.
import fs from 'node:fs';
import ts from 'typescript';

export const ARABIC = /[؀-ۿ]/;
/** Stands for one ${…} slot in a catalogue key. */
export const SLOT = '${…}';

export type SourceLiteral = {
  file: string;
  line: number;
  /** The literal as the catalogue keys it: a template's slots become ${…}. */
  key: string;
  /** Name of the nearest enclosing function, class member or variable. */
  owner: string;
  /** The literal is a JSX text node or attribute value. */
  jsx: boolean;
};

function ownerOf(node: ts.Node, sf: ts.SourceFile): string {
  for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
    if (
      (ts.isFunctionDeclaration(p) ||
        ts.isMethodDeclaration(p) ||
        ts.isVariableDeclaration(p) ||
        ts.isPropertyDeclaration(p)) &&
      p.name
    )
      return p.name.getText(sf);
  }
  return '';
}

export function sourceLiterals(files: string[]): SourceLiteral[] {
  const found: SourceLiteral[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      let key: string | undefined;
      let jsx = false;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        key = node.text;
        // 'label: ' + value reads, at run time, like the template `label: ${…}`.
        const parent = node.parent;
        if (
          ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
          parent.left === node &&
          !key.endsWith('\n')
        )
          key += SLOT;
      } else if (ts.isTemplateExpression(node))
        key =
          node.head.text +
          node.templateSpans.map((span) => SLOT + span.literal.text).join('');
      else if (ts.isJsxText(node)) {
        key = node.text.trim();
        jsx = true;
      }
      // Text shown on several lines is presented line by line, so each line
      // is its own message.
      for (const line of key?.split('\n') ?? [])
        if (ARABIC.test(line))
          found.push({
            file,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            key: line,
            owner: ownerOf(node, sf),
            jsx: jsx || (!!node.parent && ts.isJsxAttribute(node.parent)),
          });
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}
