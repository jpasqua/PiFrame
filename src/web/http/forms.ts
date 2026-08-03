import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { parse as parseQueryString } from "node:querystring";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { MAX_UPLOAD_SIZE_BYTES, type StreamedUploadFile } from "../../services/photo-ingestion.js";

const MAX_FORM_SIZE_BYTES = 32 * 1024;

export async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("Unsupported form content type.");
  }

  const body = await readRequestBody(req, MAX_FORM_SIZE_BYTES);
  const parsed = parseQueryString(body.toString("utf8"));
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "")])
  );
}

export async function readMultipartUpload(
  req: IncomingMessage,
  tempDir: string
): Promise<{ fields: Record<string, string>; file: StreamedUploadFile | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const fields: Record<string, string> = {};
    let file: StreamedUploadFile | null = null;
    let hasFile = false;
    let temporaryPath: string | null = null;
    let writeTask: Promise<void> | null = null;
    let parserError: Error | null = null;

    const fail = async (error: Error): Promise<void> => {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      rejectPromise(error);
    };

    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 8, fieldSize: MAX_FORM_SIZE_BYTES, fileSize: MAX_UPLOAD_SIZE_BYTES + 1 } });
    } catch {
      rejectPromise(new Error("Unsupported upload form encoding."));
      return;
    }

    parser.on("field", (name, value) => { fields[name] = value; });
    parser.on("fieldsLimit", () => { parserError = new Error("Too many upload fields."); });
    parser.on("filesLimit", () => { parserError = new Error("Upload one image at a time."); });
    parser.on("file", (name, stream, info) => {
      if (name !== "photo" || hasFile) {
        parserError = new Error("Upload one image at a time.");
        stream.resume();
        return;
      }
      hasFile = true;
      const tempBasename = `${randomUUID()}.upload`;
      temporaryPath = resolve(tempDir, tempBasename);
      let fileSizeBytes = 0;
      let limitReached = false;
      stream.on("data", (chunk: Buffer) => { fileSizeBytes += chunk.length; });
      stream.on("limit", () => { limitReached = true; });
      writeTask = pipeline(stream, createWriteStream(temporaryPath, { flags: "wx" })).then(() => {
        if (limitReached || fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) throw new Error("Images must be 25 MB or smaller.");
        file = { filename: info.filename, contentType: info.mimeType, tempBasename, fileSizeBytes };
      });
    });
    parser.once("error", (error) => { parserError = error instanceof Error ? error : new Error("Could not read upload."); });
    parser.once("finish", async () => {
      try {
        await writeTask;
        if (parserError) throw parserError;
        resolvePromise({ fields, file });
      } catch (error) {
        await fail(error instanceof Error ? error : new Error("Could not read upload."));
      }
    });
    req.pipe(parser);
  });
}

export function requireFormValue(form: Record<string, string>, key: string): string {
  const value = form[key]?.trim();
  if (!value) throw new Error(`Missing form value: ${key}`);
  return value;
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > maxBytes) {
        rejectPromise(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", rejectPromise);
  });
}
