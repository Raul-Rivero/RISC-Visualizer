import { NonIdealState, Tag, Tooltip } from '@blueprintjs/core';
import { useEffect, useMemo, useRef } from 'react';
import { ABI_NAMES } from '../sim/registers';
import { STACK_TOP, type Machine, type WordEntry } from '../sim/machine';

export type ValueFormat = 'hex' | 'dec';

const ROW_H = 32;
const MAX_OLD_VALUES = 3;

type Props = {
  machine: Machine;
  version: number; // bumps whenever the machine steps, so memo'd rows refresh
  format: ValueFormat;
  highOnTop: boolean;
};

type Pointer = { name: string; reg: number; addr: number };

export const hex32 = (v: number) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
export const formatValue = (v: number, format: ValueFormat) => (format === 'hex' ? hex32(v) : String(v | 0));

export function MemoryView({ machine, version, format, highOnTop }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sp = machine.sp;
  const fp = machine.fp;

  const stackRows = useMemo(() => {
    const low = Math.min(machine.lowestSp, sp) & ~3;
    const rows: number[] = [];
    for (let a = STACK_TOP; a >= low; a -= 4) rows.push(a);
    return highOnTop ? rows : rows.reverse();
  }, [machine, version, highOnTop]);

  const otherRows = useMemo(() => {
    const low = stackRows.length ? Math.min(...stackRows) : STACK_TOP;
    const rows = [...machine.history.keys()].filter((a) => a < low || a > STACK_TOP).sort((x, y) => x - y);
    return highOnTop ? rows.reverse() : rows;
  }, [machine, version, highOnTop, stackRows]);

  // Registers that currently point into the visible stack: sp, fp/s0, and argument registers.
  const pointers: Pointer[] = useMemo(() => {
    const regs = [2, 8, 10, 11, 12, 13, 14, 15, 16, 17];
    const inStack = new Set(stackRows);
    return regs
      .map((reg) => ({ reg, addr: machine.regs[reg] >>> 0, name: ABI_NAMES[reg] }))
      .filter((p) => inStack.has(p.addr) || (p.reg === 2 && inStack.has(p.addr & ~3)));
  }, [machine, version, stackRows]);

  // Follow the stack pointer as it moves.
  useEffect(() => {
    const el = scrollRef.current;
    const idx = stackRows.indexOf(sp & ~3);
    if (!el || idx < 0) return;
    const top = idx * ROW_H + 40;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H * 2) {
      el.scrollTo({ top: top - el.clientHeight / 2, behavior: 'smooth' });
    }
  }, [sp, stackRows]);

  const access = machine.lastAccess;
  const accessWord = access ? access.addr & ~3 : undefined;
  const fpInStack = fp <= STACK_TOP && fp >= (stackRows.length ? Math.min(...stackRows) : STACK_TOP);
  const dataLabels = machine.program.dataLabels;

  const renderRow = (addr: number, region: 'stack' | 'other') => {
    const entries = machine.history.get(addr);
    const freed = region === 'stack' && addr < sp;
    const inFrame = region === 'stack' && fpInStack && addr >= sp && addr < fp;
    const cls = [
      'mem-row',
      freed && 'is-freed',
      inFrame && 'in-frame',
      accessWord === addr && `access-${access!.kind}`,
    ].filter(Boolean).join(' ');

    let offsets: [string, string];
    if (region === 'stack') {
      offsets = [offsetLabel('sp', addr - sp), fpInStack ? offsetLabel('fp', addr - fp) : ''];
    } else {
      offsets = [dataLabelFor(addr, dataLabels), ''];
    }

    return (
      <div key={addr} className={cls} style={{ height: ROW_H }}>
        <span className="mem-pointer-col" />
        <span className="mem-offsets">
          <span className="mem-offset">{offsets[0]}</span>
          <span className="mem-offset fp">{offsets[1]}</span>
        </span>
        <span className="mem-addr">{hex32(addr)}</span>
        <ValueCell entries={entries} format={format} />
      </div>
    );
  };

  if (stackRows.length === 0 && otherRows.length === 0) {
    return <NonIdealState icon="database" title="No memory touched yet" />;
  }

  return (
    <div className="memory-scroll" ref={scrollRef}>
      <div className="mem-header">
        <span>Pointers</span>
        <span>Offset</span>
        <span>Address</span>
        <span>Data</span>
      </div>
      <div className="mem-section-title">Stack {highOnTop ? '(grows ↓)' : '(grows ↑)'}</div>
      <div className="mem-rows">
        {stackRows.map((a) => renderRow(a, 'stack'))}
        <PointerOverlay pointers={pointers} rows={stackRows} />
      </div>
      {otherRows.length > 0 && (
        <>
          <div className="mem-section-title">Data / other</div>
          <div className="mem-rows">{otherRows.map((a) => renderRow(a, 'other'))}</div>
        </>
      )}
    </div>
  );
}

