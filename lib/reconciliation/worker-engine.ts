// The engine's worker as Vite builds it: one text, run as a blob worker under
// the page's content policy. It is about five megabytes with the readers and
// pdf.js, so client.ts imports this module on its own (UX-9): the first page
// paints without waiting for the engine, and the engine loads right after.
// Vite supplies the default Worker constructor for this virtual module (vite/client.d.ts).
// oxlint-disable-next-line import/default
import LocalWorker from './worker.ts?worker&inline';
export default LocalWorker;
