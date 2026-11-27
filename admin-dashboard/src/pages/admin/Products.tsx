import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ImagePlus, Package, Pencil, Plus, Search } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { words } from "../../eco/format";
import { DataTable, StatusBadge, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { can } from "../../eco/access";
import { Button, ErrorBox, Field, Modal, PageHeader, useFeedback } from "../../components/ui";
import { useDebounced } from "../../hooks";

/** A JPG/PNG check before upload (the server checks the real bytes too). */
export function checkImage(file: File | undefined | null, maxMb: number): string | null {
  if (!file) return null;
  if (!["image/jpeg", "image/png"].includes(file.type)) return "Only JPG or PNG images are accepted.";
  if (file.size > maxMb * 1024 * 1024) return `The image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${maxMb} MB.`;
  return null;
}

export default function Products() {
  const viewer = useViewer();
  const manage = can(viewer, "products.manage");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [active, setActive] = useState("");
  const term = useDebounced(search.trim());
  const [editing, setEditing] = useState<Row | "new" | null>(params.get("new") && manage ? "new" : null);
  const { confirm } = useFeedback();
  const { run } = useAction();
  const list = usePaged((page) => eco.products({ page, limit: 20, search: term, category, active, sort: "name", order: "asc" }), [term, category, active]);

  const toggle = async (p: Row) => {
    const ok = await confirm({
      title: p.isActive ? `Deactivate ${p.name}?` : `Activate ${p.name}?`,
      message: p.isActive ? "It can no longer be chosen in new purchase requests. Existing requests keep their copy of the product." : "It can be ordered again.",
      confirmLabel: p.isActive ? "Deactivate" : "Activate",
      danger: p.isActive,
    });
    if (ok && (await run(() => eco.setProductActive(p.id, !p.isActive), p.isActive ? "Product deactivated" : "Product activated"))) list.reload(true);
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Inverters and batteries distributors can order. Only active products can be selected."
        actions={manage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>Add product</Button>}
      />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Name, model, SKU…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <select value={category} onChange={(e) => (setCategory(e.target.value), list.setPage(1))} aria-label="Category">
              <option value="">All categories</option>
              <option value="inverter">Inverters</option>
              <option value="battery">Batteries</option>
            </select>
            {manage && (
              <select value={active} onChange={(e) => (setActive(e.target.value), list.setPage(1))} aria-label="Status">
                <option value="">Active and inactive</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            )}
          </div>
        </div>
        <DataTable
          state={list}
          empty="No products"
          columns={[
            { key: "img", label: "", render: (r) => (r.imageUrl ? <img className="product-thumb" src={r.imageUrl} alt="" /> : <span className="product-thumb inline-gap"><Package size={18} className="muted" /></span>) },
            { key: "name", label: "Product", render: (r) => (<><div className="cell-title">{r.name}</div><div className="cell-sub">{r.productCode}</div></>) },
            { key: "category", label: "Category", render: (r) => words(r.category) },
            { key: "model", label: "Model" },
            { key: "sku", label: "SKU", render: (r) => <span className="mono">{r.sku}</span> },
            { key: "isActive", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
            ...(manage
              ? [{
                  key: "actions",
                  label: "",
                  render: (r: Row) => (
                    <div className="row-actions">
                      <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(r)} aria-label="Edit" />
                      <Button size="sm" onClick={() => toggle(r)}>{r.isActive ? "Deactivate" : "Activate"}</Button>
                    </div>
                  ),
                }]
              : []),
          ]}
        />
      </div>
      {editing && (
        <ProductForm
          product={editing === "new" ? null : editing}
          onClose={() => (setEditing(null), params.get("new") && setParams({}, { replace: true }))}
          onSaved={() => (setEditing(null), list.reload(true))}
        />
      )}
    </>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: Row | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ category: product?.category ?? "inverter", name: product?.name ?? "", model: product?.model ?? "", sku: product?.sku ?? "", description: product?.description ?? "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad = checkImage(file, 2);
    if (bad) return setError(bad);
    const body = { category: f.category, name: f.name.trim(), model: f.model.trim(), sku: f.sku.trim(), ...(f.description.trim() ? { description: f.description.trim() } : {}) };
    await run(async () => {
      const saved = product ? await eco.updateProduct(product.id, body) : await eco.createProduct(body);
      if (file) await eco.productImage(saved.id, file);
      onSaved();
    }, product ? "Product saved" : "Product added");
  };

  return (
    <Modal
      title={product ? `Edit ${product.name}` : "Add product"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="product-form" busy={busy}>Save</Button>
        </>
      }
    >
      <form id="product-form" className="form" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Category" required>
            {(id) => (
              <select id={id} value={f.category} onChange={(e) => set("category", e.target.value)}>
                <option value="inverter">Inverter</option>
                <option value="battery">Battery</option>
              </select>
            )}
          </Field>
          <Field label="Name" required>{(id) => <input id={id} required maxLength={160} value={f.name} onChange={(e) => set("name", e.target.value)} />}</Field>
          <Field label="Model" required>{(id) => <input id={id} required maxLength={80} value={f.model} onChange={(e) => set("model", e.target.value)} />}</Field>
          <Field label="SKU" required hint="Unique in your company.">{(id) => <input id={id} required maxLength={80} value={f.sku} onChange={(e) => set("sku", e.target.value)} />}</Field>
        </div>
        <Field label="Description">{(id) => <textarea id={id} rows={2} maxLength={1000} value={f.description} onChange={(e) => set("description", e.target.value)} />}</Field>
        <Field label="Image" hint="JPG or PNG, up to 2 MB.">
          {(id) => (
            <label className="btn btn-secondary btn-sm" htmlFor={id} style={{ width: "fit-content" }}>
              <ImagePlus size={15} /> {file ? file.name : product?.imageUrl ? "Replace image" : "Choose image"}
              <input id={id} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => (setFile(e.target.files?.[0] ?? null), setError(checkImage(e.target.files?.[0], 2) ?? ""))} />
            </label>
          )}
        </Field>
        {file && !checkImage(file, 2) && <img className="proof-preview" src={URL.createObjectURL(file)} alt="Preview" />}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}
