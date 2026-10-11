import { describe, expect, it } from 'vitest';
import { assemble } from './assembler';
import { Machine, STACK_TOP } from './machine';
import { EXAMPLES } from './examples';

function run(source: string) {
  const program = assemble(source);
  expect(program.errors).toEqual([]);
  const m = new Machine(program);
  while (!m.halted) m.stepOnce();
  return m;
}

describe('machine', () => {
  it('runs sum_indexed and restores sp', () => {
    const m = run(EXAMPLES[0].source);
    expect(m.error).toBe(false);
    expect(m.regs[10]).toBe(3 + 7 - 2 + 10 + 4);
    expect(m.sp).toBe(STACK_TOP);
    expect(m.lowestSp).toBe(STACK_TOP - 32 - 48);
    // The running sum at -20(s0) was overwritten once per iteration (plus the initial zero).
    const sumAddr = STACK_TOP - 32 - 48 + 48 - 20;
    expect(m.history.get(sumAddr)!.map((e) => e.value | 0)).toEqual([0, 3, 10, 8, 18, 22]);
  });

  it('runs recursive factorial', () => {
    expect(run(EXAMPLES[1].source).regs[10]).toBe(24);
  });

  it('swaps .data words', () => {
    const m = run(EXAMPLES[2].source);
    expect(m.peekWord(0x10010000)).toBe(22);
    expect(m.peekWord(0x10010004)).toBe(11);
    expect(m.history.get(0x10010000)!.length).toBe(2);
  });

  it('handles bytes, halves and %hi/%lo', () => {
    const m = run(`
      .data
buf:  .word 0
      .text
main: lui a0,%hi(buf)
      addi a0,a0,%lo(buf)
      li t0,-1
      sb t0,1(a0)
      lbu t1,1(a0)
      lb t2,1(a0)
      ret`);
    expect(m.peekWord(0x10010000)).toBe(0xff00);
    expect(m.regs[6]).toBe(255);
    expect(m.regs[7]).toBe(-1);
  });

  it('reports assembly errors with line numbers', () => {
    const p = assemble('main:\n  addi a0, a0\n  foo a0\n  j nowhere');
    expect(p.errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });
});
