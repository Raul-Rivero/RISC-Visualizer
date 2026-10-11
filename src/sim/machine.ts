import { TEXT_BASE, type Instr, type Program } from './assembler';
import { REG } from './registers';

export const STACK_TOP = 0x7ffffff0;
export const GP_INIT = 0x10008000;
/** Initial `ra`. Returning here means the program finished normally. */
export const HALT_ADDR = 0xfffffff0;
export const MAX_STEPS = 200_000;

export type WordEntry = {
  value: number; // unsigned 32-bit
  step: number; // step that produced it (0 = initial data)
  line: number; // source line that wrote it (-1 = initial data)
};

export type MemAccess = { addr: number; size: number; kind: 'load' | 'store' };

export class Machine {
  readonly program: Program;
  regs = new Array<number>(32).fill(0);
  pc: number;
  step = 0;
  halted = false;
  haltReason = '';
  error = false;
  output = '';
  /** Byte-addressed memory. Absent = never written. */
  mem = new Map<number, number>();
  /** Every value each (word-aligned) address has held, oldest first. */
  history = new Map<number, WordEntry[]>();
  lastAccess: MemAccess | undefined;
  changedRegs = new Set<number>();
  lowestSp = STACK_TOP;

  constructor(program: Program) {
    this.program = program;
    this.pc = program.entry;
    this.regs[REG.sp] = STACK_TOP;
    this.regs[REG.gp] = GP_INIT;
    this.regs[REG.ra] = HALT_ADDR | 0;
    for (const [addr, byte] of program.data) this.mem.set(addr, byte);
    const words = new Set<number>();
    for (const addr of program.data.keys()) words.add(addr & ~3);
    for (const w of words) this.history.set(w, [{ value: this.peekWord(w), step: 0, line: -1 }]);
    if (program.instrs.length === 0) this.halt('No instructions to run');
  }

  get currentInstr(): Instr | undefined {
    return this.program.instrs[(this.pc - TEXT_BASE) / 4];
  }

  /** Source line of the instruction about to execute. */
  get currentLine(): number | undefined {
    return this.halted ? undefined : this.currentInstr?.line;
  }

  get sp(): number { return this.regs[REG.sp] >>> 0; }
  get fp(): number { return this.regs[8] >>> 0; }

  peekWord(addr: number): number {
    let v = 0;
    for (let i = 0; i < 4; i++) v |= (this.mem.get(addr + i) ?? 0) << (8 * i);
    return v >>> 0;
  }

  private load(addr: number, size: number, signed: boolean): number {
    this.lastAccess = { addr, size, kind: 'load' };
    let v = 0;
    for (let i = 0; i < size; i++) v |= (this.mem.get(addr + i) ?? 0) << (8 * i);
    if (size === 4) return v | 0;
    const shift = 32 - 8 * size;
    return signed ? (v << shift) >> shift : v;
  }

  private store(addr: number, value: number, size: number, line: number) {
    this.lastAccess = { addr, size, kind: 'store' };
    for (let i = 0; i < size; i++) this.mem.set(addr + i, (value >>> (8 * i)) & 0xff);
    const firstWord = addr & ~3;
    const lastWord = (addr + size - 1) & ~3;
    for (let w = firstWord; w <= lastWord; w += 4) {
      const entries = this.history.get(w) ?? [];
      entries.push({ value: this.peekWord(w), step: this.step, line });
      this.history.set(w, entries);
    }
  }

  private setReg(rd: number, value: number) {
    if (rd === 0) return;
    this.regs[rd] = value | 0;
    this.changedRegs.add(rd);
  }

  private halt(reason: string, error = false) {
    this.halted = true;
    this.haltReason = reason;
    this.error = error;
  }

