export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2',
  's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7',
  's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
];

const REG_LOOKUP = new Map<string, number>();
ABI_NAMES.forEach((name, i) => {
  REG_LOOKUP.set(name, i);
  REG_LOOKUP.set(`x${i}`, i);
});
REG_LOOKUP.set('fp', 8);

export function parseRegister(token: string): number | undefined {
  return REG_LOOKUP.get(token.trim().toLowerCase());
}

export function isRegisterName(token: string): boolean {
  return REG_LOOKUP.has(token.toLowerCase());
}

export const REG = { zero: 0, ra: 1, sp: 2, gp: 3, s0: 8, a0: 10, a7: 17 } as const;
