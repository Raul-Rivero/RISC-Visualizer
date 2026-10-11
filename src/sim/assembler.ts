import { parseRegister } from './registers';

export const TEXT_BASE = 0x00400000;
export const DATA_BASE = 0x10010000;

/** A fully resolved instruction, ready for the machine to execute. */
export type Instr = {
  op: string; // canonical op (pseudo-instructions are expanded)
  rd: number;
  rs1: number;
  rs2: number;
  imm: number;
  line: number; // 0-based source line
  addr: number;
  source: string; // original text, for display
};

export type AsmError = { line: number; message: string };

export type Program = {
  instrs: Instr[];
  labels: Map<string, number>;
  /** Initial bytes of the data segment(s). */
  data: Map<number, number>;
  /** Address → label name for data words, for display. */
  dataLabels: Map<number, string>;
  entry: number;
  errors: AsmError[];
};

type RawInstr = { mnemonic: string; args: string[]; line: number; addr: number; source: string };

const IGNORED_DIRECTIVES = new Set([
  '.globl', '.global', '.type', '.size', '.file', '.option', '.attribute', '.ident',
  '.p2align', '.local', '.weak', '.cfi_startproc', '.cfi_endproc', '.cfi_def_cfa_offset',
  '.cfi_offset', '.cfi_def_cfa', '.cfi_restore', '.addrsig', '.addrsig_sym', '.end',
]);

const R_OPS = new Set([
  'add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu',
]);
const I_OPS = new Set(['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai']);
const LOAD_OPS = new Set(['lb', 'lh', 'lw', 'lbu', 'lhu']);
const STORE_OPS = new Set(['sb', 'sh', 'sw']);
const BRANCH_OPS = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu']);

/** Pseudo-branches: [real op, swap operands, compare-against-zero side]. */
const ZERO_BRANCHES: Record<string, [string, 'left' | 'right']> = {
  beqz: ['beq', 'right'], bnez: ['bne', 'right'],
  bltz: ['blt', 'right'], bgez: ['bge', 'right'],
  blez: ['bge', 'left'], bgtz: ['blt', 'left'],
};
const SWAPPED_BRANCHES: Record<string, string> = { bgt: 'blt', ble: 'bge', bgtu: 'bltu', bleu: 'bgeu' };

function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') inString = !inString;
    if (inString) continue;
    if (c === '#' || (c === '/' && line[i + 1] === '/')) return line.slice(0, i);
  }
  return line;
}

function splitArgs(rest: string): string[] {
  const normalized = rest.replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')').trim();
  if (!normalized) return [];
  return normalized.split(/\s*,\s*|\s+/).filter(Boolean);
}

class AsmFail extends Error {}

