/* A 64-bit difference hash: survives re-encoding, resizing and renaming, so a recompressed copy of an
   excluded image is still recognised. Shared by fetch-originals.mjs, process-images.mjs and
   check-images.mjs so all three compute the same value. */
import sharp from "sharp";

export async function dHash(input) {
  const px = await sharp(input).flatten({ background: "#ffffff" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

export function hamming(a, b) {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}
