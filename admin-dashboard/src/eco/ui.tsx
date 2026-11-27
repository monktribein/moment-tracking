import { useState, type ReactNode } from "react";
import { Image as ImageIcon, Inbox, Lock } from "lucide-react";
import type { PageMeta } from "../api";
import { Badge, Button, Empty, ErrorBox, Field, Modal, Pagination, Spinner, errorText, useFeedback } from "../components/ui";
import { useAsync, type AsyncState } from "../hooks";
import { toneOf, words } from "./format";
import type { Row } from "./api";

export function StatusBadge({ status, label }: { status: unknown; label?: string }) {
  if (status === null || status === undefined || status === "") return <span className="muted">—</span>;
  return <Badge tone={toneOf(status)}>{label ?? words(status)}</Badge>;
}

export type PagedData = { items: Row[]; meta: PageMeta } & Record<string, unknown>;

/** A paged list that reloads when `deps` change. Change `page` with setPage. */
export function usePaged(load: (page: number) => Promise<PagedData>, deps: unknown[]) {
  const [page, setPage] = useState(1);
  const state = useAsync(() => load(page), [page, ...deps]);
  return { ...state, page, setPage };
}

export interface Col {
  key: string;
  label: ReactNode;
  render?: (row: Row) => ReactNode;
  className?: string;
}

/** Table with loading, error, empty states and pagination. */
export function DataTable({
  state,
  columns,
  onRow,
  empty = "Nothing here yet",
  emptyHint,
  rowKey = (r, i) => r.id ?? String(i),
}: {
  state: AsyncState<PagedData> & { page: number; setPage: (p: number) => void };
  columns: Col[];
  onRow?: (row: Row) => void;
  empty?: string;
  emptyHint?: ReactNode;
  rowKey?: (row: Row, index: number) => string;
}) {
  if (state.error) return <ErrorBox error={state.error} onRetry={() => state.reload()} />;
  if (state.loading && !state.data) return <Spinner />;
  const rows = state.data?.items ?? [];
  if (!rows.length) return <Empty icon={<Inbox size={28} />} title={empty}>{emptyHint}</Empty>;
  const meta = state.data!.meta;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.className}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={rowKey(row, i)} className={onRow ? "clickable" : undefined} onClick={onRow ? () => onRow(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render ? c.render(row) : (row[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={meta.page} limit={meta.limit} total={meta.total} onPage={state.setPage} />
    </>
  );
}

/** Runs an action with a busy flag and a toast; returns true when it worked. */
export function useAction() {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      if (success) toast(success);
      return true;
    } catch (err) {
      toast(errorText(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** A confirmation that asks for a reason (mandatory unless `optional`). */
export function ReasonModal({
  title,
  message,
  label = "Reason",
  confirmLabel = "Confirm",
  danger,
  optional,
  onSubmit,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  label?: string;
  confirmLabel?: string;
  danger?: boolean;
  optional?: boolean;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const submit = async () => {
    if (!optional && !reason.trim()) return setError(`${label} is required`);
    if (await run(() => onSubmit(reason.trim()))) onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="form">
        {message && <div className="confirm-text">{message}</div>}
        <Field label={label} required={!optional} error={error}>
          {(id) => <textarea id={id} rows={3} maxLength={500} value={reason} onChange={(e) => (setReason(e.target.value), setError(""))} autoFocus />}
        </Field>
      </div>
    </Modal>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div className="kv-row" key={k}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TimelineItem {
  at: unknown;
  title: ReactNode;
  sub?: ReactNode;
  status?: string;
}

export function Timeline({ items, format }: { items: TimelineItem[]; format: (v: unknown) => string }) {
  if (!items.length) return <p className="muted">No history yet.</p>;
  return (
    <ol className="eco-timeline">
      {items.map((t, i) => (
        <li key={i} className={`eco-tl-${toneOf(t.status)}`}>
          <span className="eco-timeline-dot" />
          <div>
            <div className="eco-timeline-title">{t.title}</div>
            <div className="cell-sub">
              {format(t.at)}
              {t.sub ? <> · {t.sub}</> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Opens a private image through a short-lived signed link. */
export function SignedImageButton({ load, label = "View image" }: { load: () => Promise<{ url: string; expiresAt: string }>; label?: string }) {
  const [open, setOpen] = useState(false);
  const link = useAsync(() => (open ? load() : Promise.resolve(null)), [open]);
  return (
    <>
      <Button size="sm" icon={<ImageIcon size={15} />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)} wide>
          {link.error ? (
            <ErrorBox error={link.error} onRetry={() => link.reload()} />
          ) : !link.data ? (
            <Spinner label="Opening securely…" />
          ) : (
            <div className="proof-view">
              <img src={link.data.url} alt={label} />
              <p className="muted small">This private link expires at {new Date(link.data.expiresAt).toLocaleTimeString("en-IN")}.</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

export function NoAccess() {
  return (
    <Empty icon={<Lock size={28} />} title="You do not have access to this page">
      Ask your administrator if you need it.
    </Empty>
  );
}

/** Shows a one-time password once, with a copy button. */
export function TempPasswordModal({ title, who, password, onClose }: { title: string; who: string; password: string; onClose: () => void }) {
  const { toast } = useFeedback();
  return (
    <Modal title={title} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="form">
        <p>
          Give this temporary password to <b>{who}</b>. It is shown only once; they can change it after signing in, or set their own with “Forgot password”.
        </p>
        <div className="credentials">
          <code className="mono">{password}</code>
          <Button size="sm" onClick={() => navigator.clipboard?.writeText(password).then(() => toast("Copied"))}>
            Copy
          </Button>
        </div>
      </div>
    </Modal>
  );
}
