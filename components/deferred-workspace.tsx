import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useI18n } from '@/lib/i18n/context';

// UX-9(c): the code of a workspace loads the first time its type is chosen;
// then the workspace stays mounted, hidden while another type is shown, so
// its work is kept as before. While the code loads, its panel says so in one
// line; if it cannot load, the panel says that under a heading and offers to
// reload the page. Not to try again in place: Chromium keeps a failed module
// load for the life of the page and answers a second import with the same
// failure without requesting the file (measured in UX-9(c)), and a newer
// published version has removed the file anyway. Reloading asks first when
// there is unsaved work, as leaving does. Only a failed load is caught here:
// an error inside a loaded workspace is not turned into this message.

function WorkspaceLoading() {
  const { t } = useI18n();
  return (
    <output className="notice loading" data-workspace-loading>
      <LoaderCircle className="spin" size={17} aria-hidden="true" />
      {t.app.shell.workspaceLoading}
    </output>
  );
}

function WorkspaceLoadFailed() {
  const { t } = useI18n();
  return (
    <section className="workspace" data-workspace-load-failed>
      <h2 tabIndex={-1}>{t.app.shell.workspaceLoadFailedTitle}</h2>
      <p className="notice error" role="alert">
        {t.app.shell.workspaceLoadFailed}
      </p>
      <Button variant="outline" onClick={() => window.location.reload()}>
        {t.app.shell.workspaceReload}
      </Button>
    </section>
  );
}

/** Runs its callback once, when the content beside it has been committed. */
function Loaded({ onReady }: { onReady?: () => void }) {
  const ready = useEffectEvent(() => onReady?.());
  useEffect(() => {
    ready();
  }, []);
  return null;
}

export function deferredWorkspace<P extends object>(
  load: () => Promise<ComponentType<P>>,
) {
  const make = (): LazyExoticComponent<ComponentType<P>> =>
    lazy(() =>
      load().then(
        (component) => ({ default: component }),
        () => ({
          default: WorkspaceLoadFailed as unknown as ComponentType<P>,
        }),
      ),
    );
  // One load per workspace: a resolved load is reused when the workspace
  // mounts again (a new allocation handoff).
  const Workspace = make();
  function DeferredWorkspace({
    onReady,
    ...props
  }: P & { onReady?: () => void }) {
    return (
      <Suspense fallback={<WorkspaceLoading />}>
        <Workspace {...(props as unknown as P)} />
        <Loaded onReady={onReady} />
      </Suspense>
    );
  }
  return DeferredWorkspace;
}
