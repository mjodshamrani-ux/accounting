// Development-only parent process deadline. A token-level stop cannot interrupt
// a stuck native prefill; kill the isolated process rather than trust its reply.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const threads = process.argv[2] ?? '4', name = process.argv[3] ?? 'v2-cpu-4';
if (!['1', '4'].includes(threads) || !/^[a-z0-9-]+$/.test(name)) throw Error('Invalid experiment name');
const out = `audit/local-provider/results/${name}`;
await mkdir(out, { recursive: true });
const child = spawn(process.execPath, ['--experimental-strip-types', 'audit/local-provider/run-v2.mjs', threads, name], { stdio: ['ignore', 'pipe', 'pipe'] });
let buffer = '', stderr = '', timer, timedOutCase = null;
function deadline(id, milliseconds) {
  clearTimeout(timer);
  timer = setTimeout(() => { timedOutCase = id; child.kill('SIGKILL'); }, milliseconds);
}
deadline('model-loading', 60000);
child.stdout.on('data', bytes => {
  buffer += bytes.toString();
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    process.stdout.write(line + '\n');
    try {
      const event = JSON.parse(line);
      if (event.stage === 'case-start') deadline(event.id, 35000);
      else clearTimeout(timer);
    } catch {}
  }
});
child.stderr.on('data', bytes => { stderr += bytes.toString(); process.stderr.write(bytes); });
const status = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
await writeFile(`${out}/supervisor.json`, JSON.stringify({ ...status, timedOutCase, hardCaseDeadlineMs: 35000, stoppedProcessCannotSupplyReply: true, stderr }, null, 2) + '\n');
process.exitCode = status.code ?? 1;
