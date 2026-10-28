// Safe handling of the image attached to /schedule: metadata checks, a Discord-CDN-only
// download with size/time caps, and format detection from magic bytes (never trust the
// declared content type alone).
import type { Attachment } from "../discord/types.ts";
import { UserFacingError } from "../lib/errors.ts";

export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMimeType = (typeof SUPPORTED_IMAGE_TYPES)[number];

/** Matches Discord's default upload limit; base64 of this stays well under Gemini's inline request cap. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;
const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const UNSUPPORTED_MESSAGE = "Please upload a PNG, JPG, or WebP image of the event poster or screenshot.";

export interface DownloadedImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
}

/** Cheap checks on the attachment metadata, run before deferring the interaction. */
export function validateAttachment(attachment: Attachment | undefined): Attachment {
  if (!attachment) throw new UserFacingError("Please attach an image of the event.");

  const declared = attachment.content_type?.split(";")[0]?.trim().toLowerCase();
  const extensionOk = /\.(png|jpe?g|webp)$/i.test(attachment.filename);
  if (declared ? !isSupportedType(declared) : !extensionOk) throw new UserFacingError(UNSUPPORTED_MESSAGE);

  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new UserFacingError(`That image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB). Try a smaller screenshot.`);
  }
  if (attachment.size === 0) throw new UserFacingError("That image is empty.");

  let url: URL;
  try {
    url = new URL(attachment.url);
  } catch {
    throw new UserFacingError("I couldn't read that attachment. Please upload it again.");
  }
  // Only ever download from Discord's own CDN (prevents SSRF via crafted attachment URLs).
  if (url.protocol !== "https:" || !DISCORD_CDN_HOSTS.has(url.hostname)) {
    throw new UserFacingError("I couldn't read that attachment. Please upload it again.");
  }
  return attachment;
}

export async function downloadImage(attachment: Attachment): Promise<DownloadedImage> {
  let res: Response;
  try {
    // Workers only supports "follow" | "manual"; any redirect (3xx) counts as a failed download below.
    res = await fetch(attachment.url, { redirect: "manual", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new UserFacingError("I couldn't download that image from Discord. Please try again.");
  }
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel();
    throw new UserFacingError("I couldn't download that image from Discord. Please try again.");
  }

  const bytes = await readCapped(res.body, MAX_IMAGE_BYTES);
  const mimeType = detectImageType(bytes);
  if (!mimeType) throw new UserFacingError(`That file isn't a valid image. ${UNSUPPORTED_MESSAGE}`);
  return { bytes, mimeType };
}

/** Identifies PNG / JPEG / WebP from file signatures. */
export function detectImageType(bytes: Uint8Array): ImageMimeType | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Native base64 (workerd supports Uint8Array#toBase64), avoiding a slow JS loop on large images. */
export function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (native) return native.call(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function isSupportedType(type: string): boolean {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(type) || type === "image/jpg";
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UserFacingError(`That image is too large (max ${maxBytes / 1024 / 1024} MB).`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
