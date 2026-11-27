import { isEditable, isPlausibleUtr, itemsProblem, nextStatus, normalizeUtr, PURCHASE_STATUSES } from "./purchase-state";

describe("purchase request state machine", () => {
  it("follows draft -> submitted -> under_review -> approved -> processed", () => {
    expect(nextStatus("draft", "submit")).toBe("submitted");
    expect(nextStatus("submitted", "verify_payment")).toBe("under_review");
    expect(nextStatus("under_review", "approve")).toBe("approved");
    expect(nextStatus("approved", "process")).toBe("processed");
  });

  it("sends a rejected payment to correction and back to review on resubmit", () => {
    expect(nextStatus("under_review", "reject_payment")).toBe("correction_required");
    expect(nextStatus("correction_required", "resubmit")).toBe("under_review");
  });

  it("cannot approve before the payment review, or skip steps", () => {
    for (const from of ["draft", "submitted", "correction_required", "approved", "rejected", "cancelled", "processed"]) expect(nextStatus(from, "approve")).toBeNull();
    expect(nextStatus("draft", "process")).toBeNull();
    expect(nextStatus("submitted", "process")).toBeNull();
  });

  it("treats rejected, cancelled and processed as final", () => {
    for (const from of ["rejected", "cancelled", "processed"])
      for (const action of ["submit", "verify_payment", "reject_payment", "resubmit", "approve", "reject", "cancel", "process"] as const) expect(nextStatus(from, action)).toBeNull();
  });

  it("cannot cancel or reject an approved request", () => {
    expect(nextStatus("approved", "cancel")).toBeNull();
    expect(nextStatus("approved", "reject")).toBeNull();
  });

  it("allows editing only drafts and requests sent back for correction", () => {
    for (const s of PURCHASE_STATUSES) expect(isEditable(s)).toBe(s === "draft" || s === "correction_required");
  });
});

describe("transaction reference (UTR)", () => {
  it("is upper-cased with spaces and symbols removed", () => {
    expect(normalizeUtr(" utr-12 34/ab ")).toBe("UTR1234AB");
    expect(normalizeUtr("abc 123")).toBe("ABC123");
  });

  it("needs at least 6 characters once normalized", () => {
    expect(isPlausibleUtr("12-34")).toBe(false);
    expect(isPlausibleUtr("1234 5678 9012")).toBe(true);
    expect(isPlausibleUtr("---")).toBe(false);
  });
});

describe("item list", () => {
  it("needs items, whole positive quantities and no repeated product", () => {
    expect(itemsProblem([])).toMatch(/at least one/i);
    expect(itemsProblem([{ productId: "a", quantity: 0 }])).toMatch(/positive whole/i);
    expect(itemsProblem([{ productId: "a", quantity: 1.5 }])).toMatch(/positive whole/i);
    expect(itemsProblem([{ productId: "a", quantity: -2 }])).toMatch(/positive whole/i);
    expect(itemsProblem([{ productId: "a", quantity: 1 }, { productId: "a", quantity: 2 }])).toMatch(/only once/i);
    expect(itemsProblem([{ productId: "a", quantity: 1 }, { productId: "b", quantity: 20 }])).toBeNull();
  });
});
