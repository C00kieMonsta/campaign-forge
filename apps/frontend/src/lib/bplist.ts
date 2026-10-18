/**
 * Reader for Apple binary property lists (the "bplist00" format every .abcdp record uses).
 * Dependency-free so it can run in the browser and in Jest alike.
 */

export type PlistValue =
  | null
  | boolean
  | number
  | string
  | Date
  | Uint8Array
  | PlistUid
  | PlistValue[]
  | PlistDict;

export interface PlistDict {
  [key: string]: PlistValue;
}

/** A keyed-archiver object reference. Kept distinct from a number so callers can tell them apart. */
export class PlistUid {
  constructor(readonly id: number) {}
}

const MAGIC = "bplist";
const HEADER_SIZE = 8;
const TRAILER_SIZE = 32;
/** Milliseconds between the Unix epoch and the Apple epoch (2001-01-01T00:00:00Z). */
const APPLE_EPOCH_MS = 978307200000;
/** Nesting deeper than this is treated as malformed rather than left to overflow the call stack. */
const MAX_DEPTH = 1024;
/** Code units per String.fromCharCode call. */
const CHUNK = 4096;

/** True when the bytes start with the "bplist" magic. */
export function isBinaryPlist(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/** Decodes a binary plist. Throws a plain Error on malformed input, never hangs. */
export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
  return new Reader(bytes).readTop();
}

class Reader {
  private readonly view: DataView;
  private readonly offsets: number[];
  /** Objects must end before the offset table starts. */
  private readonly objectsEnd: number;
  private readonly refSize: number;
  private readonly topObject: number;
  /** Indexes of the containers currently being decoded, for cycle detection. */
  private readonly stack: number[] = [];

  constructor(private readonly bytes: Uint8Array) {
    if (!isBinaryPlist(bytes)) throw new Error("Not a binary plist");
    if (bytes.length < HEADER_SIZE + TRAILER_SIZE) {
      throw new Error("Binary plist is truncated");
    }
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const trailer = bytes.length - TRAILER_SIZE;
    const offsetIntSize = bytes[trailer + 6];
    this.refSize = bytes[trailer + 7];
    const numObjects = this.readUInt64(trailer + 8);
    this.topObject = this.readUInt64(trailer + 16);
    const tableOffset = this.readUInt64(trailer + 24);

    if (offsetIntSize < 1 || offsetIntSize > 8) {
      throw new Error("Binary plist has an invalid offset size");
    }
    if (this.refSize < 1 || this.refSize > 8) {
      throw new Error("Binary plist has an invalid reference size");
    }
    if (numObjects < 1) throw new Error("Binary plist has no objects");
    if (this.topObject >= numObjects) {
      throw new Error("Binary plist top object is out of range");
    }
    if (
      tableOffset < HEADER_SIZE ||
      tableOffset + numObjects * offsetIntSize > trailer
    ) {
      throw new Error("Binary plist offset table is out of range");
    }
    this.objectsEnd = tableOffset;

    this.offsets = new Array<number>(numObjects);
    for (let i = 0; i < numObjects; i++) {
      const offset = this.readUInt(
        tableOffset + i * offsetIntSize,
        offsetIntSize,
        trailer
      );
      if (offset < HEADER_SIZE || offset >= tableOffset) {
        throw new Error("Binary plist object offset is out of range");
      }
      this.offsets[i] = offset;
    }
  }

  readTop(): PlistValue {
    return this.readObject(this.topObject);
  }

  /** Throws unless the bytes at pos..pos+length lie inside the object area. */
  private need(pos: number, length: number, limit = this.objectsEnd): void {
    if (pos < 0 || length < 0 || pos + length > limit) {
      throw new Error("Binary plist object runs past the end");
    }
  }

  /** Unsigned big-endian integer. The offset table passes the trailer as its limit. */
  private readUInt(pos: number, size: number, limit = this.objectsEnd): number {
    if (size === 8) return this.readUInt64(pos);
    this.need(pos, size, limit);
    let value = 0;
    for (let i = 0; i < size; i++) value = value * 256 + this.bytes[pos + i];
    return value;
  }

  private readUInt64(pos: number): number {
    if (pos < 0 || pos + 8 > this.bytes.length) {
      throw new Error("Binary plist object runs past the end");
    }
    const hi = this.view.getUint32(pos, false);
    const lo = this.view.getUint32(pos + 4, false);
    return hi * 2 ** 32 + lo;
  }

  /** Signed 64-bit value, exact up to 2^53. */
  private readInt64(pos: number): number {
    this.need(pos, 8);
    const hi = this.view.getInt32(pos, false);
    const lo = this.view.getUint32(pos + 4, false);
    return hi * 2 ** 32 + lo;
  }

  /** Integer object payload: 1, 2 and 4 bytes are unsigned, 8 and 16 bytes are signed. */
  private readIntPayload(pos: number, size: number): number {
    if (size === 1 || size === 2 || size === 4) return this.readUInt(pos, size);
    if (size === 8) return this.readInt64(pos);
    if (size === 16) {
      this.need(pos, 16);
      return this.readInt64(pos + 8);
    }
    throw new Error("Binary plist integer has an unsupported size");
  }

  /** Reads an integer object at pos and returns its value and the position after it. */
  private readIntObject(pos: number): { value: number; next: number } {
    this.need(pos, 1);
    const marker = this.bytes[pos];
    if (marker >> 4 !== 0x1)
      throw new Error("Binary plist count is not an integer");
    const size = 1 << (marker & 0x0f);
    return { value: this.readIntPayload(pos + 1, size), next: pos + 1 + size };
  }

