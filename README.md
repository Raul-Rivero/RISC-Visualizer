# RISC-V Visualizer

A step-through visualizer for small RV32 assembly snippets. Write code on the left; watch the stack on the right — every store slashes the previous value, and `sp`/`fp` slide through memory as the program runs.

Built with React, TypeScript, Vite and [Blueprint](https://github.com/palantir/blueprint).

## Features

- Editor with syntax colouring, inline assembly errors and click-to-set breakpoints
- Current-line highlight; Step (F10), Step back (Shift+F10), Play/Pause with adjustable speed (F5), run to breakpoint
- Memory view: stack words with `sp`/`fp` offsets, value history (old values struck through), freed frames dimmed, `.data` section
- Register panel with change highlighting, `ecall` console (RARS-style print/exit)

## Supported assembly

RV32I base integer instructions + M extension (`mul`/`div`/`rem`…), common pseudo-instructions (`li`, `la`, `mv`, `j`, `jr`, `ret`, `call`, `beqz`, `bgt`, …), GCC output (`%hi`/`%lo`, `.text`/`.data`, `.word`/`.half`/`.byte`/`.string`/`.space`). Execution starts at `main` (or `_start`, or the first instruction); returning through the initial `ra` halts the program.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # simulator unit tests
npm run build
```
