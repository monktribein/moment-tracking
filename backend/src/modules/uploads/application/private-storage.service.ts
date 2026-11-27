import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

export type ImageType = { ext: "jpg" | "png"; mime: "image/jpeg" | "image/png" };

/** The real type of an image from its first bytes (the file name and the browser's content-type are not trusted). */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return { ext: "png", mime: "image/png" };
  return null;
}

export const MAX_PRIVATE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

/** Validates an uploaded image: real JPG/PNG, within the size limit. */
export function assertImage(file: { buffer?: Buffer; size?: number } | undefined, maxBytes: number): ImageType {
  if (!file?.buffer?.length) throw new BadRequestException('No file provided (expected form field "file")');
  if (file.buffer.length > maxBytes) throw new BadRequestException(`The image is ${(file.buffer.length / 1024 / 1024).toFixed(1)} MB. The limit is ${maxBytes / 1024 / 1024} MB.`);
  const type = sniffImage(file.buffer);
  if (!type) throw new BadRequestException("Only JPG and PNG images are accepted (checked from the file contents).");
  return type;
}

const hex = (b: Buffer | string) => (typeof b === "string" ? b : b.toString("hex"));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const encode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  pathStyle: boolean;
}

/**
 * Private file storage for payment proofs, receipts and complaint photos. Files are never
 * public: callers get a short-lived signed URL. STORAGE_DRIVER=local keeps files on disk and
 * serves them through GET /api/v1/files; STORAGE_DRIVER=s3 uses any S3-compatible bucket
 * (AWS S3, Supabase Storage S3, MinIO) with presigned GET URLs.
 */
@Injectable()
export class PrivateStorageService {
  private readonly logger = new Logger(PrivateStorageService.name);
  readonly driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  private readonly ttl = Number(process.env.STORAGE_URL_TTL_SECONDS) > 0 ? Number(process.env.STORAGE_URL_TTL_SECONDS) : 300;
  private readonly localDir = process.env.STORAGE_LOCAL_DIR || join(process.cwd(), "storage", "private");
  private readonly secret = process.env.STORAGE_SIGNING_SECRET || process.env.JWT_SECRET || "development-only-secret";
  private readonly publicBase = (process.env.STORAGE_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5100}`).replace(/\/+$/, "");

  private get s3(): S3Config {
    const c: S3Config = {
      endpoint: (process.env.STORAGE_S3_ENDPOINT ?? "").replace(/\/+$/, ""),
      region: process.env.STORAGE_S3_REGION ?? "us-east-1",
      bucket: process.env.STORAGE_S3_BUCKET ?? "",
      accessKey: process.env.STORAGE_S3_ACCESS_KEY ?? "",
      secretKey: process.env.STORAGE_S3_SECRET_KEY ?? "",
      pathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE !== "false",
    };
    if (!c.endpoint || !c.bucket || !c.accessKey || !c.secretKey) throw new ServiceUnavailableException("Private storage is not configured. Set STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY (or STORAGE_DRIVER=local).");
    return c;
  }

  /** Saves an image under `<company>/<scope>/<owner>/<yyyymm>/<random>.<ext>` and returns its key. */
  async storeImage(companyId: string, scope: string, ownerId: string, file: { buffer: Buffer }, maxBytes = MAX_PRIVATE_IMAGE_BYTES) {
    const type = assertImage(file, maxBytes);
    const safeScope = scope.replace(/[^a-z0-9_-]/gi, "").slice(0, 30) || "files";
    const key = `${companyId}/${safeScope}/${ownerId}/${new Date().toISOString().slice(0, 7).replace("-", "")}/${randomUUID()}.${type.ext}`;
    await this.put(key, file.buffer, type.mime);
    return { key, mime: type.mime, sizeBytes: file.buffer.length, sha256: sha256(file.buffer) };
  }

  private async put(key: string, body: Buffer, mime: string): Promise<void> {
    if (this.driver === "s3") {
      const url = this.s3Url(key);
      const headers = this.s3Sign("PUT", url, { "content-type": mime }, sha256(body));
      const response = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        this.logger.error(`S3 put failed: ${response.status}`);
        throw new ServiceUnavailableException("The file could not be stored. Please try again.");
      }
      return;
    }
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { mode: 0o600 });
  }

  private localPath(key: string): string {
    const path = normalize(join(this.localDir, key));
    if (!path.startsWith(normalize(this.localDir) + sep)) throw new BadRequestException("Invalid file key");
    return path;
  }

  /** A link that works for `ttl` seconds. */
  signedUrl(key: string): { url: string; expiresAt: string } {
    const expires = Math.floor(Date.now() / 1000) + this.ttl;
    if (this.driver === "s3") return { url: this.s3Presign(key, expires), expiresAt: new Date(expires * 1000).toISOString() };
    const sig = this.localSignature(key, expires);
    return { url: `${this.publicBase}/api/v1/files?key=${encode(key)}&exp=${expires}&sig=${sig}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  private localSignature(key: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${key}\n${exp}`).digest("hex");
  }

  /** Reads a local file for a valid, unexpired signed link. */
  async readSigned(key: string, exp: number, sig: string): Promise<{ body: Buffer; mime: string }> {
    const expected = Buffer.from(this.localSignature(key, exp));
    const given = Buffer.from(String(sig));
    if (this.driver !== "local" || exp * 1000 < Date.now() || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new NotFoundException("This link is invalid or has expired");
    try {
      return { body: await readFile(this.localPath(key)), mime: key.endsWith(".png") ? "image/png" : "image/jpeg" };
    } catch {
      throw new NotFoundException("File not found");
    }
  }

  // ---- S3 (AWS Signature V4, no SDK) ----
  private s3Url(key: string): string {
    const c = this.s3;
    const path = key.split("/").map(encode).join("/");
    if (c.pathStyle) return `${c.endpoint}/${c.bucket}/${path}`;
    const u = new URL(c.endpoint);
    return `${u.protocol}//${c.bucket}.${u.host}/${path}`;
  }

  private s3Key(date: string): Buffer {
    const c = this.s3;
    return hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, date.slice(0, 8)), c.region), "s3"), "aws4_request");
  }

  private s3Sign(method: string, url: string, extra: Record<string, string>, payloadHash: string): Record<string, string> {
    const c = this.s3;
    const u = new URL(url);
    const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const headers: Record<string, string> = { host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz, ...extra };
    const names = Object.keys(headers).sort();
    const canonical = [method, u.pathname, u.searchParams.toString(), names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${amz.slice(0, 8)}/${c.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n");
    const signature = hex(hmac(this.s3Key(amz), toSign));
    return { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
  }

  private s3Presign(key: string, expiresAtSeconds: number): string {
    const c = this.s3;
    const u = new URL(this.s3Url(key));
    const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const scope = `${amz.slice(0, 8)}/${c.region}/s3/aws4_request`;
    const params: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${c.accessKey}/${scope}`,
      "X-Amz-Date": amz,
      "X-Amz-Expires": String(Math.max(1, expiresAtSeconds - Math.floor(Date.now() / 1000))),
      "X-Amz-SignedHeaders": "host",
    };
    const query = Object.keys(params).sort().map((k) => `${encode(k)}=${encode(params[k])}`).join("&");
    const canonical = ["GET", u.pathname, query, `host:${u.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const signature = hex(hmac(this.s3Key(amz), ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n")));
    return `${u.protocol}//${u.host}${u.pathname}?${query}&X-Amz-Signature=${signature}`;
  }
}
