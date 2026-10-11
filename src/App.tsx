import {
  Button,
  ButtonGroup,
  Callout,
  Card,
  Classes,
  HTMLSelect,
  Navbar,
  SegmentedControl,
  Slider,
  Switch,
  Tag,
} from '@blueprintjs/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CodeEditor } from './components/CodeEditor';
import { MemoryView, type ValueFormat } from './components/MemoryView';
import { RegisterView } from './components/RegisterView';
import { assemble } from './sim/assembler';
import { EXAMPLES } from './sim/examples';
import { Machine, MAX_STEPS } from './sim/machine';
import './App.css';

const STORAGE_KEY = 'risc-visualizer:source';

function loadSource(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? EXAMPLES[0].source;
  } catch {
    return EXAMPLES[0].source;
  }
}

export default function App() {
  const [source, setSource] = useState(loadSource);
  const [breakpoints, setBreakpoints] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4); // instructions per second
  const [format, setFormat] = useState<ValueFormat>('hex');
  const [highOnTop, setHighOnTop] = useState(true);
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [version, setVersion] = useState(0);

  const program = useMemo(() => assemble(source), [source]);
  const machineRef = useRef(new Machine(program));
  const machine = machineRef.current;
  const hasErrors = program.errors.length > 0;

  const refresh = () => setVersion((v) => v + 1);

  // Any edit re-assembles and restarts execution from the top.
  useEffect(() => {
    machineRef.current = new Machine(program);
    setPlaying(false);
    refresh();
    try {
      localStorage.setItem(STORAGE_KEY, source);
    } catch {
      /* storage unavailable: fine */
    }
  }, [program, source]);

  const reset = useCallback(() => {
    machineRef.current = new Machine(program);
    setPlaying(false);
    refresh();
  }, [program]);

  const step = useCallback(() => {
    machineRef.current.stepOnce();
    refresh();
  }, []);

  // The machine is deterministic, so stepping back = replaying from the start.
  const stepBack = useCallback(() => {
    const target = machineRef.current.step - 1;
    if (target < 0) return;
    const m = new Machine(program);
    while (m.step < target && !m.halted) m.stepOnce();
    machineRef.current = m;
    setPlaying(false);
    refresh();
  }, [program]);

  const runToBreakpoint = useCallback(() => {
    const m = machineRef.current;
    m.stepOnce();
    while (!m.halted && m.step < MAX_STEPS && !breakpoints.has(m.currentLine ?? -1)) m.stepOnce();
    setPlaying(false);
    refresh();
  }, [breakpoints]);

  // Play: step on a timer, pausing at breakpoints or when the program ends.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const m = machineRef.current;
      m.stepOnce();
      if (m.halted || breakpoints.has(m.currentLine ?? -1)) setPlaying(false);
      refresh();
    }, 1000 / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, breakpoints]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasErrors) return;
      if (e.key === 'F10' && e.shiftKey) { e.preventDefault(); stepBack(); }
      else if (e.key === 'F10') { e.preventDefault(); if (!machineRef.current.halted) step(); }
      else if (e.key === 'F5') { e.preventDefault(); if (!machineRef.current.halted) setPlaying((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasErrors, step, stepBack]);

  const toggleBreakpoint = (line: number) =>
    setBreakpoints((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const loadExample = (name: string) => {
    const ex = EXAMPLES.find((e) => e.name === name);
    if (ex) {
      setSource(ex.source);
      setBreakpoints(new Set());
    }
  };

  const current = machine.halted ? undefined : machine.currentInstr;
  const canStep = !hasErrors && !machine.halted;

  return (
    <div className={`app ${dark ? Classes.DARK : ''}`}>
      <Navbar className="app-navbar">
        <Navbar.Group align="left">
          <Navbar.Heading className="app-title">RISC-V Visualizer</Navbar.Heading>
          <HTMLSelect
            minimal
            value=""
            onChange={(e) => loadExample(e.currentTarget.value)}
            options={[{ label: 'Load example…', value: '' }, ...EXAMPLES.map((e) => ({ label: e.name, value: e.name }))]}
          />
          <Navbar.Divider />
          <ButtonGroup>
            <Button icon="reset" onClick={reset} title="Restart" disabled={hasErrors} />
            <Button icon="undo" onClick={stepBack} disabled={hasErrors || machine.step === 0} title="Step back (Shift+F10)" />
            <Button icon="step-forward" onClick={step} disabled={!canStep} title="Step (F10)">Step</Button>
            <Button
              icon={playing ? 'pause' : 'play'}
              intent={playing ? 'warning' : 'success'}
              onClick={() => setPlaying((p) => !p)}
              disabled={!canStep}
              title="Play / pause (F5)"
            >
              {playing ? 'Pause' : 'Play'}
            </Button>
            <Button icon="fast-forward" onClick={runToBreakpoint} disabled={!canStep} title="Run to next breakpoint or end" />
          </ButtonGroup>
          <div className="speed-control">
            <span className="speed-label">Speed</span>
            <Slider
              min={1}
              max={20}
              stepSize={1}
              labelValues={[]}
              value={speed}
              onChange={setSpeed}
              labelRenderer={(v) => `${v}/s`}
            />
          </div>
        </Navbar.Group>
        <Navbar.Group align="right">
          <SegmentedControl
            small
            options={[{ label: 'Hex', value: 'hex' }, { label: 'Dec', value: 'dec' }]}
            value={format}
            onValueChange={(v) => setFormat(v as ValueFormat)}
          />
          <Switch
            className="nav-switch"
            checked={highOnTop}
            onChange={() => setHighOnTop((v) => !v)}
            label="High addr on top"
          />
          <Button minimal icon={dark ? 'flash' : 'moon'} onClick={() => setDark((d) => !d)} title="Toggle theme" />
        </Navbar.Group>
      </Navbar>

      <div className="status-bar">
        <Tag minimal>Step {machine.step}</Tag>
        {current && (
          <Tag minimal intent="primary" icon="arrow-right">
            line {current.line + 1}: <code>{current.source}</code>
          </Tag>
        )}
        {machine.halted && (
          <Tag intent={machine.error ? 'danger' : 'success'} icon={machine.error ? 'error' : 'tick-circle'}>
            {machine.haltReason}
          </Tag>
        )}
        <span className="status-hint">Click a line number to set a breakpoint · F10 step · Shift+F10 back · F5 play</span>
      </div>

      <main className="workspace">
        <Card className="panel editor-panel" compact>
          <div className="panel-title">Code</div>
          <CodeEditor
            value={source}
            onChange={setSource}
            currentLine={hasErrors ? undefined : machine.currentLine}
            errors={program.errors}
            breakpoints={breakpoints}
            onToggleBreakpoint={toggleBreakpoint}
          />
          {hasErrors && (
            <Callout intent="danger" compact className="error-callout" title="Assembly errors">
              {program.errors.slice(0, 5).map((e, i) => (
                <div key={i}>Line {e.line + 1}: {e.message}</div>
              ))}
            </Callout>
          )}
        </Card>

        <Card className="panel memory-panel" compact>
          <div className="panel-title">Memory</div>
          <MemoryView machine={machine} version={version} format={format} highOnTop={highOnTop} />
        </Card>

        <div className="side-column">
          <Card className="panel registers-panel" compact>
            <div className="panel-title">Registers</div>
            <RegisterView machine={machine} version={version} format={format} />
          </Card>
          <Card className="panel console-panel" compact>
            <div className="panel-title">Console (ecall)</div>
            <pre className="console-output">{machine.output || <span className="muted">no output</span>}</pre>
          </Card>
        </div>
      </main>
    </div>
  );
}
