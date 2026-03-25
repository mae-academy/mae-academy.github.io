document.addEventListener("DOMContentLoaded", () => {
  // =========================
  // Assembler / Emulator
  // =========================
  (() => {
    const el = (id) => document.getElementById(id);
    const codeEl = el("code");
    const gutterEl = el("gutter");
    const outEl = el("out");
    const memDumpEl = el("memDump");
    const statusPill = el("statusPill");
    const baseSel = el("baseSel");
    const memStartEl = el("memStart");
    const cyclesEl = el("cycles");
    const regsGrid = el("regsGrid");
    const flagsRow = el("flagsRow");

    const LS_CODE = "asm_emulator_code_v4";
    const LS_BPS  = "asm_emulator_bps_v4";

    function setStatus(text, kind="idle"){
      statusPill.textContent = text;
      statusPill.style.borderColor =
        kind==="ok" ? "rgba(22,163,74,.35)" :
        kind==="err"? "rgba(225,29,72,.35)" :
        kind==="run"? "rgba(63,111,255,.35)" :
        "rgba(15,23,42,.14)";
      statusPill.style.background =
        kind==="ok" ? "rgba(22,163,74,.10)" :
        kind==="err"? "rgba(225,29,72,.10)" :
        kind==="run"? "rgba(63,111,255,.10)" :
        "rgba(255,255,255,.70)";
    }

    function clearOutput(){ outEl.innerHTML = ""; }
    function logLine(msg, cls=""){
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = msg + "\n";
      outEl.appendChild(span);
      outEl.scrollTop = outEl.scrollHeight;
    }

    function clamp16(x){ return ((x % 0x10000) + 0x10000) & 0xFFFF; }
    function clamp8(x){ return ((x % 0x100) + 0x100) & 0xFF; }
    function clamp32(x){ return (x >>> 0); }

    function parseNumber(tok){
      const t = tok.trim();
      if(!t) return null;
      if(/^0x[0-9a-f]+$/i.test(t)) return parseInt(t,16);
      if(/^[0-9a-f]+h$/i.test(t)) return parseInt(t.slice(0,-1),16);
      if(/^[+-]?\d+$/.test(t)) return parseInt(t,10);
      return null;
    }

    function fmt(n, width=4){
      const base = baseSel && baseSel.value;
      if(base === "dec") return String(n >>> 0);
      const hex = (n >>> 0).toString(16).toUpperCase().padStart(width,"0");
      return "0x" + hex;
    }

    // ---- CPU model ----
    const REG16 = ["AX","BX","CX","DX","SI","DI","BP","SP","IP"];
    const REG8  = ["AL","AH","BL","BH","CL","CH","DL","DH"];
    const FLAGS = ["ZF","SF","CF","OF"];

    const cpu = {
      regs: { AX:0,BX:0,CX:0,DX:0,SI:0,DI:0,BP:0,SP:0xFFFE,IP:0 },
      flags:{ ZF:0,SF:0,CF:0,OF:0 },
      cycles:0
    };

    // 64KB RAM
    const mem = new Uint8Array(0x10000);

    // Program + mappings
    let program = [];
    let ipToLine = new Map();
    let lineToIp = new Map();
    let labels = new Map();

    // ORG / data pointer
    const dataPtrDefault = 0x0100;

    // Breakpoints by line number
    let breakpoints = new Set();

    // ---- Editor gutter ----
    function getLines(){ return (codeEl ? codeEl.value : "").replace(/\r\n/g,"\n").split("\n"); }

    function refreshGutter(){
      const lines = getLines();
      const activeLine = ipToLine.get(cpu.regs.IP) ?? null;
      if(!gutterEl) return;
      gutterEl.innerHTML = "";
      for(let i=0;i<lines.length;i++){
        const ln = i+1;
        const div = document.createElement("div");
        div.className = "line";
        if(breakpoints.has(ln)) div.classList.add("bpOn");
        if(activeLine === ln) div.classList.add("active");
        const bp = document.createElement("div"); bp.className="bp";
        const num = document.createElement("div"); num.textContent = ln;
        div.appendChild(bp); div.appendChild(num);
        div.addEventListener("click", () => {
          if(breakpoints.has(ln)) breakpoints.delete(ln); else breakpoints.add(ln);
          try{ localStorage.setItem(LS_BPS, JSON.stringify([...breakpoints])); }catch{}
          refreshGutter();
        });
        gutterEl.appendChild(div);
      }
    }

    if(codeEl){
      codeEl.addEventListener("input", () => {
        try{ localStorage.setItem(LS_CODE, codeEl.value); }catch{}
        program = [];
        refreshGutter();
      });
      codeEl.addEventListener("scroll", () => { if(gutterEl) gutterEl.scrollTop = codeEl.scrollTop; });
    }

    function loadBreakpoints(){
      try{
        const raw = localStorage.getItem(LS_BPS);
        if(raw) breakpoints = new Set(JSON.parse(raw));
      }catch{}
    }

    // ---- Helpers ----
    function stripComment(line){
      const idx = line.indexOf(";");
      return (idx>=0 ? line.slice(0,idx) : line).trim();
    }

    function tokenizeCommaAware(s){
      const parts = [];
      let cur = "";
      let depth = 0;
      let inStr = false;
      let strQuote = null;

      for(let i=0;i<s.length;i++){
        const ch = s[i];

        if(!inStr && (ch === '"' || ch === "'")){
          inStr = true; strQuote = ch;
          cur += ch;
          continue;
        }else if(inStr){
          cur += ch;
          if(ch === strQuote) { inStr = false; strQuote = null; }
          continue;
        }

        if(ch === "[") depth++;
        if(ch === "]") depth--;

        if(ch === "," && depth === 0){
          parts.push(cur.trim()); cur="";
        }else{
          cur += ch;
        }
      }
      if(cur.trim()) parts.push(cur.trim());
      return parts;
    }

    // ---- Register access (16/8) ----
    function getReg16(name){ return cpu.regs[name] & 0xFFFF; }
    function setReg16(name,val){ cpu.regs[name] = clamp16(val); }

    function getReg8(name){
      const map = {
        "AL":["AX",0], "AH":["AX",8],
        "BL":["BX",0], "BH":["BX",8],
        "CL":["CX",0], "CH":["CX",8],
        "DL":["DX",0], "DH":["DX",8],
      };
      const entry = map[name];
      if(!entry) throw new Error(`Bad 8-bit register ${name}`);
      const [r,shift] = entry;
      return (getReg16(r) >> shift) & 0xFF;
    }
    function setReg8(name,val){
      const map = {
        "AL":["AX",0], "AH":["AX",8],
        "BL":["BX",0], "BH":["BX",8],
        "CL":["CX",0], "CH":["CX",8],
        "DL":["DX",0], "DH":["DX",8],
      };
      const entry = map[name];
      if(!entry) throw new Error(`Bad 8-bit register ${name}`);
      const [r,shift] = entry;
      const v = clamp8(val);
      const cur = getReg16(r);
      const mask = ~(0xFF << shift) & 0xFFFF;
      setReg16(r, (cur & mask) | (v << shift));
    }

    function isReg16(n){ return REG16.includes(n); }
    function isReg8(n){ return REG8.includes(n); }

    // ---- Flags math ----
    function setZS(width, value){
      if(width === 8){
        const v = value & 0xFF;
        cpu.flags.ZF = (v === 0) ? 1 : 0;
        cpu.flags.SF = ((v & 0x80) !== 0) ? 1 : 0;
      }else if(width === 16){
        const v = value & 0xFFFF;
        cpu.flags.ZF = (v === 0) ? 1 : 0;
        cpu.flags.SF = ((v & 0x8000) !== 0) ? 1 : 0;
      }else{ // 32
        const v = value >>> 0;
        cpu.flags.ZF = (v === 0) ? 1 : 0;
        cpu.flags.SF = ((v & 0x80000000) !== 0) ? 1 : 0;
      }
    }

    function addN(a,b,width){
      if(width === 8){
        const sum = (a & 0xFF) + (b & 0xFF);
        const res = sum & 0xFF;
        cpu.flags.CF = (sum > 0xFF) ? 1 : 0;
        const sa = (a & 0x80) !== 0, sb = (b & 0x80) !== 0, sr = (res & 0x80) !== 0;
        cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
        setZS(8,res);
        return res;
      }
      if(width === 16){
        const sum = (a & 0xFFFF) + (b & 0xFFFF);
        const res = sum & 0xFFFF;
        cpu.flags.CF = (sum > 0xFFFF) ? 1 : 0;
        const sa = (a & 0x8000) !== 0, sb = (b & 0x8000) !== 0, sr = (res & 0x8000) !== 0;
        cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
        setZS(16,res);
        return res;
      }
      // 32
      const sum = (a >>> 0) + (b >>> 0);
      const res = sum >>> 0;
      cpu.flags.CF = (sum > 0xFFFFFFFF) ? 1 : 0;
      const sa = (a & 0x80000000) !== 0, sb = (b & 0x80000000) !== 0, sr = (res & 0x80000000) !== 0;
      cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
      setZS(32,res);
      return res;
    }

    function subN(a,b,width){
      if(width === 8){
        const diff = (a & 0xFF) - (b & 0xFF);
        const res = diff & 0xFF;
        cpu.flags.CF = (diff < 0) ? 1 : 0;
        const sa = (a & 0x80) !== 0, sb = (b & 0x80) !== 0, sr = (res & 0x80) !== 0;
        cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
        setZS(8,res);
        return res;
      }
      if(width === 16){
        const diff = (a & 0xFFFF) - (b & 0xFFFF);
        const res = diff & 0xFFFF;
        cpu.flags.CF = (diff < 0) ? 1 : 0;
        const sa = (a & 0x8000) !== 0, sb = (b & 0x8000) !== 0, sr = (res & 0x8000) !== 0;
        cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
        setZS(16,res);
        return res;
      }
      // 32
      const diff = (a >>> 0) - (b >>> 0);
      const res = diff >>> 0;
      cpu.flags.CF = ((a >>> 0) < (b >>> 0)) ? 1 : 0;
      const sa = (a & 0x80000000) !== 0, sb = (b & 0x80000000) !== 0, sr = (res & 0x80000000) !== 0;
      cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
      setZS(32,res);
      return res;
    }

    // ---- Memory (Little Endian) ----
    function read8(addr){ return mem[addr & 0xFFFF] & 0xFF; }
    function write8(addr, v){ mem[addr & 0xFFFF] = clamp8(v); }
    function read16(addr){
      const a = addr & 0xFFFF;
      return (read8(a) | (read8(a+1) << 8)) & 0xFFFF;
    }
    function write16(addr, v){
      const a = addr & 0xFFFF;
      const w = v & 0xFFFF;
      write8(a, w & 0xFF);
      write8(a+1, (w >> 8) & 0xFF);
    }
    function read32(addr){
      const a = addr & 0xFFFF;
      const b0 = read8(a);
      const b1 = read8(a+1);
      const b2 = read8(a+2);
      const b3 = read8(a+3);
      return (b0 | (b1<<8) | (b2<<16) | (b3<<24)) >>> 0;
    }
    function write32(addr, v){
      const a = addr & 0xFFFF;
      const d = v >>> 0;
      write8(a, d & 0xFF);
      write8(a+1, (d >>> 8) & 0xFF);
      write8(a+2, (d >>> 16) & 0xFF);
      write8(a+3, (d >>> 24) & 0xFF);
    }

    // ---- Operand parsing ----
    function parseMemInside(inside){
      let expr = inside.replace(/\s+/g,"");
      expr = expr.replace(/-/g,"+-");

      // label[...]
      const labelMatch = expr.match(/^([A-Z_.$][A-Z0-9_.$]*)

\[([A-Z0-9+\-]*)\]

$/i);
      if(labelMatch) {
        const label = labelMatch[1];
        const regExpr = labelMatch[2];

        let baseReg = null;
        let offset = 0;
        const chunks = regExpr.split("+").filter(Boolean);
        for(const c of chunks){
          const up = c.toUpperCase();
          if(isReg16(up)) baseReg = up;
          else{
            const n = parseNumber(up);
            if(n === null) return { ok:false, error:`Bad memory expr: ${inside}` };
            offset += n;
          }
        }
        return { ok:true, baseReg, offset: clamp16(offset), label: label.toUpperCase() };
      }

      // inside without label (like SI+2 or 0x200)
      const chunks = expr.split("+").filter(Boolean);
      let baseReg = null;
      let offset = 0;
      for(const c of chunks){
        const up = c.toUpperCase();
        if(isReg16(up)) baseReg = up;
        else{
          const n = parseNumber(up);
          if(n === null) return { ok:false, error:`Bad memory expr: ${inside}` };
          offset += n;
        }
      }
      return { ok:true, baseReg, offset: clamp16(offset) };
    }

    function parseOperand(raw){
      let t = raw.trim();
      if(!t) return { type:"bad", error:"Empty operand" };
      let up = t.toUpperCase().replace(/\s+/g," ").trim();

      let size = null; // 8/16/32
      const ptrMatch = up.match(/^(BYTE|WORD|DWORD)\s+PTR\s+(.+)$/i);
      if(ptrMatch){
        const k = ptrMatch[1].toUpperCase();
        size = (k === "BYTE") ? 8 : (k === "WORD" ? 16 : 32);
        up = ptrMatch[2].trim();
      }

      const offMatch = up.match(/^OFFSET\s+([A-Z_.$][A-Z0-9_.$]*)$/i);
      if(offMatch) return { type:"offset", name: offMatch[1].toUpperCase(), size:16 };

      if(isReg16(up)) return { type:"reg16", name: up, size:16 };
      if(isReg8(up))  return { type:"reg8",  name: up, size:8 };

      // label[reg+...]
      const labelMemMatch = up.match(/^([A-Z_.$][A-Z0-9_.$]*)

\[([A-Z0-9+\- ]*)\]

$/i);
      if(labelMemMatch) {
        const parsed = parseMemInside(labelMemMatch[1] + "[" + labelMemMatch[2] + "]");
        if(!parsed.ok) return { type:"bad", error: parsed.error };
        return { type:"mem", baseReg: parsed.baseReg, offset: parsed.offset, label: parsed.label, size: size ?? 8 };
      }

      // [ ... ]
      if(up.startsWith("[") && up.endsWith("]")){
        const parsed = parseMemInside(up.slice(1,-1));
        if(!parsed.ok) return { type:"bad", error: parsed.error };
        return { type:"mem", baseReg: parsed.baseReg, offset: parsed.offset, size: size ?? 8 };
      }

      const num = parseNumber(up);
      if(num !== null) return { type:"imm", value: num >>> 0, size:16 };

      if(/^[A-Z_.$][A-Z0-9_.$]*$/i.test(up)) return { type:"label", name: up.toUpperCase(), size:16 };

      return { type:"bad", error:`Unknown operand: ${raw}` };
    }

    function addrOfMem(op){
      const regBase = op.baseReg ? getReg16(op.baseReg) : 0;
      const off = op.offset ?? 0;
      const labelBase = op.label ? (labels.get(op.label) ?? 0) : 0;
      return clamp16(labelBase + regBase + off);
    }

    function evalOperand(op){
      if(op.type === "imm") return op.value >>> 0;
      if(op.type === "reg16") return getReg16(op.name);
      if(op.type === "reg8")  return getReg8(op.name);
      if(op.type === "mem"){
        const a = addrOfMem(op);
        if(op.size === 32) return read32(a);
        if(op.size === 16) return read16(a);
        return read8(a);
      }
      throw new Error("Bad operand");
    }

    function writeOperand(op, value){
      if(op.type === "reg16"){ setReg16(op.name, value); return; }
      if(op.type === "reg8"){ setReg8(op.name, value); return; }
      if(op.type === "mem"){
        const a = addrOfMem(op);
        if(op.size === 32){ write32(a, value); return; }
        if(op.size === 16){ write16(a, value); return; }
        write8(a, value);
        return;
      }
      throw new Error("Destination must be reg or mem");
    }

    // ---- DB/DW/DD parsing ----
    function parseDataItems(argStr, directive){
      const items = tokenizeCommaAware(argStr);
      if(items.length === 0) return { ok:false, error:`${directive} needs values` };

      const bytes = [];
      const pushWord = (w) => { bytes.push(w & 0xFF, (w >> 8) & 0xFF); };
      const pushDword = (d) => {
        const v = d >>> 0;
        bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
      };

      for(const itRaw of items){
        const it = itRaw.trim();
        if(!it) continue;

        const strMatch = it.match(/^"(.*)"$/);
        if(strMatch){
          const s = strMatch[1];
          for(let i=0;i<s.length;i++){
            const ch = s.charCodeAt(i) & 0xFF;
            if(directive === "DB") bytes.push(ch);
            else if(directive === "DW") pushWord(ch);
            else pushDword(ch);
          }
          continue;
        }

        const chrMatch = it.match(/^'(.*)'$/);
        if(chrMatch){
          const s = chrMatch[1];
          const ch = (s.length ? s.charCodeAt(0) : 0) & 0xFF;
          if(directive === "DB") bytes.push(ch);
          else if(directive === "DW") pushWord(ch);
          else pushDword(ch);
          continue;
        }

        const n = parseNumber(it.toUpperCase());
        if(n === null) return { ok:false, error:`${directive} value must be number/string (got "${it}")` };

        if(directive === "DB") bytes.push(n & 0xFF);
        else if(directive === "DW") pushWord(n & 0xFFFF);
        else pushDword(n >>> 0);
      }

      return { ok:true, bytes };
    }

    // ---- Assembler (2-pass minimal) ----
    function assemble(){
      clearOutput();
      setStatus("Assembling…","run");

      const lines = getLines();
      labels = new Map();
      program = [];
      ipToLine = new Map();
      lineToIp = new Map();
      mem.fill(0);

      // PASS 1: resolve labels / sizes
      let ip = 0;
      let dataPtr = dataPtrDefault;

      for(let i=0;i<lines.length;i++){
        const ln = i+1;
        let raw = stripComment(lines[i]);
        if(!raw) continue;

        // ORG can appear anywhere
        const orgM = raw.toUpperCase().match(/^ORG\s+(.+)$/);
        if(orgM){
          const n = parseNumber(orgM[1].trim());
          if(n === null){
            logLine(`Line ${ln}: ORG needs numeric value`, "err");
            setStatus("Assemble error","err");
            return false;
          }
          dataPtr = clamp16(n);
          continue;
        }

        // --- new label detection (PASS 1) ---
        let rest = raw;
        let labelName = null;

        const firstTok = rest.match(/^([A-Z_.$][A-Z0-9_.$]*)(:?)(\s*(.*))$/i);
        if(firstTok){
          const ident = firstTok[1].toUpperCase();
          const sep = firstTok[2]; // ":" if present, "" otherwise
          const remainder = (firstTok[4] || "").trim();
          const nextTok = remainder.split(/\s+/)[0] ? remainder.split(/\s+/)[0].toUpperCase() : "";
          const isDirective = ["DB","DW","DD","ORG","EQU"].includes(nextTok);
          if(sep === ":" || isDirective || remainder === ""){
            labelName = ident;
            rest = remainder;
          }
        }

        const upRest = rest.toUpperCase();
        const isData = upRest.startsWith("DB ") || upRest.startsWith("DW ") || upRest.startsWith("DD ");

        if(labelName){
          if(labels.has(labelName)){
            logLine(`Line ${ln}: Duplicate label "${labelName}"`, "err");
            setStatus("Assemble error","err");
            return false;
          }
          labels.set(labelName, isData ? dataPtr : ip);
        }

        if(!rest) continue;

        if(isData){
          const dir = upRest.slice(0,2); // DB/DW/DD -> "DB","DW","DD"
          const parsed = parseDataItems(rest.slice(2).trim(), dir);
          if(!parsed.ok){
            logLine(`Line ${ln}: ${parsed.error}`, "err");
            setStatus("Assemble error","err");
            return false;
          }
          dataPtr = clamp16(dataPtr + parsed.bytes.length);
        }else{
          ip++;
        }
      }

      // PASS 2: emit data + program
      ip = 0;
      dataPtr = dataPtrDefault;

      for(let i=0;i<lines.length;i++){
        const ln = i+1;
        const rawLine = lines[i];
        let raw = stripComment(rawLine);
        if(!raw) continue;

        const orgM = raw.toUpperCase().match(/^ORG\s+(.+)$/);
        if(orgM){
          const n = parseNumber(orgM[1].trim());
          if(n === null){
            logLine(`Line ${ln}: ORG needs numeric value`, "err");
            setStatus("Assemble error","err");
            return false;
          }
          dataPtr = clamp16(n);
          continue;
        }

        // --- new label detection (PASS 2) ---
        let rest = raw;

        const firstTok = rest.match(/^([A-Z_.$][A-Z0-9_.$]*)(:?)(\s*(.*))$/i);
        if(firstTok){
          const ident = firstTok[1].toUpperCase();
          const sep = firstTok[2]; // ":" if present, "" otherwise
          const remainder = (firstTok[4] || "").trim();
          const nextTok = remainder.split(/\s+/)[0] ? remainder.split(/\s+/)[0].toUpperCase() : "";
          const isDirective = ["DB","DW","DD","ORG","EQU"].includes(nextTok);
          if(sep === ":" || isDirective || remainder === ""){
            // treat ident as a label and strip it from the line
            rest = remainder;
            if(!rest) continue;
          }
        }

        const upRest = rest.toUpperCase();
        if(upRest.startsWith("DB ") || upRest.startsWith("DW ") || upRest.startsWith("DD ")){
          const dir = upRest.slice(0,2);
          const parsed = parseDataItems(rest.slice(2).trim(), dir);
          if(!parsed.ok){
            logLine(`Line ${ln}: ${parsed.error}`, "err");
            setStatus("Assemble error","err");
            return false;
          }
          for(const b of parsed.bytes){
            write8(dataPtr, b);
            dataPtr = clamp16(dataPtr + 1);
          }
          continue;
        }

        const parts = rest.trim().split(/\s+/);
        const op = parts[0].toUpperCase();
        const operandStr = rest.slice(parts[0].length).trim();
        const ops = operandStr ? tokenizeCommaAware(operandStr) : [];
        const args = ops.map(parseOperand);

        for(const a of args){
          if(a.type === "bad"){
            logLine(`Line ${ln}: ${a.error}`, "err");
            setStatus("Assemble error","err");
            return false;
          }
        }

        // resolve labels + OFFSET
        for(let k=0;k<args.length;k++){
          const a = args[k];
          if(a.type === "label"){
            const val = labels.get(a.name);
            if(val === undefined){
              logLine(`Line ${ln}: Unknown label "${a.name}"`, "err");
              setStatus("Assemble error","err");
              return false;
            }
            args[k] = { type:"imm", value: val >>> 0, size:16 };
          }
          if(a.type === "offset"){
            const val = labels.get(a.name);
            if(val === undefined){
              logLine(`Line ${ln}: Unknown label "${a.name}"`, "err");
              setStatus("Assemble error","err");
              return false;
            }
            args[k] = { type:"imm", value: val >>> 0, size:16 };
          }
        }

        program.push({ op, args, line: ln, src: rawLine });
        lineToIp.set(ln, ip);
        ipToLine.set(ip, ln);
        ip++;
      }

      logLine("Assemble OK ✅", "ok");
      logLine(`Instructions: ${program.length} • Labels: ${labels.size}`, "ok");
      setStatus("Assembled","ok");
      return true;
    }

    // ---- Execution ----
    function resetCPU(keepMemory=true){
      cpu.regs.AX=0; cpu.regs.BX=0; cpu.regs.CX=0; cpu.regs.DX=0;
      cpu.regs.SI=0; cpu.regs.DI=0; cpu.regs.BP=0; cpu.regs.SP=0xFFFE;
      cpu.regs.IP=0;
      cpu.flags.ZF=0; cpu.flags.SF=0; cpu.flags.CF=0; cpu.flags.OF=0;
      cpu.cycles=0;
      if(!keepMemory) mem.fill(0);
      if(typeof updateUI === "function") updateUI();
      refreshGutter();
      refreshMemory();
    }

    function widthOfDest(op){
      if(op && op.size) return op.size;
      if(op && op.type === "reg8") return 8;
      return 16;
    }

    // Helper: ensure target is a valid program index
    function resolveJumpTarget(rawTarget, inst){
      const t = Number(rawTarget) >>> 0;
      if(Number.isInteger(t) && t >= 0 && t < program.length) return t;
      throw new Error(`Invalid jump target ${rawTarget} (not a code address) at line ${inst.line}`);
    }

    function stepOnce(){
      if(cpu.regs.IP < 0 || cpu.regs.IP >= program.length){
        logLine("Reached end of program (halt).", "warn");
        setStatus("Stopped","ok");
        return false;
      }

      const inst = program[cpu.regs.IP];
      const op = inst.op;
      const a0 = inst.args[0];
      const a1 = inst.args[1];
      const nextIP = cpu.regs.IP + 1;

      try{
        switch(op){
          case "HLT":
            cpu.regs.IP = nextIP;
            cpu.cycles++;
            logLine(`HLT at line ${inst.line}`, "ok");
            setStatus("HLT (stopped)","ok");
            if(typeof updateUI === "function") updateUI();
            refreshMemory(); refreshGutter();
            return false;

          case "MOV":{
            if(inst.args.length !== 2) throw new Error("MOV needs 2 operands");
            const destW = widthOfDest(a0);
            let v = evalOperand(a1);
            if(destW === 8) v &= 0xFF;
            else if(destW === 16) v &= 0xFFFF;
            else v = v >>> 0;
            writeOperand(a0, v);
            cpu.flags.CF=0; cpu.flags.OF=0;
            setZS(destW, v);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "ADD":{
            if(inst.args.length !== 2) throw new Error("ADD needs 2 operands");
            const w = widthOfDest(a0);
            const left = evalOperand(a0);
            const right = evalOperand(a1);
            const res = addN(left, right, w);
            writeOperand(a0, res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "SUB":{
            if(inst.args.length !== 2) throw new Error("SUB needs 2 operands");
            const w = widthOfDest(a0);
            const left = evalOperand(a0);
            const right = evalOperand(a1);
            const res = subN(left, right, w);
            writeOperand(a0, res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "INC":{
            if(inst.args.length !== 1) throw new Error("INC needs 1 operand");
            const w = widthOfDest(a0);
            const v = evalOperand(a0);
            const oldCF = cpu.flags.CF;
            const res = addN(v, 1, w);
            cpu.flags.CF = oldCF; // INC doesn't change CF
            writeOperand(a0, res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "AND":{
            if(inst.args.length !== 2) throw new Error("AND needs 2 operands");
            const w = widthOfDest(a0);
            const res = (evalOperand(a0) & evalOperand(a1)) >>> 0;
            cpu.flags.CF=0; cpu.flags.OF=0;
            setZS(w,res);
            writeOperand(a0,res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "XOR":{
            if(inst.args.length !== 2) throw new Error("XOR needs 2 operands");
            const w = widthOfDest(a0);
            const res = (evalOperand(a0) ^ evalOperand(a1)) >>> 0;
            cpu.flags.CF=0; cpu.flags.OF=0;
            setZS(w,res);
            writeOperand(a0,res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "TEST":{
            if(inst.args.length !== 2) throw new Error("TEST needs 2 operands");
            const w = widthOfDest(a0);
            const res = (evalOperand(a0) & evalOperand(a1)) >>> 0;
            cpu.flags.CF=0; cpu.flags.OF=0;
            setZS(w,res);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "JMP":{
            if(inst.args.length !== 1) throw new Error("JMP needs 1 operand");
            const rawTarget = evalOperand(a0);
            const target = resolveJumpTarget(rawTarget, inst);
            cpu.regs.IP = target;
            cpu.cycles++;
            break;
          }

          case "JZ":{
            if(inst.args.length !== 1) throw new Error("JZ needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(cpu.flags.ZF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JNZ":{
            if(inst.args.length !== 1) throw new Error("JNZ needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(!cpu.flags.ZF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JC":{
            if(inst.args.length !== 1) throw new Error("JC needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(cpu.flags.CF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JNC":{
            if(inst.args.length !== 1) throw new Error("JNC needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(!cpu.flags.CF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JO":{
            if(inst.args.length !== 1) throw new Error("JO needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(cpu.flags.OF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JNO":{
            if(inst.args.length !== 1) throw new Error("JNO needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(!cpu.flags.OF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JS":{
            if(inst.args.length !== 1) throw new Error("JS needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(cpu.flags.SF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "JNS":{
            if(inst.args.length !== 1) throw new Error("JNS needs 1 operand");
            const rawTarget = evalOperand(a0);
            if(!cpu.flags.SF){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "LOOP":{
            if(inst.args.length !== 1) throw new Error("LOOP needs 1 operand");
            setReg16("CX", (getReg16("CX") - 1) & 0xFFFF);
            const rawTarget = evalOperand(a0);
            if(getReg16("CX") !== 0){
              const target = resolveJumpTarget(rawTarget, inst);
              cpu.regs.IP = target;
            }else{
              cpu.regs.IP = nextIP;
            }
            cpu.cycles++;
            break;
          }

          case "PUSH":{
            if(inst.args.length !== 1) throw new Error("PUSH needs 1 operand");
            const v = evalOperand(a0);
            const sp = (getReg16("SP") - 2) & 0xFFFF;
            setReg16("SP", sp);
            write16(sp, v & 0xFFFF);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "POP":{
            if(inst.args.length !== 1) throw new Error("POP needs 1 operand");
            const sp = getReg16("SP");
            const v = read16(sp);
            setReg16("SP", (sp + 2) & 0xFFFF);
            writeOperand(a0, v);
            cpu.regs.IP = nextIP; cpu.cycles++;
            break;
          }

          case "CALL":{
            if(inst.args.length !== 1) throw new Error("CALL needs 1 operand");
            const rawTarget = evalOperand(a0);
            const target = resolveJumpTarget(rawTarget, inst);
            // push return IP
            const ret = (cpu.regs.IP + 1) & 0xFFFF;
            const sp = (getReg16("SP") - 2) & 0xFFFF;
            setReg16("SP", sp);
            write16(sp, ret);
            cpu.regs.IP = target;
            cpu.cycles++;
            break;
          }

          case "RET":{
            const sp = getReg16("SP");
            const ret = read16(sp);
            setReg16("SP", (sp + 2) & 0xFFFF);
            cpu.regs.IP = ret;
            cpu.cycles++;
            break;
          }

          default:
            throw new Error(`Unknown opcode "${op}" at line ${inst.line}`);
        }
      }catch(err){
        logLine(`Runtime error at line ${inst.line}: ${err.message}`, "err");
        setStatus("Runtime error","err");
        return false;
      }

      if(typeof updateUI === "function") updateUI();
      refreshMemory(); refreshGutter();
      return true;
    }

    // ---- UI / memory display helpers ----
    function refreshMemory(){
      const start = parseInt((memStartEl && memStartEl.value) || "0") || 0;
      const rows = 16;
      const cols = 16;
      if(!memDumpEl) return;
      memDumpEl.innerHTML = "";
      for(let r=0;r<rows;r++){
        const addr = (start + r*cols) & 0xFFFF;
        const row = document.createElement("div");
        row.className = "memRow";
        const addrDiv = document.createElement("div");
        addrDiv.className = "memAddr";
        addrDiv.textContent = fmt(addr,4);
        row.appendChild(addrDiv);
        for(let c=0;c<cols;c++){
          const b = read8(addr + c);
          const cell = document.createElement("div");
          cell.className = "memCell";
          cell.textContent = (b >>> 0).toString(16).toUpperCase().padStart(2,"0");
          row.appendChild(cell);
        }
        memDumpEl.appendChild(row);
      }
    }

    function updateUI(){
      if(!regsGrid || !flagsRow) return;
      regsGrid.innerHTML = "";
      for(const r of ["AX","BX","CX","DX","SI","DI","BP","SP","IP"]){
        const div = document.createElement("div");
        div.className = "reg";
        div.innerHTML = `<div class="regName">${r}</div><div class="regVal">${fmt(cpu.regs[r],4)}</div>`;
        regsGrid.appendChild(div);
      }
      flagsRow.innerHTML = "";
      for(const f of ["ZF","SF","CF","OF"]){
        const d = document.createElement("div");
        d.className = "flag";
        d.textContent = `${f}=${cpu.flags[f]}`;
        flagsRow.appendChild(d);
      }
      if(cyclesEl) cyclesEl.textContent = String(cpu.cycles);
    }

    // ---- Controls ----
    function runToCompletion(maxSteps=100000){
      setStatus("Running…","run");
      let steps = 0;
      while(steps < maxSteps){
        if(breakpoints.has(ipToLine.get(cpu.regs.IP))) {
          setStatus("Breakpoint","ok");
          logLine(`Hit breakpoint at line ${ipToLine.get(cpu.regs.IP)}`, "warn");
          break;
        }
        const ok = stepOnce();
        steps++;
        if(!ok) break;
      }
      if(steps >= maxSteps) logLine("Max steps reached", "warn");
      setStatus("Stopped","ok");
    }

    // ---- Initialization ----
    function init(){
      loadBreakpoints();
      try{
        const saved = localStorage.getItem(LS_CODE);
        if(saved && codeEl) codeEl.value = saved;
      }catch{}
      refreshGutter();
      resetCPU(false);
      assemble();
    }

    // Wire up simple buttons if present
    const btnAssemble = el("btnAssemble");
    const btnReset = el("btnReset");
    const btnStep = el("btnStep");
    const btnRun = el("btnRun");
    const btnClear = el("btnClear");

    if(btnAssemble) btnAssemble.addEventListener("click", () => { assemble(); updateUI(); refreshMemory(); });
    if(btnReset) btnReset.addEventListener("click", () => { resetCPU(false); });
    if(btnStep) btnStep.addEventListener("click", () => { stepOnce(); });
    if(btnRun) btnRun.addEventListener("click", () => { runToCompletion(); });
    if(btnClear) btnClear.addEventListener("click", () => { clearOutput(); });

    // Expose some functions for debugging in console
    window._asm = {
      assemble, stepOnce, runToCompletion, resetCPU, program, labels, mem
    };

    init();
  })();
});
