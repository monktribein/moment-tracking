import { parseCsv, toCsv } from "./csv";
import { otpPolicy, otpUsable } from "./otp";
import { mapHeaders, validateImportRow } from "../../modules/distributors/domain/distributor-rules";
import { categoryFitsProduct, nextComplaintStatus } from "../../modules/customers-complaints/domain/complaint-state";
import { canVisitMove, readFix } from "../../modules/sales/domain/visit-state";
import { sniffImage } from "../../modules/uploads/application/private-storage.service";
import { redactForAudit } from "../../modules/audit/application/audit.service";

describe("OTP rules", () => {
  const future = new Date(Date.now() + 60_000);
  const base = { expiresAt: future, attempts: 0, maxAttempts: 5, verifiedAt: null, invalidatedAt: null, deliveryStatus: "sent" };

  it("defaults to 6 digits, 10 minutes, 5 attempts and 3 sends an hour", () => {
    expect(otpPolicy({})).toMatchObject({ length: 6, ttlMinutes: 10, maxAttempts: 5, maxSendsPerHour: 3 });
  });

  it("allows a fresh code and refuses expired, locked, used and undelivered ones", () => {
    expect(otpUsable(base)).toBe("ok");
    expect(otpUsable({ ...base, expiresAt: new Date(Date.now() - 1) })).toBe("expired");
    expect(otpUsable({ ...base, attempts: 5 })).toBe("locked");
    expect(otpUsable({ ...base, verifiedAt: new Date() })).toBe("used");
    expect(otpUsable({ ...base, invalidatedAt: new Date() })).toBe("used");
    expect(otpUsable({ ...base, deliveryStatus: "failed" })).toBe("undelivered");
  });
});

describe("complaint flow", () => {
  it("follows open -> assigned -> in_progress -> resolved -> closed", () => {
    expect(nextComplaintStatus("open", "assign")).toBe("assigned");
    expect(nextComplaintStatus("assigned", "check_in")).toBe("in_progress");
    expect(nextComplaintStatus("in_progress", "report_resolved")).toBe("resolved");
    expect(nextComplaintStatus("resolved", "close")).toBe("closed");
  });

  it("supports pending and reopened", () => {
    expect(nextComplaintStatus("in_progress", "report_pending")).toBe("pending");
    expect(nextComplaintStatus("pending", "check_in")).toBe("in_progress");
    expect(nextComplaintStatus("closed", "reopen")).toBe("reopened");
    expect(nextComplaintStatus("reopened", "assign")).toBe("assigned");
  });

  it("cannot close before it is resolved, or act on a closed complaint", () => {
    for (const from of ["open", "assigned", "in_progress", "pending", "closed", "reopened"]) expect(nextComplaintStatus(from, "close")).toBeNull();
    expect(nextComplaintStatus("closed", "assign")).toBeNull();
    expect(nextComplaintStatus("open", "check_in")).toBeNull();
  });

  it("keeps the issue category consistent with the product", () => {
    expect(categoryFitsProduct("inverter_error_code", "inverter")).toBe(true);
    expect(categoryFitsProduct("battery_low_backup", "inverter")).toBe(false);
    expect(categoryFitsProduct("other_inverter_battery", "battery")).toBe(true);
  });
});

describe("sales visits", () => {
  it("moves scheduled -> checked_in -> report_submitted -> completed", () => {
    expect(canVisitMove("scheduled", "checked_in")).toBe(true);
    expect(canVisitMove("checked_in", "report_submitted")).toBe(true);
    expect(canVisitMove("report_submitted", "completed")).toBe(true);
    expect(canVisitMove("scheduled", "completed")).toBe(false);
    expect(canVisitMove("checked_in", "cancelled")).toBe(false);
    expect(canVisitMove("scheduled", "rescheduled")).toBe(true);
    expect(canVisitMove("completed", "cancelled")).toBe(false);
  });

  it("accepts a real GPS fix and refuses empty or impossible ones", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(readFix({ lat: 27.5, lng: 77.68, accuracy: 12 }, now)).toMatchObject({ lat: 27.5, lng: 77.68, accuracy: 12 });
    expect(readFix({ lat: 0, lng: 0 }, now)).toBeNull();
    expect(readFix({ lat: 95, lng: 10 }, now)).toBeNull();
    expect(readFix({ lat: Number.NaN, lng: 10 }, now)).toBeNull();
  });

  it("trusts the phone clock only within 10 minutes of the server's", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    expect(readFix({ lat: 1, lng: 1, timestamp: "2026-11-27T09:55:00Z" }, now)!.at.toISOString()).toBe("2026-11-27T09:55:00.000Z");
    expect(readFix({ lat: 1, lng: 1, timestamp: "2026-11-27T08:00:00Z" }, now)!.at).toEqual(now);
    expect(readFix({ lat: 1, lng: 1, timestamp: "garbage" }, now)!.at).toEqual(now);
  });
});

describe("images", () => {
  it("recognises JPEG and PNG by content, not by name", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    expect(sniffImage(Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(8)]))).toEqual({ ext: "png", mime: "image/png" });
    expect(sniffImage(Buffer.from("GIF89a....."))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg></svg>"))).toBeNull();
  });
});

describe("CSV", () => {
  it("parses quotes, commas, newlines in cells, CRLF and a BOM", () => {
    const rows = parseCsv('﻿firm_name,mobile\r\n"Sharma, Sons",9876543210\r\n"Line\nbreak","He said ""hi"""\r\n');
    expect(rows).toEqual([["firm_name", "mobile"], ["Sharma, Sons", "9876543210"], ["Line\nbreak", 'He said "hi"']]);
  });

  it("writes CSV and neutralises spreadsheet formulas", () => {
    const text = toCsv([{ a: "x,y", b: "=SUM(A1)", c: null, d: new Date("2026-01-02T00:00:00Z") }], ["a", "b", "c", "d"]);
    expect(text).toBe('a,b,c,d\r\n"x,y",\'=SUM(A1),,2026-01-02T00:00:00.000Z\r\n');
  });
});

describe("distributor CSV import", () => {
  it("maps header names to fields and lists unknown ones", () => {
    const { columns, unknown } = mapHeaders(["Firm Name", "contact_person", "MOBILE", "Pincode", "colour"]);
    expect(columns).toEqual(["firmName", "contactPerson", "mobile", "pin", null]);
    expect(unknown).toEqual(["colour"]);
  });

  it("accepts a good row", () => {
    const { value, errors } = validateImportRow({ firmName: "Sharma Power", contactPerson: "Ramesh", mobile: "+91 98765 43210", gstin: "07abcde1234f1z5", pin: "302001" });
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ mobile: "9876543210", gstin: "07ABCDE1234F1Z5" });
  });

  it("reports every problem of a bad row", () => {
    const { value, errors } = validateImportRow({ firmName: "", contactPerson: "", mobile: "12345", email: "nope", gstin: "short", pin: "12" });
    expect(value).toBeUndefined();
    expect(errors).toHaveLength(6);
  });
});

describe("audit redaction", () => {
  it("blanks secrets before they reach the audit log", () => {
    expect(redactForAudit({ name: "A", passwordHash: "x", nested: { otp: "123456", storageKey: "k", amount: 5 }, list: [{ token: "t" }] })).toEqual({ name: "A", passwordHash: "[redacted]", nested: { otp: "[redacted]", storageKey: "[redacted]", amount: 5 }, list: [{ token: "[redacted]" }] });
  });
});
