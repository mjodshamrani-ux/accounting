import type { Lang } from './language.ts';
import { engineCatalog } from './engine-catalog.ts';

// The accounting engine reports in Arabic, and that text is part of its
// behaviour: saved sessions, exported workpapers and the regression suites all
// rely on it. It is never rewritten per language. Instead, each engine message
// is identified by its canonical Arabic template (as gettext uses the source
// string as the message id), and the interface presents the English template
// with the same parameters. Accounting decisions never pass through here.

const SLOT = '${…}';
const ARABIC = /[؀-ۿ]/;
const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');

type Template = {
  pattern: RegExp;
  /** For each capture group, how many adjacent slots share it. */
  runs: number[];
  english: string;
  /** Length of the fixed Arabic text: longer is more specific. */
  weight: number;
  /** The key begins with fixed text, not a slot. */
  anchored: boolean;
};

const exact = new Map<string, string>();
const templates: Template[] = [];
for (const [arabic, english] of Object.entries(engineCatalog)) {
  const parts = arabic.split(SLOT);
  if (parts.length === 1) {
    exact.set(arabic, english);
    continue;
  }
  // Slots written back to back (`${a}${b}`) cannot be told apart by a pattern;
  // they are captured together and separated afterwards.
  const runs: number[] = [];
  let source = `^${escape(parts[0])}`;
  for (let i = 1; i < parts.length; i++) {
    if (i > 1 && parts[i - 1] === '') runs[runs.length - 1]++;
    else {
      runs.push(1);
      source += '([\\s\\S]*?)';
    }
    source += escape(parts[i]);
  }
  templates.push({
    pattern: new RegExp(`${source}$`),
    runs,
    english,
    weight: parts.join('').length,
    anchored: parts[0] !== '',
  });
}
// A template that starts with its own words is tried before one that starts
// with a slot, which could otherwise swallow a leading phrase as data.
templates.sort(
  (a, b) => Number(b.anchored) - Number(a.anchored) || b.weight - a.weight,
);
const prefixes = [...exact.keys()]
  .filter((key) => key.length >= 8)
  .sort((a, b) => b.length - a.length);

/** The whole text is one catalogue message. */
function whole(text: string, depth: number, anchoredOnly = false) {
  const direct = exact.get(text);
  if (direct !== undefined) return direct;
  for (const template of templates) {
    if (anchoredOnly && !template.anchored) continue;
    const match = template.pattern.exec(text);
    if (match) return render(template, match, depth);
  }
  return undefined;
}

function render(template: Template, match: RegExpExecArray, depth: number) {
  const values: string[] = [];
  template.runs.forEach((count, group) => {
    let rest = match[group + 1] ?? '';
    const run: string[] = [];
    // From the right, each later slot takes the shortest ending of the capture
    // that is itself a complete engine message; the first slot keeps the rest.
    for (let slot = count - 1; slot > 0; slot--) {
      let taken = '';
      for (let start = rest.length - 1; start > 0; start--) {
        const tail = rest.slice(start);
        if (!/^[\s،؛,.:]/.test(tail) && !/\s$/.test(rest.slice(0, start)))
          continue;
        if (whole(tail, depth + 1, true) !== undefined) {
          taken = tail;
          break;
        }
      }
      run.unshift(taken);
      rest = rest.slice(0, rest.length - taken.length);
    }
    values.push(rest, ...run);
  });
  return template.english.replace(
    /\{([et]?)(\d+)\}/g,
    (_, mode: string, index: string) => {
      const value = values[Number(index)] ?? '';
      if (mode === 't') return translate(value, depth + 1);
      if (mode === 'e') return exact.get(value) ?? value;
      return value;
    },
  );
}

function translate(text: string, depth = 0): string {
  if (!text || !ARABIC.test(text) || depth > 8) return text;
  // Multi-line engine output (the assistant's answers) is a list of messages.
  if (text.includes('\n'))
    return text
      .split('\n')
      .map((line) => translate(line, depth + 1))
      .join('\n');
  const found = whole(text, depth);
  if (found !== undefined) return found;
  // Several notes joined into one (a row with more than one reading issue).
  // A note may itself contain "؛ ", so split only where a whole note ends.
  for (
    let at = text.indexOf('؛ ');
    at > 0;
    at = text.indexOf('؛ ', at + 1)
  ) {
    const head = whole(text.slice(0, at), depth + 1);
    if (head !== undefined)
      return `${head}; ${translate(text.slice(at + 2), depth + 1)}`;
  }
  if (text.includes('؛ ')) {
    const parts = text.split('؛ ');
    const translated = parts.map((part) => translate(part, depth + 1));
    if (translated.some((part, i) => part !== parts[i]))
      return translated.join('; ');
  }
  // A side or subject, then its message: "المورد: …".
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const head = text.slice(0, colon);
    const tail = text.slice(colon + 2);
    const translatedHead = translate(head, depth + 1);
    const translatedTail = translate(tail, depth + 1);
    if (translatedHead !== head || translatedTail !== tail)
      return `${translatedHead}: ${translatedTail}`;
  }
  // One message written straight after another.
  for (const prefix of prefixes)
    if (text.startsWith(prefix) && text.length > prefix.length)
      return exact.get(prefix)! + translate(text.slice(prefix.length), depth + 1);
  return text;
}

export function localizeEngineText(text: string, lang: Lang): string {
  return lang === 'ar' ? text : translate(text);
}
