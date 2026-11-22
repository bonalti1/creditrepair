// A QR code for a partner's link, drawn as SVG, with no dependency.
//
// Byte mode, error correction level M, versions 1 to 10 (up to 213 bytes:
// plenty for "https://…/r/<code>"). The algorithm follows the QR Code
// specification (ISO/IEC 18004) as laid out in Project Nayuki's reference
// implementation: data bits → Reed-Solomon error correction per block →
// interleave → place in the zigzag → pick the mask with the lowest penalty →
// format and version bits. Checked in development by decoding the output with
// an independent reader (OpenCV's QRCodeDetector).

/** Error correction level M, versions 1–10: total codewords, EC codewords per block, number of blocks. */
const VERSIONS: Array<{ total: number; ecPerBlock: number; blocks: number }> = [
  { total: 26, ecPerBlock: 10, blocks: 1 },
  { total: 44, ecPerBlock: 16, blocks: 1 },
  { total: 70, ecPerBlock: 26, blocks: 1 },
  { total: 100, ecPerBlock: 18, blocks: 2 },
  { total: 134, ecPerBlock: 24, blocks: 2 },
  { total: 172, ecPerBlock: 16, blocks: 4 },
  { total: 196, ecPerBlock: 18, blocks: 4 },
  { total: 242, ecPerBlock: 22, blocks: 4 },
  { total: 292, ecPerBlock: 22, blocks: 5 },
  { total: 346, ecPerBlock: 26, blocks: 5 },
];

const bit = (x: number, i: number): boolean => ((x >>> i) & 1) !== 0;

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

export interface QrMatrix {
  size: number;
  /** modules[y][x], true = dark. */
  modules: boolean[][];
}

/** Encodes text (UTF-8, byte mode, level M). Throws when it does not fit in version 10. */
export function encodeQr(text: string): QrMatrix {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const { total, ecPerBlock, blocks } = VERSIONS[v - 1]!;
    const capacityBits = (total - ecPerBlock * blocks) * 8;
    const needed = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
    if (needed <= capacityBits) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR: text too long");
  const { total, ecPerBlock, blocks } = VERSIONS[version - 1]!;
  const dataCodewords = total - ecPerBlock * blocks;
  const capacityBits = dataCodewords * 8;

  // Data bits.
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Error correction, then interleave.
  const shortBlocks = blocks - (total % blocks);
  const shortLen = Math.floor(total / blocks);
  const divisor = rsDivisor(ecPerBlock);
  const blockList: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecPerBlock + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    blockList.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blockList[0]!.length; i++) {
    blockList.forEach((block, j) => {
      if (i !== shortLen - ecPerBlock || j >= shortBlocks) codewords.push(block[i]!);
    });
  }

  // Function patterns.
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(version, size);
  align.forEach((ay, i) =>
    align.forEach((ax, j) => {
      const last = align.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const drawFormat = (mask: number) => {
    const d = (0 << 3) | mask; // level M = 0b00
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((d << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(f, i));
    set(8, 7, bit(f, 6));
    set(8, 8, bit(f, 7));
    set(7, 8, bit(f, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(f, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(f, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(f, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const v = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(v, i));
      set(b, a, bit(v, i));
    }
  }

  // Codewords in the zigzag.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  // The mask with the lowest penalty.
  const masked = (mask: number): boolean[][] =>
    modules.map((row, y) =>
      row.map((dark, x) => {
        if (isFunction[y]![x]) return dark;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        return dark !== invert;
      }),
    );
  let best: { mask: number; grid: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(mask);
    const grid = masked(mask);
    const score = penalty(grid);
    if (!best || score < best.score) best = { mask, grid, score };
  }
  drawFormat(best!.mask);
  const grid = masked(best!.mask);
  return { size, modules: grid };
}

/** Rules 1, 2 and 4 of the specification's penalty (runs, 2×2 blocks, balance). Enough to choose a mask. */
function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (let a = 0; a < size; a++) {
    for (const line of [grid[a]!, grid.map((row) => row[a]!)]) {
      let run = 1;
      for (let k = 1; k <= size; k++) {
        if (k < size && line[k] === line[k - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid[y]![x]) dark++;
      if (x < size - 1 && y < size - 1) {
        const c = grid[y]![x];
        if (c === grid[y]![x + 1] && c === grid[y + 1]![x] && c === grid[y + 1]![x + 1]) score += 3;
      }
    }
  }
  score += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return score;
}

/** The code as an SVG document: dark modules on white, with the 4-module quiet zone. */
export function qrSvg(text: string, options: { title?: string } = {}): string {
  const { size, modules } = encodeQr(text);
  const border = 4;
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < size && row[end]) end++;
      parts.push(`M${x + border} ${y + border}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  const dim = size + border * 2;
  const title = options.title ? `<title>${options.title.replace(/[<>&"]/g, "")}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img">${title}<rect width="${dim}" height="${dim}" fill="#fff"/><path d="${parts.join("")}" fill="#0b1f3a"/></svg>`;
}