function ValueCell({ entries, format }: { entries: WordEntry[] | undefined; format: ValueFormat }) {
  if (!entries || entries.length === 0) {
    return <span className="mem-data"><span className="mem-uninit">— uninitialized —</span></span>;
  }
  const current = entries[entries.length - 1];
  const old = entries.slice(0, -1);
  const shown = old.slice(-MAX_OLD_VALUES);
  const hidden = old.length - shown.length;

  const historyTip = (
    <div className="history-tip">
      {entries.map((e, i) => (
        <div key={i}>
          <code>{formatValue(e.value, format)}</code>{' '}
          <span className="muted">{e.line < 0 ? 'initial data' : `step ${e.step}, line ${e.line + 1}`}</span>
        </div>
      ))}
    </div>
  );

  return (
    <span className="mem-data">
      <Tooltip content={historyTip} placement="left" disabled={old.length === 0}>
        <span className="mem-values">
          {hidden > 0 && <span className="mem-more">+{hidden}</span>}
          {shown.map((e, i) => (
            <span key={i} className="mem-old">{formatValue(e.value, format)}</span>
          ))}
          {/* key on the history length so a fresh write replays the "pop" animation */}
          <span key={entries.length} className={`mem-current ${entries.length > 1 ? 'is-updated' : ''}`}>
            {formatValue(current.value, format)}
          </span>
        </span>
      </Tooltip>
    </span>
  );
}

function PointerOverlay({ pointers, rows }: { pointers: Pointer[]; rows: number[] }) {
  const rowOf = (p: Pointer) => rows.indexOf(p.addr & ~3);
  const y = (row: number) => row * ROW_H + (ROW_H - 22) / 2;
  const sp = pointers.find((p) => p.reg === 2);
  const fp = pointers.find((p) => p.reg === 8);
  const sameRow = sp && fp && rowOf(sp) === rowOf(fp);

  // Argument registers are grouped into one tag per row so they never pile up.
  const argsByRow = new Map<number, string[]>();
  for (const p of pointers) {
    if (p.reg === 2 || p.reg === 8) continue;
    const row = rowOf(p);
    argsByRow.set(row, [...(argsByRow.get(row) ?? []), p.name]);
  }

  return (
    <div className="pointer-overlay">
      {sp && (
        <div className="pointer-marker" style={{ transform: `translateY(${y(rowOf(sp))}px)` }}>
          <Tag intent="primary" rightIcon="arrow-right">sp</Tag>
        </div>
      )}
      {fp && (
        <div className="pointer-marker" style={{ transform: `translate(${sameRow ? -52 : 0}px, ${y(rowOf(fp))}px)` }}>
          <Tag intent="warning" rightIcon="arrow-right">fp</Tag>
        </div>
      )}
      {[...argsByRow].map(([row, names]) => {
        const hasFrameTag = (sp && rowOf(sp) === row ? 1 : 0) + (fp && rowOf(fp) === row ? 1 : 0);
        return (
          <div
            key={row}
            className="pointer-marker args"
            style={{ transform: `translate(${-hasFrameTag * 52}px, ${y(row)}px)` }}
          >
            <Tag minimal>{names.join(' ')}</Tag>
          </div>
        );
      })}
    </div>
  );
}

function offsetLabel(name: string, delta: number): string {
  if (delta === 0) return name;
  return `${name}${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
}

function dataLabelFor(addr: number, labels: Map<number, string>): string {
  let best: [number, string] | undefined;
  for (const [a, name] of labels) if (a <= addr && (!best || a > best[0])) best = [a, name];
  if (!best) return '';
  const off = addr - best[0];
  return off === 0 ? best[1] : `${best[1]}+${off}`;
}