export function assemble(source: string): Program {
  const lines = source.split('\n');
  const labels = new Map<string, number>();
  const data = new Map<number, number>();
  const dataLabels = new Map<number, string>();
  const errors: AsmError[] = [];
  const raw: RawInstr[] = [];
  const pendingWords: { addr: number; size: number; expr: string; line: number }[] = [];

  let section: 'text' | 'data' = 'text';
  let textAddr = TEXT_BASE;
  let dataAddr = DATA_BASE;

  const writeBytes = (addr: number, value: number, size: number) => {
    for (let i = 0; i < size; i++) data.set(addr + i, (value >>> (8 * i)) & 0xff);
  };

  lines.forEach((fullLine, lineNo) => {
    let text = stripComment(fullLine).trim();
    // Peel off any number of leading labels ("foo: bar: addi ...").
    for (;;) {
      const m = /^([A-Za-z_.$][\w.$]*)\s*:/.exec(text);
      if (!m) break;
      const name = m[1];
      if (labels.has(name)) errors.push({ line: lineNo, message: `Duplicate label "${name}"` });
      const addr = section === 'text' ? textAddr : dataAddr;
      labels.set(name, addr);
      if (section === 'data') dataLabels.set(addr, name);
      text = text.slice(m[0].length).trim();
    }
    if (!text) return;

    const m = /^(\S+)\s*(.*)$/.exec(text)!;
    const mnemonic = m[1].toLowerCase();
    const rest = m[2];

    if (mnemonic.startsWith('.')) {
      try {
        handleDirective(mnemonic, rest, lineNo);
      } catch (e) {
        errors.push({ line: lineNo, message: (e as Error).message });
      }
      return;
    }

    if (section !== 'text') {
      errors.push({ line: lineNo, message: `Instruction "${mnemonic}" outside of .text section` });
      return;
    }
    raw.push({ mnemonic, args: splitArgs(rest), line: lineNo, addr: textAddr, source: text });
    textAddr += 4;
  });

  function handleDirective(dir: string, rest: string, lineNo: number) {
    if (IGNORED_DIRECTIVES.has(dir) || dir.startsWith('.cfi_')) return;
    if (dir === '.text') { section = 'text'; return; }
    if (dir === '.data' || dir === '.rodata' || dir === '.bss' || dir === '.sdata') { section = 'data'; return; }
    if (dir === '.section') {
      section = /text/.test(rest) ? 'text' : 'data';
      return;
    }
    if (section === 'text') {
      if (dir === '.align') return;
      throw new Error(`Directive ${dir} is only supported in the .data section`);
    }
    switch (dir) {
      case '.word':
      case '.half':
      case '.byte':
      case '.2byte':
      case '.4byte': {
        const size = dir === '.word' || dir === '.4byte' ? 4 : dir === '.byte' ? 1 : 2;
        for (const expr of rest.split(',').map((s) => s.trim()).filter(Boolean)) {
          pendingWords.push({ addr: dataAddr, size, expr, line: lineNo });
          dataAddr += size;
        }
        return;
      }
      case '.space':
      case '.zero': {
        const n = parseNumber(rest.trim());
        if (n === undefined || n < 0) throw new Error(`Bad size "${rest}"`);
        for (let i = 0; i < n; i++) data.set(dataAddr + i, 0);
        dataAddr += n;
        return;
      }
      case '.align':
      case '.balign': {
        const n = parseNumber(rest.trim()) ?? 2;
        const bytes = dir === '.align' ? 1 << n : n;
        dataAddr = Math.ceil(dataAddr / bytes) * bytes;
        return;
      }
      case '.string':
      case '.asciz':
      case '.ascii': {
        const sm = /^"((?:[^"\\]|\\.)*)"$/.exec(rest.trim());
        if (!sm) throw new Error(`Expected a quoted string`);
        const str = JSON.parse(`"${sm[1]}"`) as string;
        for (const ch of str) data.set(dataAddr++, ch.charCodeAt(0) & 0xff);
        if (dir !== '.ascii') data.set(dataAddr++, 0);
        return;
      }
      default:
        throw new Error(`Unsupported directive ${dir}`);
    }
  }

  for (const w of pendingWords) {
    const v = evalImmediate(w.expr, labels);
    if (v === undefined) errors.push({ line: w.line, message: `Cannot evaluate "${w.expr}"` });
    else writeBytes(w.addr, v, w.size);
  }

  const instrs: Instr[] = [];
  for (const r of raw) {
    try {
      instrs.push(resolve(r, labels));
    } catch (e) {
      errors.push({ line: r.line, message: (e as Error).message });
    }
  }

  const entry = labels.get('main') ?? labels.get('_start') ?? TEXT_BASE;
  return { instrs, labels, data, dataLabels, entry, errors };
}

export function parseNumber(token: string): number | undefined {
  const t = token.trim();
  if (/^'.'$/.test(t)) return t.charCodeAt(1);
  if (/^[-+]?0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t.replace(/^\+/, ''), 16);
  if (/^[-+]?0b[01]+$/i.test(t)) {
    const neg = t.startsWith('-');
    const v = Number.parseInt(t.replace(/^[-+]?0b/i, ''), 2);
    return neg ? -v : v;
  }
  if (/^[-+]?\d+$/.test(t)) return Number.parseInt(t, 10);
  return undefined;
}

/** Numbers, labels, label±offset and %hi()/%lo() relocations. */
function evalImmediate(token: string, labels: Map<string, number>): number | undefined {
  const t = token.trim();
  const reloc = /^%(hi|lo)\((.+)\)$/i.exec(t);
  if (reloc) {
    const v = evalImmediate(reloc[2], labels);
    if (v === undefined) return undefined;
    if (reloc[1].toLowerCase() === 'hi') return ((v + 0x800) >>> 12) & 0xfffff;
    return ((v & 0xfff) << 20) >> 20;
  }
  const n = parseNumber(t);
  if (n !== undefined) return n;
  const sym = /^([A-Za-z_.$][\w.$]*)\s*(?:([-+])\s*(\w+))?$/.exec(t);
  if (sym && labels.has(sym[1])) {
    const base = labels.get(sym[1])!;
    if (!sym[2]) return base;
    const off = parseNumber(sym[3]);
    if (off === undefined) return undefined;
    return sym[2] === '+' ? base + off : base - off;
  }
  return undefined;
}

