import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2, ClipboardList, Clock, FileCheck2, History, Home, LogOut, Package, PackageCheck, Plus, Search, ShoppingCart, Trash2, UserRound } from "lucide-react";
import { useAuth } from "../../auth";
import { eco, type EcoUser, type Row } from "../../eco/api";
import { viewerFromEco } from "../../eco/access";
import { inDateTime, words } from "../../eco/format";
import { PurchaseForm } from "../../eco/PurchaseForm";
import { RequestDetail } from "../../eco/RequestDetail";
import { KV, StatusBadge, usePaged } from "../../eco/ui";
import { Button, Empty, ErrorBox, Pagination, PageHeader, Spinner, Tabs } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

// ── Cart: products picked on the product list, carried into New request (this tab only) ──

type Cart = Record<string, number>;
const CART_KEY = "eco-portal-cart";
const readCart = (): Cart => {
  try {
    return JSON.parse(sessionStorage.getItem(CART_KEY) ?? "{}") as Cart;
  } catch {
    return {};
  }
};
function useCart() {
  const [cart, setCart] = useState<Cart>(readCart);
  useEffect(() => sessionStorage.setItem(CART_KEY, JSON.stringify(cart)), [cart]);
  return {
    cart,
    count: Object.values(cart).reduce((a, b) => a + b, 0),
    add: (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 })),
    remove: (id: string) => setCart((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== id))),
    clear: () => (sessionStorage.removeItem(CART_KEY), setCart({})),
  };
}

