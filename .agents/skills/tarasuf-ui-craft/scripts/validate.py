#!/usr/bin/env python3
"""Read-only structural checks for this project skill; --self-test mutates memory only."""
import argparse
import hashlib
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[4]
SKILL = '.agents/skills/tarasuf-ui-craft'
ENTRY = f'{SKILL}/SKILL.md'
ADAPTER = '.claude/skills/tarasuf-ui-craft/SKILL.md'
REFS = ('identity', 'engineering', 'financial-ux', 'domains', 'creative-motion', 'verification', 'provenance')
LICENSES = {
    'unslop-CC-BY-4.0.txt': '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411',
    'unslop-ai-ui-Apache-2.0.txt': 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4',
}
BINDINGS = {
    'clearing': ('clearing-workspace', [0]), 'ar': ('ar-workspace', [0, 1]),
    'gl-tb': ('gl-tb-workspace', [0, 1]), 'allocation': ('allocation-workspace', [0, 1]),
    'bank': ('bank-workspace', [0, 1]), 'tb-financial': ('tb-financial-workspace', [0, 3]),
    'intercompany': ('intercompany-workspace', [0, 1]), 'gateway': ('payment-gateway-workspace', [0, 2]),
    'stock': ('inventory-register-workspace', [0, 3]), 'assets': ('fixed-assets-workspace', [0, 3]),
    'payroll': ('payroll-workspace', [0, 3]),
}
# A domain with a second source path in another component.
MORE_BINDINGS = {'bank': ('bank-statement-workspace', [0, 1])}
DOCS = [ENTRY, ADAPTER, *(f'{SKILL}/references/{r}.md' for r in REFS),
        'docs/audits/TARASUF-UI-CRAFT-REVIEW.ar.md', 'docs/reference/TARASUF-UI-CRAFT.ar.md']


def check(overrides=None):
    overrides = overrides or {}
    errors, links = [], 0

    def read(path):
        if path in overrides:
            value = overrides[path]
            if value is None:
                raise FileNotFoundError(path)
            return value
        return (ROOT / path).read_bytes()

    def text(path):
        try:
            return read(path).decode('utf-8')
        except (OSError, UnicodeError) as exc:
            errors.append(f'Cannot read {path}: {exc}')
            return ''

    for path in DOCS:
        data = text(path)
        if (ROOT / path).is_symlink():
            errors.append(f'Symlink not allowed: {path}')
        if path in (ENTRY, ADAPTER):
            front = re.match(r'^---\n(.*?)\n---\n', data, re.S)
            if not front:
                errors.append(f'Missing frontmatter: {path}')
            else:
                fields = dict(re.findall(r'^(name|description): (.+)$', front[1], re.M))
                if fields.get('name') != 'tarasuf-ui-craft' or not fields.get('description'):
                    errors.append(f'Invalid name/description: {path}')
        for dest in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', data):
            parsed = urlsplit(dest.strip('<>'))
            if parsed.scheme or parsed.netloc:
                continue
            target = ((ROOT / path).parent / unquote(parsed.path)).resolve() if parsed.path else ROOT / path
            if not target.is_relative_to(ROOT):
                errors.append(f'Link escapes repo: {path}: {dest}')
                continue
            rel = target.relative_to(ROOT).as_posix()
            links += 1
            exists = overrides.get(rel, True) is not None and (rel in overrides or target.exists())
            if not exists:
                errors.append(f'Broken link: {path}: {dest}')
            elif parsed.fragment and target.is_file():
                headings = re.findall(r'^#{1,6}\s+(.+)$', text(rel), re.M)
                anchors = {re.sub(r'[^\w\- ]', '', h.lower()).replace(' ', '-') for h in headings}
                if unquote(parsed.fragment) not in anchors:
                    errors.append(f'Broken anchor: {path}: {dest}')

    main = text(ENTRY)
    for mode in ('Audit', 'Refine', 'Design', 'Review'):
        if f'| **{mode}** |' not in main:
            errors.append(f'Missing mode: {mode}')
    for ref in REFS:
        if f'(references/{ref}.md)' not in main:
            errors.append(f'Unreachable reference: {ref}')
    if '(../../../.agents/skills/tarasuf-ui-craft/SKILL.md)' not in text(ADAPTER):
        errors.append('Claude adapter does not point to canonical skill')
    metadata = text(f'{SKILL}/agents/openai.yaml')
    for key in ('display_name:', 'short_description:', 'default_prompt:'):
        if key not in metadata:
            errors.append(f'Missing metadata: {key}')
    if '$tarasuf-ui-craft' not in metadata:
        errors.append('Missing explicit default invocation')
    for path in ('AGENTS.md', 'CLAUDE.md'):
        if 'tarasuf-ui-craft/SKILL.md)' not in text(path):
            errors.append(f'Missing project routing: {path}')

    directory = text('lib/i18n/reconciliation-directory.ts').split('export const', 1)[0]
    domains = set(re.findall(r"'([^']+)'", directory))
    domain_doc = text(f'{SKILL}/references/domains.md')
    rows = dict(re.findall(r'^\| `([^`]+)` \| (.+)$', domain_doc, re.M))
    if set(rows) != domains or len(domains) != 12:
        errors.append('Domain map drift: inspect current union and skill table')
    for domain, (component, indices) in [*BINDINGS.items(), *MORE_BINDINGS.items()]:
        source = text(f'components/{component}.tsx')
        if f'(../../../../components/{component}.tsx)' not in rows.get(domain, ''):
            errors.append(f'Domain table does not link its source: {domain}: {component}')
        pattern = r'primaryIndices=\{\[\s*' + r'\s*,\s*'.join(map(str, indices)) + r'\s*\]\}'
        if not re.search(pattern, source):
            errors.append(f'Primary source binding drift: {domain}')
        if str(indices).replace(' ', '') not in rows.get(domain, ''):
            errors.append(f'Domain table primary indices missing: {domain}')
    for name, digest in LICENSES.items():
        try:
            if hashlib.sha256(read(f'{SKILL}/licenses/{name}')).hexdigest() != digest:
                errors.append(f'License changed: {name}')
        except OSError:
            errors.append(f'License missing: {name}')
    return errors, links


