import { useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { eco, type Row } from "./api";
import { inr, todayIn, uuid } from "./format";
import { useAction } from "./ui";
import { Button, ErrorBox, Field, Spinner } from "../components/ui";
import { useAsync } from "../hooks";

export const PAYMENT_METHODS: [string, string][] = [
  ["upi", "UPI"],
  ["neft", "NEFT"],
  ["rtgs", "RTGS"],
  ["imps", "IMPS"],
  ["bank_transfer", "Bank transfer"],
  ["cheque", "Cheque"],
  ["cash", "Cash deposit"],
];

interface Line {
  productId: string;
  quantity: string;
  remarks: string;
}

const MAX_PROOF_MB = 5;

/**
 * Items + payment + proof, then submit. New requests are created with an Idempotency-Key that is
 * kept across retries, so pressing Submit again after a network error never creates a second
 * request. With `correction` it edits a request sent back for correction and resubmits it.
 */
export function PurchaseForm({
  distributorId,
  source,
  correction,
  initialItems,
  onDone,
}: {
  distributorId?: string;
  source?: "web" | "android";
  correction?: Row;
  /** Pre-filled lines (e.g. the portal cart). */
  initialItems?: { productId: string; quantity: number }[];
  onDone: (request: Row) => void;
}) {
  const products = useAsync(() => eco.products({ limit: 100, sort: "name", order: "asc" }), []);
  const active = useMemo(() => (products.data?.items ?? []).filter((p) => p.isActive), [products.data]);
  const [lines, setLines] = useState<Line[]>(() =>
    correction?.items?.length ? correction.items.map((i: Row) => ({ productId: i.productId, quantity: String(i.quantity), remarks: i.remarks ?? "" }))
      : initialItems?.length
        ? initialItems.map((i) => ({ productId: i.productId, quantity: String(i.quantity), remarks: "" }))
        : [{ productId: "", quantity: "1", remarks: "" }],
  );
  const [remarks, setRemarks] = useState<string>(correction?.remarks ?? "");
  const [pay, setPay] = useState({ amount: "", method: "upi", paymentDate: todayIn(), utr: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  // Survive retries: the same key, and the steps already done.
  const key = useRef(uuid());
  const created = useRef<Row | null>(correction ?? null);
  const paid = useRef(false);

  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const validate = (): string | null => {
    const used = lines.filter((l) => l.productId);
    if (!used.length) return "Add at least one product.";
    if (new Set(used.map((l) => l.productId)).size !== used.length) return "A product appears twice. Increase its quantity instead.";
    for (const l of used) if (!/^\d+$/.test(l.quantity) || Number(l.quantity) < 1) return "Quantities must be whole numbers of at least 1.";
    const amount = Number(pay.amount);
    if (!(amount > 0) || !/^\d+(\.\d{1,2})?$/.test(pay.amount)) return "Enter the amount paid (up to 2 decimals).";
    if (pay.paymentDate > todayIn()) return "The payment date cannot be in the future.";
    if (pay.utr.replace(/[^A-Za-z0-9]/g, "").length < 6) return "Enter the transaction ID / UTR (at least 6 letters or digits).";
    if (!file) return "Attach the payment proof image.";
    if (!["image/jpeg", "image/png"].includes(file.type)) return "The proof must be a JPG or PNG image.";
    if (file.size > MAX_PROOF_MB * 1024 * 1024) return `The proof image is larger than ${MAX_PROOF_MB} MB.`;
    if (!correction && !distributorId) return "Choose a distributor.";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validate();
    setError(problem ?? "");
    if (problem || busy) return;
    const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId, quantity: Number(l.quantity), ...(l.remarks.trim() ? { remarks: l.remarks.trim() } : {}) }));
    await run(async () => {
      if (!created.current) {
        const r = await eco.createRequest({ ...(distributorId ? { distributorId } : {}), items, ...(remarks.trim() ? { remarks: remarks.trim() } : {}), ...(source ? { source } : {}) }, key.current);
        created.current = r.request;
      } else if (correction) {
        await eco.updateDraft(created.current.id, { items, remarks: remarks.trim() });
      }
      const id = created.current!.id;
      if (!paid.current) {
        await eco.paymentProof(id, { amount: Number(pay.amount), method: pay.method, paymentDate: pay.paymentDate, utr: pay.utr.trim() }, file!);
        paid.current = true;
      }
      const result = correction ? await eco.requestAction(id, "resubmit") : (await eco.requestAction(id, "submit", {}, key.current)).request;
      onDone(result ?? (await eco.request(id)));
    }, correction ? "Corrected request resubmitted" : "Purchase request submitted");
  };

  if (products.error) return <ErrorBox error={products.error} onRetry={() => products.reload()} />;
  if (!products.data) return <Spinner label="Loading products…" />;

  return (
    <form className="form" onSubmit={submit}>
      <section className="card">
        <div className="card-head">
          <h2>Products</h2>
          <span className="muted">{totalQty} unit(s)</span>
        </div>
        <div className="items-editor">
          {lines.map((l, i) => (
            <div className="item-row" key={i}>
              <select aria-label="Product" value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                <option value="">Choose a product…</option>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model} ({p.sku})
                  </option>
                ))}
              </select>
              <input aria-label="Quantity" type="number" min={1} step={1} inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              <input className="item-remarks" aria-label="Item remarks" placeholder="Remarks (optional)" maxLength={300} value={l.remarks} onChange={(e) => setLine(i, { remarks: e.target.value })} />
              <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "1", remarks: "" }])} disabled={lines.length >= active.length}>
            Add product
          </Button>
        </div>
        <Field label="Remarks for the request">{(id) => <textarea id={id} rows={2} maxLength={1000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}</Field>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{correction ? "Corrected payment" : "Payment"}</h2>
          {pay.amount && <span className="muted">{inr(pay.amount)}</span>}
        </div>
        {correction?.payment?.rejectionReason && <ErrorBox error={`Previous payment rejected: ${correction.payment.rejectionReason}`} />}
        <div className="grid-2">
          <Field label="Amount paid (₹)" required>{(id) => <input id={id} type="number" min={0.01} step="0.01" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />}</Field>
          <Field label="Method" required>
            {(id) => (
              <select id={id} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            )}
          </Field>
          <Field label="Payment date" required>{(id) => <input id={id} type="date" max={todayIn()} value={pay.paymentDate} onChange={(e) => setPay({ ...pay, paymentDate: e.target.value })} />}</Field>
          <Field label="Transaction ID / UTR" required hint="As printed on the bank or UPI receipt.">{(id) => <input id={id} maxLength={60} value={pay.utr} onChange={(e) => setPay({ ...pay, utr: e.target.value })} />}</Field>
        </div>
        <Field label="Payment proof" required hint={`JPG or PNG, up to ${MAX_PROOF_MB} MB. Kept private.`}>
          {(id) => (
            <label className="btn btn-secondary btn-sm" htmlFor={id} style={{ width: "fit-content" }}>
              <ImagePlus size={15} /> {file ? file.name : "Choose image"}
              <input id={id} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={(e) => (setFile(e.target.files?.[0] ?? null), (paid.current = false))} />
            </label>
          )}
        </Field>
        {preview && <img className="proof-preview" src={preview} alt="Payment proof preview" />}
      </section>

      {error && <ErrorBox error={error} />}
      <Button type="submit" variant="primary" className="btn-block" busy={busy} disabled={busy}>
        {busy ? "Sending…" : correction ? "Resubmit request" : "Submit request"}
      </Button>
    </form>
  );
}
