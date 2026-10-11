import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AsmError } from '../sim/assembler';
import { isRegisterName } from '../sim/registers';

export const LINE_HEIGHT = 20;
const TAB_SIZE = 8;

type Props = {
  value: string;
  onChange: (value: string) => void;
  currentLine: number | undefined;
  errors: AsmError[];
  breakpoints: Set<number>;
  onToggleBreakpoint: (line: number) => void;
};

export function CodeEditor({ value, onChange, currentLine, errors, breakpoints, onToggleBreakpoint }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split('\n'), [value]);
  const errorByLine = useMemo(() => new Map(errors.map((e) => [e.line, e.message])), [errors]);
  const widthCh = useMemo(
    () => Math.max(40, ...lines.map((l) => l.replace(/\t/g, ' '.repeat(TAB_SIZE)).length)) + 4,
    [lines],
  );

  // Keep the executing line in view, like a debugger.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || currentLine === undefined) return;
    const top = currentLine * LINE_HEIGHT;
    if (top < el.scrollTop + LINE_HEIGHT || top > el.scrollTop + el.clientHeight - 3 * LINE_HEIGHT) {
      el.scrollTo({ top: top - el.clientHeight / 3, behavior: 'smooth' });
    }
  }, [currentLine]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: end } = ta;
    onChange(value.slice(0, s) + '\t' + value.slice(end));
    requestAnimationFrame(() => ta.setSelectionRange(s + 1, s + 1));
  };

  const height = lines.length * LINE_HEIGHT + 24;

  return (
    <div className="editor-scroll" ref={scrollRef}>
      <div className="editor-inner" style={{ height }}>
        <div className="editor-gutter">
          {lines.map((_, i) => {
            const err = errorByLine.get(i);
            const cls = [
              'gutter-line',
              breakpoints.has(i) && 'has-bp',
              err && 'has-error',
              currentLine === i && 'is-current',
            ].filter(Boolean).join(' ');
            return (
              <div key={i} className={cls} onClick={() => onToggleBreakpoint(i)} title={err ?? 'Toggle breakpoint'}>
                <span className="bp-dot" />
                {i + 1}
              </div>
            );
          })}
        </div>
        <div className="editor-code" style={{ width: `calc(${widthCh}ch + 24px)` }}>
          {currentLine !== undefined && (
            <div className="current-line-bar" style={{ transform: `translateY(${currentLine * LINE_HEIGHT}px)` }} />
          )}
          {[...errorByLine.keys()].map((line) => (
            <div key={line} className="error-line-bar" style={{ top: line * LINE_HEIGHT + 12 }} />
          ))}
          <pre className="editor-highlight" aria-hidden>
            {lines.map((l, i) => (
              <div key={i} className="hl-line">{highlightLine(l)}{'\n'}</div>
            ))}
          </pre>
          <textarea
            className="editor-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
          />
        </div>
      </div>
    </div>
  );
}

/** Tiny tokenizer for syntax colouring: labels, mnemonics, registers, numbers, comments. */
function highlightLine(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = line;
  let key = 0;
  const push = (text: string, cls?: string) => {
    if (text) out.push(cls ? <span key={key++} className={cls}>{text}</span> : text);
  };

  const commentIdx = rest.search(/#|\/\//);
  let comment = '';
  if (commentIdx >= 0) {
    comment = rest.slice(commentIdx);
    rest = rest.slice(0, commentIdx);
  }

  const label = /^(\s*)([A-Za-z_.$][\w.$]*:)/.exec(rest);
  if (label) {
    push(label[1]);
    push(label[2], 'tok-label');
    rest = rest.slice(label[0].length);
  }

  const mnem = /^(\s*)(\S+)/.exec(rest);
  if (mnem) {
    push(mnem[1]);
    push(mnem[2], mnem[2].startsWith('.') ? 'tok-directive' : 'tok-op');
    rest = rest.slice(mnem[0].length);
  }

  for (const part of rest.split(/([\s,()]+)/)) {
    if (!part) continue;
    if (/^[\s,()]+$/.test(part)) push(part, 'tok-punct');
    else if (isRegisterName(part)) push(part, 'tok-reg');
    else if (/^[-+]?(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(part)) push(part, 'tok-num');
    else if (/^".*"?$/.test(part)) push(part, 'tok-string');
    else if (/^%(hi|lo)$/i.test(part)) push(part, 'tok-directive');
    else push(part, 'tok-ident');
  }
  push(comment, 'tok-comment');
  return out;
}