/** The distributor portal (design page 5): own requests and payments only, mobile first with a bottom bar. */
export default function Portal({ user }: { user: EcoUser }) {
  const { signOut } = useAuth();
  return (
    <div className="portal">
      <header className="portal-top">
        <span className="eco-wordmark" style={{ color: "#fff", fontSize: 20 }}>
          <span className="eco-bolt">⚡</span>ECO <span className="eco-accent">SOR</span>
        </span>
        <span className="spacer" />
        <span className="brand-sub" style={{ color: "#dbe4ff" }}>{user.name}</span>
        <button type="button" className="icon-btn" onClick={() => signOut()} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </header>
      <nav className="portal-nav" aria-label="Portal">
        <NavLink to="/portal" end><Home size={18} /> Home</NavLink>
        <NavLink to="/portal/requests"><History size={18} /> Orders</NavLink>
        <NavLink to="/portal/products"><Package size={18} /> Products</NavLink>
        <NavLink to="/portal/new"><Plus size={18} /> New</NavLink>
        <NavLink to="/portal/profile"><UserRound size={18} /> Profile</NavLink>
      </nav>
      <main className="portal-main">
        <Routes>
          <Route path="/portal" element={<PortalHome user={user} />} />
          <Route path="/portal/new" element={<NewRequest />} />
          <Route path="/portal/done/:id" element={<Confirmation />} />
          <Route path="/portal/requests" element={<MyRequests />} />
          <Route path="/portal/requests/:id" element={<PortalRequest user={user} />} />
          <Route path="/portal/products" element={<PortalProducts />} />
          <Route path="/portal/profile" element={<Profile user={user} />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function PortalHome({ user }: { user: EcoUser }) {
  const navigate = useNavigate();
  const d = useAsync(() => eco.dashboard("distributor"), []);
  const x = d.data;
  const firm = useAsync(() => (user.distributorId ? eco.distributor(user.distributorId) : Promise.resolve(null)), [user.distributorId]);
  return (
    <>
      <div className="glance-hero">
        <h2>Welcome, {firm.data?.firmName ?? user.name}</h2>
        <p>Distributor{firm.data?.city ? ` · ${firm.data.city}` : ""}</p>
      </div>
      {d.error ? (
        <ErrorBox error={d.error} onRetry={() => d.reload()} />
      ) : !x ? (
        <Spinner />
      ) : (
        <>
          <h3 style={{ margin: "4px 0 10px" }}>Your business at a glance</h3>
          <div className="glance-grid">
            <button type="button" className="glance-tile kpi-card-orange" onClick={() => navigate("/portal/requests")}>
              <span className="quick-icon kpi-orange"><Clock size={20} /></span>
              <b>{x.pending}</b> Pending requests
            </button>
            <button type="button" className="glance-tile kpi-card-blue" onClick={() => navigate("/portal/requests")}>
              <span className="quick-icon kpi-blue"><ClipboardList size={20} /></span>
              <b>{x.totalRequests}</b> My orders
            </button>
            <button type="button" className="glance-tile kpi-card-green" onClick={() => navigate("/portal/requests")}>
              <span className="quick-icon kpi-green"><FileCheck2 size={20} /></span>
              <b>{x.approved}</b> Approved
            </button>
            <button type="button" className="glance-tile kpi-card-violet" onClick={() => navigate("/portal/requests")}>
              <span className="quick-icon kpi-violet"><PackageCheck size={20} /></span>
              <b>{x.processed}</b> Processed
            </button>
          </div>
          {x.byStatus?.correction_required > 0 && <ErrorBox error={`${x.byStatus.correction_required} request(s) need a correction. Open them under Orders.`} />}
          <Button variant="primary" className="btn-block btn-orange" icon={<ShoppingCart size={16} />} onClick={() => navigate("/portal/products")}>
            Browse products &amp; order
          </Button>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head"><h2>Recent orders</h2></div>
            {!x.recent?.length ? <Empty title="No orders yet" icon={<ClipboardList size={28} />}>Pick products and send your first request.</Empty> : <RequestCards rows={x.recent} />}
          </div>
        </>
      )}
    </>
  );
}

function RequestCards({ rows }: { rows: Row[] }) {
  const navigate = useNavigate();
  return (
    <div className="portal-card-list">
      {rows.map((r) => (
        <button key={r.id} type="button" className="portal-request" onClick={() => navigate(`/portal/requests/${r.id}`)}>
          <div>
            <div className="cell-title mono">{r.requestNo}</div>
            <div className="cell-sub">{inDateTime(r.createdAt)}{r.totalQuantity !== undefined ? ` · ${r.totalQuantity} unit(s)` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <StatusBadge status={r.status} />
            <div className="cell-sub">Payment: {words(r.paymentStatus)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function PortalProducts() {
  const navigate = useNavigate();
  const { cart, count, add } = useCart();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const term = useDebounced(search.trim());
  const list = usePaged((page) => eco.products({ page, limit: 24, search: term, category, sort: "name", order: "asc" }), [term, category]);
  return (
    <>
      <PageHeader title="Request order" subtitle="Tap + to add a product. Quantities can be changed on the next step." />
      <Tabs value={category} onChange={(c) => (setCategory(c), list.setPage(1))} items={[{ value: "", label: "All" }, { value: "inverter", label: "Inverters" }, { value: "battery", label: "Batteries" }]} />
      <div className="search" style={{ margin: "10px 0" }}>
        <Search size={16} />
        <input placeholder="Search products…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
      </div>
      {list.error ? <ErrorBox error={list.error} /> : !list.data ? <Spinner /> : !list.data.items.length ? <Empty title="No products" /> : (
        <>
          <div className="product-grid">
            {list.data.items.map((p) => (
              <div key={p.id} className="product-card">
                {p.imageUrl ? <img className="product-thumb" src={p.imageUrl} alt="" /> : <span className="product-thumb"><Package size={22} className="muted" /></span>}
                <div className="grow">
                  <div className="cell-title">{p.name}</div>
                  <div className="cell-sub">{p.model} · <span className="mono">{p.sku}</span></div>
                  {cart[p.id] ? <div className="cell-sub text-green">{cart[p.id]} in cart</div> : null}
                </div>
                <button type="button" className={`add-btn${cart[p.id] ? " added" : ""}`} onClick={() => add(p.id)} aria-label={`Add ${p.name}`}>
                  {cart[p.id] ? <Check size={18} /> : <Plus size={18} />}
                </button>
              </div>
            ))}
          </div>
          <Pagination page={list.data.meta.page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={list.setPage} />
        </>
      )}
      {count > 0 && (
        <div className="cart-bar">
          <span><b>{count}</b> item(s) in cart</span>
          <Button className="btn-orange" icon={<ShoppingCart size={16} />} onClick={() => navigate("/portal/new")}>Continue</Button>
        </div>
      )}
    </>
  );
}

function NewRequest() {
  const navigate = useNavigate();
  const { cart, remove, clear } = useCart();
  const initial = Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity }));
  // The form reads the cart once; changing the cart afterwards remounts it.
  const [key] = useState(() => JSON.stringify(initial));
  return (
    <>
      <PageHeader title="New purchase request" subtitle="Products and quantities, then the payment details and proof." />
      {initial.length > 0 && (
        <p className="muted small inline-gap">
          {initial.length} product(s) from your cart.
          <button type="button" className="link-button" onClick={() => (clear(), navigate(0))}><Trash2 size={13} /> Clear cart</button>
        </p>
      )}
      <PurchaseForm key={key} initialItems={initial} onDone={(r) => (initial.forEach((i) => remove(i.productId)), clear(), navigate(`/portal/done/${r.id}`, { replace: true }))} />
    </>
  );
}

function Confirmation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const r = useAsync(() => eco.request(id), [id]);
  return (
    <div className="card confirm-hero">
      <CheckCircle2 size={48} className="text-green" />
      <h2>Order request submitted</h2>
      {r.data ? <div className="request-no">{r.data.requestNo}</div> : <Spinner />}
      <p className="muted">Keep this request ID. We verify your payment with the bank and then approve the order. You will get WhatsApp updates.</p>
      <div className="button-row" style={{ justifyContent: "center" }}>
        <Button variant="primary" onClick={() => navigate(`/portal/requests/${id}`)}>Track order</Button>
        <Button onClick={() => navigate("/portal/products")}>Another request</Button>
      </div>
    </div>
  );
}

function MyRequests() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const list = usePaged((page) => eco.requests({ page, limit: 15, status, search: term }), [status, term]);
  return (
    <>
      <PageHeader title="My orders" />
      <Tabs
        value={status}
        onChange={(s) => (setStatus(s), list.setPage(1))}
        items={[{ value: "", label: "All" }, { value: "correction_required", label: "Needs correction" }, { value: "under_review", label: "In review" }, { value: "approved", label: "Approved" }, { value: "processed", label: "Processed" }]}
      />
      <div className="search" style={{ margin: "10px 0" }}>
        <Search size={16} />
        <input placeholder="Request ID" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
      </div>
      {list.error ? <ErrorBox error={list.error} onRetry={() => list.reload()} /> : !list.data ? <Spinner /> : !list.data.items.length ? <Empty title="No orders" /> : (
        <>
          <RequestCards rows={list.data.items} />
          <Pagination page={list.data.meta.page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={list.setPage} />
        </>
      )}
    </>
  );
}

/** Order tracking steps like the design: requested → under review → approved → processed. */
function OrderTracker({ id }: { id: string }) {
  const r = useAsync(() => eco.request(id), [id]);
  const h = useAsync(() => eco.requestHistory(id), [id]);
  if (!r.data) return null;
  const status: string = r.data.status;
  const when = (to: string[]) => (h.data?.statusLog ?? []).find((l: Row) => to.includes(l.toStatus))?.at;
  const failed = ["rejected", "cancelled"].includes(status);
  const steps = [
    { label: "Order requested", at: when(["submitted"]), done: !["draft"].includes(status) },
    { label: status === "correction_required" ? "Correction needed" : "Under review", at: when(["under_review", "correction_required"]), done: ["under_review", "approved", "processed"].includes(status), warn: status === "correction_required" },
    { label: failed ? words(status) : "Approved", at: when(failed ? [status] : ["approved"]), done: ["approved", "processed"].includes(status), warn: failed },
    { label: "Processed", at: when(["processed"]), done: status === "processed" },
  ];
  return (
    <div className="card">
      <div className="card-head"><h2>Track order</h2><StatusBadge status={status} /></div>
      <ol className="eco-timeline">
        {steps.map((s) => (
          <li key={s.label} className={s.warn ? "eco-tl-red" : s.done ? "eco-tl-green" : "eco-tl-gray"}>
            <span className="eco-timeline-dot" />
            <div>
              <div className="eco-timeline-title" style={{ color: s.done || s.warn ? undefined : "#94a3b8" }}>{s.label}</div>
              <div className="cell-sub">{s.at ? inDateTime(s.at) : s.done ? "" : "Waiting"}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PortalRequest({ user }: { user: EcoUser }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <Button size="sm" icon={<ArrowLeft size={15} />} onClick={() => (location.key === "default" ? navigate("/portal/requests") : navigate(-1))}>Back</Button>
      <div style={{ height: 10 }} />
      <OrderTracker id={id} />
      <RequestDetail id={id} viewer={viewerFromEco(user)} portal />
    </>
  );
}

function Profile({ user }: { user: EcoUser }) {
  const d = useAsync(() => (user.distributorId ? eco.distributor(user.distributorId) : Promise.reject(new Error("This login is not linked to a distributor."))), [user.distributorId]);
  return (
    <>
      <PageHeader title="Profile" subtitle="To change these details, contact your Eco Sor executive." />
      <div className="card">
        {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Spinner /> : (
          <KV
            items={[
              ["Firm", d.data.firmName],
              ["Distributor code", d.data.distributorCode],
              ["Contact person", d.data.contactPerson],
              ["Mobile", d.data.mobile],
              ["Email", d.data.email],
              ["GSTIN", d.data.gstin],
              ["Address", [d.data.address, d.data.city, d.data.state, d.data.pin].filter(Boolean).join(", ")],
              ["Your executive", d.data.executiveName],
            ]}
          />
        )}
      </div>
    </>
  );
}