  stepOnce(): void {
    if (this.halted) return;
    this.lastAccess = undefined;
    this.changedRegs = new Set();

    const ins = this.currentInstr;
    if (!ins) {
      this.halt(`PC 0x${(this.pc >>> 0).toString(16)} is outside the program`, true);
      return;
    }

    this.step++;
    const r = this.regs;
    const a = r[ins.rs1];
    const b = r[ins.rs2];
    const imm = ins.imm;
    let nextPc = this.pc + 4;

    switch (ins.op) {
      case 'add': this.setReg(ins.rd, a + b); break;
      case 'sub': this.setReg(ins.rd, a - b); break;
      case 'and': this.setReg(ins.rd, a & b); break;
      case 'or': this.setReg(ins.rd, a | b); break;
      case 'xor': this.setReg(ins.rd, a ^ b); break;
      case 'sll': this.setReg(ins.rd, a << (b & 31)); break;
      case 'srl': this.setReg(ins.rd, a >>> (b & 31)); break;
      case 'sra': this.setReg(ins.rd, a >> (b & 31)); break;
      case 'slt': this.setReg(ins.rd, a < b ? 1 : 0); break;
      case 'sltu': this.setReg(ins.rd, a >>> 0 < b >>> 0 ? 1 : 0); break;
      case 'mul': this.setReg(ins.rd, Math.imul(a, b)); break;
      case 'mulh': this.setReg(ins.rd, Number((BigInt(a) * BigInt(b)) >> 32n)); break;
      case 'mulhu': this.setReg(ins.rd, Number((BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n)); break;
      case 'mulhsu': this.setReg(ins.rd, Number((BigInt(a) * BigInt(b >>> 0)) >> 32n)); break;
      case 'div':
        this.setReg(ins.rd, b === 0 ? -1 : a === -0x80000000 && b === -1 ? a : Math.trunc(a / b));
        break;
      case 'divu': this.setReg(ins.rd, b === 0 ? -1 : Math.floor((a >>> 0) / (b >>> 0))); break;
      case 'rem': this.setReg(ins.rd, b === 0 ? a : a === -0x80000000 && b === -1 ? 0 : a % b); break;
      case 'remu': this.setReg(ins.rd, b === 0 ? a : (a >>> 0) % (b >>> 0)); break;

      case 'addi': this.setReg(ins.rd, a + imm); break;
      case 'andi': this.setReg(ins.rd, a & imm); break;
      case 'ori': this.setReg(ins.rd, a | imm); break;
      case 'xori': this.setReg(ins.rd, a ^ imm); break;
      case 'slti': this.setReg(ins.rd, a < imm ? 1 : 0); break;
      case 'sltiu': this.setReg(ins.rd, a >>> 0 < imm >>> 0 ? 1 : 0); break;
      case 'slli': this.setReg(ins.rd, a << (imm & 31)); break;
      case 'srli': this.setReg(ins.rd, a >>> (imm & 31)); break;
      case 'srai': this.setReg(ins.rd, a >> (imm & 31)); break;
      case 'li': this.setReg(ins.rd, imm); break;
      case 'lui': this.setReg(ins.rd, imm << 12); break;
      case 'auipc': this.setReg(ins.rd, this.pc + (imm << 12)); break;

      case 'lb': this.setReg(ins.rd, this.load((a + imm) >>> 0, 1, true)); break;
      case 'lh': this.setReg(ins.rd, this.load((a + imm) >>> 0, 2, true)); break;
      case 'lw': this.setReg(ins.rd, this.load((a + imm) >>> 0, 4, true)); break;
      case 'lbu': this.setReg(ins.rd, this.load((a + imm) >>> 0, 1, false)); break;
      case 'lhu': this.setReg(ins.rd, this.load((a + imm) >>> 0, 2, false)); break;
      case 'sb': this.store((a + imm) >>> 0, b, 1, ins.line); break;
      case 'sh': this.store((a + imm) >>> 0, b, 2, ins.line); break;
      case 'sw': this.store((a + imm) >>> 0, b, 4, ins.line); break;

      case 'beq': if (a === b) nextPc = imm; break;
      case 'bne': if (a !== b) nextPc = imm; break;
      case 'blt': if (a < b) nextPc = imm; break;
      case 'bge': if (a >= b) nextPc = imm; break;
      case 'bltu': if (a >>> 0 < b >>> 0) nextPc = imm; break;
      case 'bgeu': if (a >>> 0 >= b >>> 0) nextPc = imm; break;
      case 'jal':
        this.setReg(ins.rd, this.pc + 4);
        nextPc = imm;
        break;
      case 'jalr':
        nextPc = (a + imm) & ~1;
        this.setReg(ins.rd, this.pc + 4);
        break;

      case 'ecall':
        this.ecall();
        break;
      case 'ebreak':
        this.halt('ebreak');
        break;
      default:
        this.halt(`Unimplemented op ${ins.op}`, true);
    }

    this.pc = nextPc >>> 0;
    this.lowestSp = Math.min(this.lowestSp, this.sp);
    if (this.pc === HALT_ADDR) this.halt(`Program returned (a0 = ${this.regs[REG.a0]})`);
    if (!this.halted && this.step >= MAX_STEPS) this.halt(`Stopped after ${MAX_STEPS} steps (infinite loop?)`, true);
  }

  /** RARS/Venus-style environment calls. */
  private ecall() {
    const r = this.regs;
    switch (r[REG.a7]) {
      case 1: this.output += String(r[REG.a0]); break;
      case 4: {
        let addr = r[REG.a0] >>> 0;
        let s = '';
        for (let ch; (ch = this.mem.get(addr) ?? 0) !== 0 && s.length < 10_000; addr++) s += String.fromCharCode(ch);
        this.output += s;
        break;
      }
      case 11: this.output += String.fromCharCode(r[REG.a0] & 0xff); break;
      case 10: this.halt('exit'); break;
      case 93: this.halt(`exit(${r[REG.a0]})`); break;
      default: this.halt(`Unsupported ecall a7=${r[REG.a7]}`, true);
    }
  }
}