def self_test():
    read = lambda path: (ROOT / path).read_bytes()
    domain_path = f'{SKILL}/references/domains.md'
    meta_path = f'{SKILL}/agents/openai.yaml'
    cases = {
        'name': {ENTRY: read(ENTRY).replace(b'name: tarasuf-ui-craft', b'name: bad', 1)},
        'mode': {ENTRY: read(ENTRY).replace(b'| **Audit** |', b'| **Inspect** |')},
        'link': {ENTRY: read(ENTRY) + b'\n[bad](missing.md)\n'},
        'anchor': {ENTRY: read(ENTRY) + b'\n[bad](SKILL.md#missing-anchor)\n'},
        'reference': {f'{SKILL}/references/identity.md': None},
        'domain': {domain_path: read(domain_path).replace(b'`payroll`', b'`unknown`')},
        'binding': {'components/payroll-workspace.tsx': read('components/payroll-workspace.tsx').replace(b'primaryIndices={[0, 3]}', b'primaryIndices={[0, 2]}')},
        'second-binding': {'components/bank-statement-workspace.tsx': read('components/bank-statement-workspace.tsx').replace(b'primaryIndices={[0, 1]}', b'primaryIndices={[1, 0]}')},
        'unlinked-path': {domain_path: read(domain_path).replace(b'[printed statement](../../../../components/bank-statement-workspace.tsx), ', b'')},
        'adapter': {ADAPTER: read(ADAPTER).replace(b'../../../.agents/', b'../../.agents/')},
        'metadata': {meta_path: read(meta_path).replace(b'$tarasuf-ui-craft', b'$wrong-skill')},
        'license': {f'{SKILL}/licenses/unslop-CC-BY-4.0.txt': b'changed'},
    }
    for label, mutation in cases.items():
        if not check(mutation)[0]:
            raise AssertionError(f'Negative control escaped: {label}')
    print(f'PASS: {len(cases)} negative controls rejected (memory only)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    errors, links = check()
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        sys.exit(1)
    print(f'PASS: {links} local links, 7 references, 12 domains, source bindings, entries and licenses')
    if args.self_test:
        self_test()
