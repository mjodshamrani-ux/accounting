import { open, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectFinancialHierarchySource4 } from '../lib/reconciliation/tb-financial-hierarchy-source.ts';
import { FIN_HIERARCHY_LIMITS } from '../lib/reconciliation/tb-financial-hierarchy-contract.ts';

// Read at most cap+1 bytes, even if a file grows after stat. Inputs are never written.
async function boundedRead(path, cap) {
  const handle = await open(path, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw Error('INPUT_NOT_REGULAR_FILE');
    const buffer = Buffer.alloc(cap + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > cap) throw Error('INPUT_BYTE_LIMIT');
    return Uint8Array.from(buffer.subarray(0, length)).buffer;
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3)
    throw Error(
      'Usage: node --experimental-strip-types scripts/inspect-financial-hierarchy-source4.mjs CSV_PATH SCOPE_JSON_PATH [OUTPUT_JSON_PATH]',
    );
  const [csvPath, scopePath, outputPath] = args;
  const csv = await boundedRead(csvPath, FIN_HIERARCHY_LIMITS.bytes);
  const scopeBytes = await boundedRead(scopePath, FIN_HIERARCHY_LIMITS.bytes);
  const expectedScope = JSON.parse(
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      scopeBytes,
    ),
  );
  const result = await inspectFinancialHierarchySource4({
    name: csvPath.split(/[\\/]/).pop(),
    original: csv,
    expectedScope,
  });
  // Original bytes remain available in the API. CLI JSON omits them; hash/size,
  // captured scope, record inventory, header and citations remain in the output.
  const serialized =
    JSON.stringify(
      {
        ...result,
        source: result.source && {
          name: result.source.name,
          sha256: result.source.sha256,
          byteLength: result.source.byteLength,
        },
      },
      (_key, value) => (typeof value === 'bigint' ? value.toString(10) : value),
      2,
    ) + '\n';
  if (outputPath) {
    const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
    const parent = await realpath(dirname(resolve(outputPath)));
    const destination = resolve(
      parent,
      resolve(outputPath).split(/[\\/]/).pop(),
    );
    const rel = relative(root, destination);
    if (
      !rel ||
      (!rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel))
    )
      throw Error('OUTPUT_MUST_BE_OUTSIDE_SOURCE_TREE');
    // wx prevents overwriting input files, existing results, or following output symlinks.
    await writeFile(destination, serialized, { flag: 'wx' });
  } else process.stdout.write(serialized);
  process.exitCode = result.status === 'inspected' ? 0 : 2;
}

main().catch((error) => {
  process.stderr.write(String(error.message ?? error) + '\n');
  process.exitCode = 1;
});