function resolve(r: RawInstr, labels: Map<string, number>): Instr {
  const { args } = r;
  const base = { line: r.line, addr: r.addr, source: r.source };
  const make = (op: string, rd = 0, rs1 = 0, rs2 = 0, imm = 0): Instr => ({ op, rd, rs1, rs2, imm, ...base });

  const reg = (i: number): number => {
    const tok = args[i];
    if (tok === undefined) throw new AsmFail(`Missing operand ${i + 1}`);
    const n = parseRegister(tok);
    if (n === undefined) throw new AsmFail(`"${tok}" is not a register`);
    return n;
  };
  const imm = (i: number): number => {
    const tok = args[i];
    if (tok === undefined) throw new AsmFail(`Missing operand ${i + 1}`);
    const v = evalImmediate(tok, labels);
    if (v === undefined) throw new AsmFail(`"${tok}" is not a number or known label`);
    return v;
  };
  const target = (i: number): number => {
    const tok = args[i];
    if (tok === undefined) throw new AsmFail(`Missing jump target`);
    const v = labels.get(tok) ?? parseNumber(tok);
    if (v === undefined) throw new AsmFail(`Unknown label "${tok}"`);
    return v;
  };
  const memOperand = (i: number): [number, number] => {
    const tok = args[i];
    if (tok === undefined) throw new AsmFail(`Missing memory operand`);
    const m = /^(.*)\(([^)]+)\)$/.exec(tok);
    if (!m) throw new AsmFail(`Expected offset(register), got "${tok}"`);
    const rs1 = parseRegister(m[2]);
    if (rs1 === undefined) throw new AsmFail(`"${m[2]}" is not a register`);
    const off = m[1] === '' ? 0 : evalImmediate(m[1], labels);
    if (off === undefined) throw new AsmFail(`Bad offset "${m[1]}"`);
    return [off, rs1];
  };
  const expect = (n: number) => {
    if (args.length !== n) throw new AsmFail(`${r.mnemonic} expects ${n} operand${n === 1 ? '' : 's'}, got ${args.length}`);
  };

  const op = r.mnemonic;
  if (R_OPS.has(op)) { expect(3); return make(op, reg(0), reg(1), reg(2)); }
  if (I_OPS.has(op)) { expect(3); return make(op, reg(0), reg(1), 0, imm(2)); }
  if (LOAD_OPS.has(op)) {
    expect(2);
    const [off, rs1] = memOperand(1);
    return make(op, reg(0), rs1, 0, off);
  }
  if (STORE_OPS.has(op)) {
    expect(2);
    const [off, rs1] = memOperand(1);
    return make(op, 0, rs1, reg(0), off);
  }
  if (BRANCH_OPS.has(op)) { expect(3); return make(op, 0, reg(0), reg(1), target(2)); }
  if (op in ZERO_BRANCHES) {
    expect(2);
    const [real, zeroSide] = ZERO_BRANCHES[op];
    return zeroSide === 'right' ? make(real, 0, reg(0), 0, target(1)) : make(real, 0, 0, reg(0), target(1));
  }
  if (op in SWAPPED_BRANCHES) { expect(3); return make(SWAPPED_BRANCHES[op], 0, reg(1), reg(0), target(2)); }

  switch (op) {
    case 'lui':
    case 'auipc': expect(2); return make(op, reg(0), 0, 0, imm(1));
    case 'jal':
      if (args.length === 1) return make('jal', 1, 0, 0, target(0));
      expect(2); return make('jal', reg(0), 0, 0, target(1));
    case 'jalr':
      if (args.length === 1) return make('jalr', 1, reg(0), 0, 0);
      if (args.length === 2) {
        const [off, rs1] = memOperand(1);
        return make('jalr', reg(0), rs1, 0, off);
      }
      expect(3); return make('jalr', reg(0), reg(1), 0, imm(2));
    case 'ecall': expect(0); return make('ecall');
    case 'ebreak': expect(0); return make('ebreak');
    case 'nop': expect(0); return make('addi');
    case 'mv': expect(2); return make('addi', reg(0), reg(1), 0, 0);
    case 'li': expect(2); return make('li', reg(0), 0, 0, imm(1));
    case 'la': expect(2); return make('li', reg(0), 0, 0, imm(1));
    case 'not': expect(2); return make('xori', reg(0), reg(1), 0, -1);
    case 'neg': expect(2); return make('sub', reg(0), 0, reg(1));
    case 'seqz': expect(2); return make('sltiu', reg(0), reg(1), 0, 1);
    case 'snez': expect(2); return make('sltu', reg(0), 0, reg(1));
    case 'j': expect(1); return make('jal', 0, 0, 0, target(0));
    case 'jr': expect(1); return make('jalr', 0, reg(0), 0, 0);
    case 'ret': expect(0); return make('jalr', 0, 1, 0, 0);
    case 'call': expect(1); return make('jal', 1, 0, 0, target(0));
    case 'tail': expect(1); return make('jal', 0, 0, 0, target(0));
  }
  throw new AsmFail(`Unknown instruction "${op}"`);
}
