import { ABI_NAMES } from '../sim/registers';
import type { Machine } from '../sim/machine';
import { formatValue, hex32, type ValueFormat } from './MemoryView';

type Props = { machine: Machine; version: number; format: ValueFormat };

export function RegisterView({ machine, format }: Props) {
  return (
    <div className="reg-grid">
      <div className="reg-row reg-pc">
        <span className="reg-name">pc</span>
        <span className="reg-value">{hex32(machine.pc)}</span>
      </div>
      {ABI_NAMES.map((name, i) => {
        const cls = [
          'reg-row',
          machine.changedRegs.has(i) && 'is-changed',
          i === 2 && 'is-sp',
          i === 8 && 'is-fp',
        ].filter(Boolean).join(' ');
        return (
          <div key={i} className={cls}>
            <span className="reg-name">
              {i === 8 ? 's0/fp' : name}
              <span className="reg-x">x{i}</span>
            </span>
            <span className="reg-value">{formatValue(machine.regs[i], format)}</span>
          </div>
        );
      })}
    </div>
  );
}