  /** Resolves the marker's count nibble, reading the extended count when it is 0xF. */
  private readCount(pos: number, low: number): { count: number; next: number } {
    if (low !== 0x0f) return { count: low, next: pos + 1 };
    const { value, next } = this.readIntObject(pos + 1);
    if (value < 0) throw new Error("Binary plist count is negative");
    return { count: value, next };
  }

  private readRef(pos: number): number {
    const ref = this.readUInt(pos, this.refSize);
    if (ref >= this.offsets.length) {
      throw new Error("Binary plist reference is out of range");
    }
    return ref;
  }

  private readObject(index: number): PlistValue {
    if (index >= this.offsets.length) {
      throw new Error("Binary plist reference is out of range");
    }
    const pos = this.offsets[index];
    this.need(pos, 1);
    const marker = this.bytes[pos];
    const type = marker >> 4;
    const low = marker & 0x0f;

    switch (type) {
      case 0x0:
        if (marker === 0x00 || marker === 0x0f) return null;
        if (marker === 0x08) return false;
        if (marker === 0x09) return true;
        throw new Error("Binary plist has an unknown singleton marker");
      case 0x1:
        return this.readIntPayload(pos + 1, 1 << low);
      case 0x2:
        return this.readReal(pos + 1, low);
      case 0x3:
        if (low !== 0x3)
          throw new Error("Binary plist date has an unsupported size");
        return new Date(
          Math.round(this.readReal(pos + 1, 3) * 1000) + APPLE_EPOCH_MS
        );
      case 0x4:
        return this.readData(pos, low);
      case 0x5:
        return this.readAscii(pos, low);
      case 0x6:
        return this.readUtf16(pos, low);
      case 0x7:
        return this.readUtf8(pos, low);
      case 0x8:
        return new PlistUid(this.readUInt(pos + 1, low + 1));
      case 0xa:
      case 0xb:
      case 0xc:
        return this.readArray(index, pos, low);
      case 0xd:
        return this.readDict(index, pos, low);
      default:
        throw new Error("Binary plist has an unknown object marker");
    }
  }

  private readReal(pos: number, low: number): number {
    if (low === 0x2) {
      this.need(pos, 4);
      return this.view.getFloat32(pos, false);
    }
    if (low === 0x3) {
      this.need(pos, 8);
      return this.view.getFloat64(pos, false);
    }
    throw new Error("Binary plist real has an unsupported size");
  }

  private readData(pos: number, low: number): Uint8Array {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count);
    return this.bytes.slice(next, next + count);
  }

  private readAscii(pos: number, low: number): string {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count);
    let out = "";
    for (let start = next; start < next + count; start += CHUNK) {
      const end = Math.min(start + CHUNK, next + count);
      const units: number[] = [];
      for (let i = start; i < end; i++) units.push(this.bytes[i]);
      out += String.fromCharCode.apply(null, units);
    }
    return out;
  }

  /** Count is in UTF-16 code units, so the payload is twice as long. */
  private readUtf16(pos: number, low: number): string {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count * 2);
    let out = "";
    for (let start = 0; start < count; start += CHUNK) {
      const end = Math.min(start + CHUNK, count);
      const units: number[] = [];
      for (let i = start; i < end; i++) {
        const at = next + i * 2;
        units.push((this.bytes[at] << 8) | this.bytes[at + 1]);
      }
      out += String.fromCharCode.apply(null, units);
    }
    return out;
  }

  /** Count is in bytes. Malformed sequences decode to U+FFFD. */
  private readUtf8(pos: number, low: number): string {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count);
    const end = next + count;
    let out = "";
    let i = next;
    while (i < end) {
      const b0 = this.bytes[i];
      let cp: number;
      let extra: number;
      if (b0 < 0x80) {
        cp = b0;
        extra = 0;
      } else if ((b0 & 0xe0) === 0xc0) {
        cp = b0 & 0x1f;
        extra = 1;
      } else if ((b0 & 0xf0) === 0xe0) {
        cp = b0 & 0x0f;
        extra = 2;
      } else if ((b0 & 0xf8) === 0xf0) {
        cp = b0 & 0x07;
        extra = 3;
      } else {
        out += "�";
        i++;
        continue;
      }
      if (i + extra >= end) {
        out += "�";
        i++;
        continue;
      }
      let valid = true;
      for (let k = 1; k <= extra; k++) {
        const b = this.bytes[i + k];
        if ((b & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        cp = (cp << 6) | (b & 0x3f);
      }
      if (!valid) {
        out += "�";
        i++;
        continue;
      }
      i += extra + 1;
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  private enter(index: number): void {
    if (this.stack.indexOf(index) !== -1) {
      throw new Error("Binary plist contains a reference cycle");
    }
    if (this.stack.length >= MAX_DEPTH) {
      throw new Error("Binary plist is nested too deeply");
    }
    this.stack.push(index);
  }

  private leave(): void {
    this.stack.pop();
  }

  /** Arrays, ordered sets and sets all decode to a plain array. */
  private readArray(index: number, pos: number, low: number): PlistValue[] {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count * this.refSize);
    this.enter(index);
    const out: PlistValue[] = new Array<PlistValue>(count);
    for (let i = 0; i < count; i++) {
      out[i] = this.readObject(this.readRef(next + i * this.refSize));
    }
    this.leave();
    return out;
  }

  /** Count key references come first, then count value references. */
  private readDict(index: number, pos: number, low: number): PlistDict {
    const { count, next } = this.readCount(pos, low);
    this.need(next, count * 2 * this.refSize);
    this.enter(index);
    const out: PlistDict = {};
    for (let i = 0; i < count; i++) {
      const key = this.readObject(this.readRef(next + i * this.refSize));
      const value = this.readObject(
        this.readRef(next + (count + i) * this.refSize)
      );
      out[typeof key === "string" ? key : String(key)] = value;
    }
    this.leave();
    return out;
  }
}
