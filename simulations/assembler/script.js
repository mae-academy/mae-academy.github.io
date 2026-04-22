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

      function clamp20(x){ return ((x % 0x100000) + 0x100000) & 0xFFFFF; }
      function clamp16(x){ return ((x % 0x10000) + 0x10000) & 0xFFFF; }
      function clamp8(x){ return ((x % 0x100) + 0x100) & 0xFF; }
      function clamp32(x){ return (x >>> 0); }

      function parseNumber(tok){
        const t = tok.trim();
        if(!t) return null;
        if(/^'.{1}'$/.test(t) && t.length === 3) return t.charCodeAt(1); 
        
        let sign = 1;
        let str = t;
        if (str.startsWith("-")) {
            sign = -1;
            str = str.substring(1);
        } else if (str.startsWith("+")) {
            str = str.substring(1);
        }

        if(/^0x[0-9a-f]+$/i.test(str)) return sign * parseInt(str, 16);
        if(/^[0-9a-f]+h$/i.test(str)) return sign * parseInt(str.slice(0,-1), 16);
        if(/^0b[01]+$/i.test(str)) return sign * parseInt(str.slice(2), 2);
        if(/^[01]+b$/i.test(str)) return sign * parseInt(str.slice(0,-1), 2);
        if(/^\d+$/.test(str)) return sign * parseInt(str, 10);
        return null;
      }

      function fmt(n, width=4){
        const base = baseSel.value;
        if(base === "dec") return String(n >>> 0);
        const hex = (n >>> 0).toString(16).toUpperCase().padStart(width,"0");
        return "0x" + hex;
      }

      // ---- CPU model ----
      // MODIFIED: Explicitly including all segment registers
      const REG16 = ["AX","BX","CX","DX","SI","DI","BP","SP","IP", "DS", "CS", "ES", "SS"];
      const REG8  = ["AL","AH","BL","BH","CL","CH","DL","DH"];
      const FLAGS = ["ZF","SF","CF","OF", "AF", "DF", "IF", "TF", "PF"];

      const cpu = {
        regs: { AX:0, BX:0, CX:0, DX:0, SI:0, DI:0, BP:0, SP:0xFFFE, IP:0, DS:0, CS:0, ES:0, SS:0 },
        flags:{ ZF:0, SF:0, CF:0, OF:0, AF:0, DF:0, IF:0, TF:0, PF:0 },
        cycles:0
      };

      const mem = new Uint8Array(0x100000); 

      let program = [];
      let ipToLine = new Map();
      let lineToIp = new Map();
      let labels = new Map();
      let equMap = new Map(); // Tracks EQU definitions

      const dataPtrDefault = 0x0100;
      let breakpoints = new Set();

      let executionHistory = [];
      let memChangesThisStep = [];
      let lastModifiedAddrs = new Set(); 
      let isExecutingStep = false;

      // ---- Editor gutter ----
      function getLines(){ return codeEl.value.replace(/\r\n/g,"\n").split("\n"); }

      function refreshGutter(){
        const lines = getLines();
        const activeLine = ipToLine.get(cpu.regs.IP) ?? null;
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
            localStorage.setItem(LS_BPS, JSON.stringify([...breakpoints]));
            refreshGutter();
          });
          gutterEl.appendChild(div);
        }
      }

      // ==========================================
      // IDE FEATURES: Custom Undo History & Tab Management
      // ==========================================
      let undoStack = [];
      let isTyping = false;

      function saveHistoryState() {
          if (undoStack.length > 0 && undoStack[undoStack.length - 1].text === codeEl.value) {
              return; 
          }
          undoStack.push({
              text: codeEl.value,
              start: codeEl.selectionStart,
              end: codeEl.selectionEnd
          });
          if (undoStack.length > 50) undoStack.shift(); 
      }

      function triggerInputEvent() {
          codeEl.dispatchEvent(new Event("input"));
          saveHistoryState();
      }

      codeEl.addEventListener("input", () => {
        localStorage.setItem(LS_CODE, codeEl.value);
        program = [];
        refreshGutter();
        if (!isTyping) {
            saveHistoryState();
        }
      });
      
      codeEl.addEventListener("scroll", () => { gutterEl.scrollTop = codeEl.scrollTop; });
      
      codeEl.addEventListener("keydown", (e) => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

        if (cmdOrCtrl && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (undoStack.length > 1) {
                undoStack.pop(); 
                const prevState = undoStack[undoStack.length - 1]; 
                codeEl.value = prevState.text;
                codeEl.selectionStart = prevState.start;
                codeEl.selectionEnd = prevState.end;
                codeEl.dispatchEvent(new Event("input"));
            }
            return;
        }

        if (e.key === "Tab") {
          e.preventDefault();
          saveHistoryState(); 

          const start = codeEl.selectionStart;
          const end = codeEl.selectionEnd;
          const value = codeEl.value;
          const tabStr = "    ";

          if (start !== end) {
              const beforeSelection = value.substring(0, start);
              const afterSelection = value.substring(end);
              const startOfFirstLine = beforeSelection.lastIndexOf('\n') + 1;
              const actualSelection = value.substring(startOfFirstLine, end);
              const lines = actualSelection.split('\n');

              let newSelection = "";
              if (e.shiftKey) {
                  newSelection = lines.map(line => {
                      if (line.startsWith(tabStr)) return line.substring(4);
                      if (line.startsWith('\t')) return line.substring(1);
                      const match = line.match(/^ +/);
                      if (match) return line.substring(Math.min(match[0].length, 4));
                      return line;
                  }).join('\n');
              } else {
                  newSelection = lines.map(line => tabStr + line).join('\n');
              }

              codeEl.value = value.substring(0, startOfFirstLine) + newSelection + afterSelection;
              codeEl.selectionStart = startOfFirstLine;
              codeEl.selectionEnd = startOfFirstLine + newSelection.length;

          } else {
              if (e.shiftKey) {
                  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                  const currentLineToCursor = value.substring(lineStart, start);
                  if (currentLineToCursor.endsWith(tabStr)) {
                      codeEl.value = value.substring(0, start - 4) + value.substring(end);
                      codeEl.selectionStart = codeEl.selectionEnd = start - 4;
                  }
              } else {
                  codeEl.value = value.substring(0, start) + tabStr + value.substring(end);
                  codeEl.selectionStart = codeEl.selectionEnd = start + tabStr.length;
              }
          }
          triggerInputEvent();
        }
      });

      function loadBreakpoints(){
        try{
          const raw = localStorage.getItem(LS_BPS);
          if(raw) breakpoints = new Set(JSON.parse(raw));
        }catch{}
      }

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

          if(ch === "[" || ch === "(") depth++;
          if(ch === "]" || ch === ")") depth--;

          if(ch === "," && depth === 0){
            parts.push(cur.trim()); cur="";
          }else{
            cur += ch;
          }
        }
        if(cur.trim()) parts.push(cur.trim());
        return parts;
      }

      function getReg16(name){ return cpu.regs[name] & 0xFFFF; }
      function setReg16(name,val){ cpu.regs[name] = clamp16(val); }

      function getReg8(name){
        const map = {
          AL:["AX",0], AH:["AX",8],
          BL:["BX",0], BH:["BX",8],
          CL:["CX",0], CH:["CX",8],
          DL:["DX",0], DH:["DX",8],
        };
        const [r,shift] = map[name];
        return (getReg16(r) >> shift) & 0xFF;
      }
      function setReg8(name,val){
        const map = {
          AL:["AX",0], AH:["AX",8],
          BL:["BX",0], BH:["BX",8],
          CL:["CX",0], CH:["CX",8],
          DL:["DX",0], DH:["DX",8],
        };
        const [r,shift] = map[name];
        const v = clamp8(val);
        const cur = getReg16(r);
        const mask = ~(0xFF << shift) & 0xFFFF;
        setReg16(r, (cur & mask) | (v << shift));
      }

      function isReg16(n){ return REG16.includes(n); }
      function isReg8(n){ return REG8.includes(n); }

      function setZS(width, value){
        let popCount = 0;
        let lowestByte = value & 0xFF;
        for (let i = 0; i < 8; i++) {
          if (lowestByte & (1 << i)) popCount++;
        }
        cpu.flags.PF = (popCount % 2 === 0) ? 1 : 0;

        if(width === 8){
          const v = value & 0xFF;
          cpu.flags.ZF = (v === 0) ? 1 : 0;
          cpu.flags.SF = ((v & 0x80) !== 0) ? 1 : 0;
        }else if(width === 16){
          const v = value & 0xFFFF;
          cpu.flags.ZF = (v === 0) ? 1 : 0;
          cpu.flags.SF = ((v & 0x8000) !== 0) ? 1 : 0;
        }else{ 
          const v = value >>> 0;
          cpu.flags.ZF = (v === 0) ? 1 : 0;
          cpu.flags.SF = ((v & 0x80000000) !== 0) ? 1 : 0;
        }
      }

      function addN(a,b,width,carryIn=0){
        cpu.flags.AF = (((a & 0x0F) + (b & 0x0F) + carryIn) > 0x0F) ? 1 : 0;

        if(width === 8){
          const sum = (a & 0xFF) + (b & 0xFF) + carryIn;
          const res = sum & 0xFF;
          cpu.flags.CF = (sum > 0xFF) ? 1 : 0;
          const sa = (a & 0x80) !== 0, sb = (b & 0x80) !== 0, sr = (res & 0x80) !== 0;
          cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
          setZS(8,res);
          return res;
        }
        if(width === 16){
          const sum = (a & 0xFFFF) + (b & 0xFFFF) + carryIn;
          const res = sum & 0xFFFF;
          cpu.flags.CF = (sum > 0xFFFF) ? 1 : 0;
          const sa = (a & 0x8000) !== 0, sb = (b & 0x8000) !== 0, sr = (res & 0x8000) !== 0;
          cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
          setZS(16,res);
          return res;
        }
        const sum = (a >>> 0) + (b >>> 0) + carryIn;
        const res = sum >>> 0;
        cpu.flags.CF = (sum > 0xFFFFFFFF) ? 1 : 0;
        const sa = (a & 0x80000000) !== 0, sb = (b & 0x80000000) !== 0, sr = (res & 0x80000000) !== 0;
        cpu.flags.OF = (sa === sb && sa !== sr) ? 1 : 0;
        setZS(32,res);
        return res;
      }

      function subN(a,b,width,borrowIn=0){
        cpu.flags.AF = (((a & 0x0F) - (b & 0x0F) - borrowIn) < 0) ? 1 : 0;

        if(width === 8){
          const diff = (a & 0xFF) - (b & 0xFF) - borrowIn;
          const res = diff & 0xFF;
          cpu.flags.CF = (diff < 0) ? 1 : 0;
          const sa = (a & 0x80) !== 0, sb = (b & 0x80) !== 0, sr = (res & 0x80) !== 0;
          cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
          setZS(8,res);
          return res;
        }
        if(width === 16){
          const diff = (a & 0xFFFF) - (b & 0xFFFF) - borrowIn;
          const res = diff & 0xFFFF;
          cpu.flags.CF = (diff < 0) ? 1 : 0;
          const sa = (a & 0x8000) !== 0, sb = (b & 0x8000) !== 0, sr = (res & 0x8000) !== 0;
          cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
          setZS(16,res);
          return res;
        }
        const diff = (a >>> 0) - (b >>> 0) - borrowIn;
        const res = diff >>> 0;
        cpu.flags.CF = ((a >>> 0) < (b >>> 0) + borrowIn) ? 1 : 0;
        const sa = (a & 0x80000000) !== 0, sb = (b & 0x80000000) !== 0, sr = (res & 0x80000000) !== 0;
        cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
        setZS(32,res);
        return res;
      }

      function read8(addr){ return mem[clamp20(addr)] & 0xFF; }
      
      function write8(addr, v){ 
        const a = clamp20(addr);
        if (isExecutingStep) {
            memChangesThisStep.push({ addr: a, oldVal: mem[a] });
        }
        lastModifiedAddrs.add(a); 
        mem[a] = clamp8(v); 
      }
      
      function read16(addr){
        const a = clamp20(addr);
        return (read8(a) | (read8(a+1) << 8)) & 0xFFFF;
      }
      function write16(addr, v){
        const a = clamp20(addr);
        const w = v & 0xFFFF;
        write8(a, w & 0xFF);
        write8(a+1, (w >> 8) & 0xFF);
      }
      function read32(addr){
        const a = clamp20(addr);
        const b0 = read8(a);
        const b1 = read8(a+1);
        const b2 = read8(a+2);
        const b3 = read8(a+3);
        return (b0 | (b1<<8) | (b2<<16) | (b3<<24)) >>> 0;
      }
      function write32(addr, v){
        const a = clamp20(addr);
        const d = v >>> 0;
        write8(a, d & 0xFF);
        write8(a+1, (d >>> 8) & 0xFF);
        write8(a+2, (d >>> 16) & 0xFF);
        write8(a+3, (d >>> 24) & 0xFF);
      }

      function parseMemInside(inside){
        let expr = inside.replace(/\s+/g,"");
        expr = expr.replace(/-/g,"+-");
        
        let segmentOverride = null;
        if (expr.includes(":")) {
            const parts = expr.split(":");
            segmentOverride = parts[0].toUpperCase();
            expr = parts[1];
        }

        const labelMatch = expr.match(/^([A-Z_.$][A-Z0-9_.$]*)\[([A-Z0-9+\-]*)\]$/i);
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
          return { ok:true, segmentOverride, baseReg, offset: clamp16(offset), label: label.toUpperCase() };
        }

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
        return { ok:true, segmentOverride, baseReg, offset: clamp16(offset) };
      }

      function parseOperand(raw){
        let t = raw.trim();
        if(!t) return { type:"bad", error:"Empty operand" };
        let up = t.toUpperCase().replace(/\s+/g," ").trim();

        let size = null; 
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

        const labelMemMatch = up.match(/^([A-Z_.$][A-Z0-9_.$]*)\[([A-Z0-9+\- ]*)\]$/i);
        if(labelMemMatch) {
          const parsed = parseMemInside(labelMemMatch[1] + "[" + labelMemMatch[2] + "]");
          if(!parsed.ok) return { type:"bad", error: parsed.error };
          return { type:"mem", segmentOverride: parsed.segmentOverride, baseReg: parsed.baseReg, offset: parsed.offset, label: parsed.label, size: size || null };
        }

        if(up.startsWith("[") && up.endsWith("]")){
          const parsed = parseMemInside(up.slice(1,-1));
          if(!parsed.ok) return { type:"bad", error: parsed.error };
          return { type:"mem", segmentOverride: parsed.segmentOverride, baseReg: parsed.baseReg, offset: parsed.offset, size: size || null };
        }

        const labelOffsetMatch = up.match(/^([A-Z_.$][A-Z0-9_.$]*)([+-]\d+)$/i);
        if(labelOffsetMatch) {
          const parsed = parseMemInside(labelOffsetMatch[1] + "[" + labelOffsetMatch[2] + "]");
          if(!parsed.ok) return { type:"bad", error: parsed.error };
          return { type:"mem", segmentOverride: parsed.segmentOverride, baseReg: parsed.baseReg, offset: parsed.offset, label: parsed.label, size: size || null };
        }

        const num = parseNumber(up);
        if(num !== null) return { type:"imm", value: num >>> 0, size:16 };

        if(/^[A-Z_.$][A-Z0-9_.$]*$/i.test(up)) return { type:"label", name: up.toUpperCase(), size: size || null };

        return { type:"bad", error:`Unknown operand: ${raw}` };
      }

      function addrOfMem(op){
        const regBase = op.baseReg ? getReg16(op.baseReg) : 0;
        const off = op.offset ?? 0;
        const labelBase = op.label ? (labels.get(op.label) ?? 0) : 0;
        
        const effectiveAddress = clamp16(labelBase + regBase + off);
        
        // MODIFIED: Support Segment Overrides (ES:, CS:, SS:, default DS:)
        let segmentName = op.segmentOverride || "DS";
        if (!["DS", "CS", "ES", "SS"].includes(segmentName)) segmentName = "DS"; 
        const segmentBase = getReg16(segmentName) << 4;
        
        return clamp20(segmentBase + effectiveAddress);
      }

      function getEffectiveWidth(a0, a1) {
        if (a0 && a0.size) return a0.size;
        if (a1 && a1.size) return a1.size;
        return 16; 
      }

      function evalOperand(op, impliedSize){
        if(op.type === "imm") return op.value >>> 0;
        if(op.type === "reg16") return getReg16(op.name);
        if(op.type === "reg8")  return getReg8(op.name);
        if(op.type === "mem"){
          const a = addrOfMem(op);
          const sz = op.size || impliedSize || 16;
          if(sz === 32) return read32(a);
          if(sz === 16) return read16(a);
          return read8(a);
        }
        throw new Error("Bad operand");
      }

      function writeOperand(op, value, impliedSize){
        if(op.type === "reg16"){ setReg16(op.name, value); return; }
        if(op.type === "reg8"){ setReg8(op.name, value); return; }
        if(op.type === "mem"){
          const a = addrOfMem(op);
          const sz = op.size || impliedSize || 16;
          if(sz === 32){ write32(a, value); return; }
          if(sz === 16){ write16(a, value); return; }
          write8(a, value);
          return;
        }
        throw new Error("Destination must be reg or mem");
      }

      function evalDataExpr(expr, pass, labelsMap) {
        let clean = expr.replace(/^OFFSET\s+/i, "").replace(/\s+/g,"");
        const tokens = clean.split(/([+-])/).filter(Boolean);
        if(tokens.length === 0) return null;

        let result = 0;
        let currentOp = '+';

        for(let i=0; i<tokens.length; i++){
          const tok = tokens[i];
          if(tok === '+' || tok === '-'){ currentOp = tok; continue; }
          
          let val = 0;
          const upTok = tok.toUpperCase();
          
          if(labelsMap.has(upTok)) {
            val = labelsMap.get(upTok); 
          } else {
            const parsed = parseNumber(tok);
            if(parsed === null) {
              if (pass === 1) {
                 val = 0; 
              } else {
                 return null; 
              }
            } else {
              val = parsed;
            }
          }

          if(currentOp === '+') result += val;
          else if(currentOp === '-') result -= val;
        }
        return clamp32(result);
      }

      function parseDataItems(argStr, directive, pass, labelsMap){
        const items = tokenizeCommaAware(argStr);
        if(items.length === 0) return { ok:false, error:`${directive} needs values` };

        const bytes = [];
        const pushWord = (w) => { bytes.push(w & 0xFF, (w >> 8) & 0xFF); };
        const pushDword = (d) => {
          const v = d >>> 0;
          bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
        }

        const processSingleValue = (valStr) => {
          const it = valStr.trim();
          if(!it) return true; 

          const strMatch = it.match(/^["'](.*)["']$/);
          if(strMatch){
            const s = strMatch[1];
            // MODIFIED: Loop through every character in a string definition to record actual ASCII digit!
            for(let i=0;i<s.length;i++){
              const ch = s.charCodeAt(i) & 0xFF;
              if(directive === "DB") bytes.push(ch);
              else if(directive === "DW") pushWord(ch);
              else pushDword(ch);
            }
            return true;
          }
          
          if(it === "?") {
            if(directive === "DB") bytes.push(0);
            else if(directive === "DW") pushWord(0);
            else pushDword(0);
            return true;
          }
          
          let n = evalDataExpr(it, pass, labelsMap);
          if(n === null) return false;

          if(directive === "DB") bytes.push(n & 0xFF);
          else if(directive === "DW") pushWord(n & 0xFFFF);
          else pushDword(n >>> 0);
          return true;
        };

        for(const itRaw of items){
          const it = itRaw.trim();
          if(!it) continue;

          const dupMatch = it.match(/^(.+?)\s+DUP\s*\((.+)\)$/i);
          if(dupMatch){
            const countStr = dupMatch[1];
            const valStr = dupMatch[2];
            
            const count = evalDataExpr(countStr, pass, labelsMap);
            
            if(count === null || count < 0 || count > 0x100000){
              return { ok:false, error:`Invalid DUP count: "${countStr}"` };
            }
            
            for(let c = 0; c < count; c++){
              if(!processSingleValue(valStr)){
                return { ok:false, error:`Invalid DUP value: "${valStr}"` };
              }
            }
            continue;
          }

          if(!processSingleValue(it)){
             return { ok:false, error:`${directive} value must be number/string (got "${it}")` };
          }
        }

        return { ok:true, bytes };
      }

      function assemble(){
        clearOutput();
        setStatus("Assembling…","run");

        let lines = getLines();
        labels = new Map();
        equMap = new Map();
        program = [];
        ipToLine = new Map();
        lineToIp = new Map();
        mem.fill(0);
        executionHistory = []; 

        let ip = 0;
        let dataPtr = dataPtrDefault;

        // INJECTED PASS 0: Search and log EQU constants
        for(let i=0; i<lines.length; i++){
            let raw = stripComment(lines[i]);
            if(!raw) continue;
            
            const equMatch = raw.match(/^([A-Z_.$][A-Z0-9_.$]*)\s+EQU\s+(.+)$/i);
            if (equMatch) {
                equMap.set(equMatch[1].toUpperCase(), equMatch[2].trim());
            }
        }

        // Apply EQU Replacements to all lines before Pass 1
        for (let i = 0; i < lines.length; i++) {
            let raw = lines[i];
            for (let [key, val] of equMap.entries()) {
                const regex = new RegExp(`\\b${key}\\b`, "gi");
                raw = raw.replace(regex, val);
            }
            lines[i] = raw;
        }

        // Pass 1
        for(let i=0;i<lines.length;i++){
          const ln = i+1;
          let raw = stripComment(lines[i]);
          if(!raw) continue;

          // Skip EQU lines during actual assembly passes
          if (raw.toUpperCase().includes(" EQU ")) continue;

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

          let rest = raw;
          let labelName = null;

          const colonLabelMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*):/i);
          if(colonLabelMatch){
            labelName = colonLabelMatch[1].toUpperCase();
            rest = rest.slice(colonLabelMatch[0].length).trim();
          } else {
            const noColonMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*)\s+(DB|DW|DD)\b/i);
            if(noColonMatch){
              labelName = noColonMatch[1].toUpperCase();
              rest = rest.slice(noColonMatch[1].length).trim();
            }
          }

          const parts = rest.trim().split(/\s+/);
          let op = parts[0].toUpperCase();
          if (op.startsWith("REP") && parts.length > 1) {
              op = op + " " + parts[1].toUpperCase();
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
            const dir = upRest.slice(0,2);
            const parsed = parseDataItems(rest.slice(2).trim(), dir, 1, labels);
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

        // Pass 2
        ip = 0;
        dataPtr = dataPtrDefault;
        
        // MODIFIED: Include JCXZ 
        const controlFlowOps = [
          "JMP", "JZ", "JE", "JNZ", "JNE", "LOOP", "CALL", "JP", "JPE", "JNP", "JPO",
          "JG", "JGE", "JL", "JLE", "JA", "JAE", "JB", "JBE", "JC", "JNC", "JCXZ"
        ];

        for(let i=0;i<lines.length;i++){
          const ln = i+1;
          const rawLine = lines[i];
          let raw = stripComment(rawLine);
          if(!raw) continue;

          if (raw.toUpperCase().includes(" EQU ")) continue;

          const orgM = raw.toUpperCase().match(/^ORG\s+(.+)$/);
          if(orgM){
            const n = parseNumber(orgM[1].trim());
            if(n === null) return false;
            dataPtr = clamp16(n);
            continue;
          }

          let rest = raw;
          const colonLabelMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*):/i);
          if(colonLabelMatch){
            rest = rest.slice(colonLabelMatch[0].length).trim();
            if(!rest) continue;
          } else {
            const noColonMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*)\s+(DB|DW|DD)\b/i);
            if(noColonMatch) rest = rest.slice(noColonMatch[1].length).trim();
          }

          const upRest = rest.toUpperCase();
          if(upRest.startsWith("DB ") || upRest.startsWith("DW ") || upRest.startsWith("DD ")){
            const dir = upRest.slice(0,2);
            const parsed = parseDataItems(rest.slice(2).trim(), dir, 2, labels);
            if(!parsed.ok) return false;
            for(const b of parsed.bytes){
              write8(dataPtr, b);
              dataPtr = clamp16(dataPtr + 1);
            }
            continue;
          }

          const parts = rest.trim().split(/\s+/);
          let op = parts[0].toUpperCase();
          let operandStr = rest.slice(parts[0].length).trim();
          
          if (op.startsWith("REP") && parts.length > 1) {
              const nextOp = parts[1].toUpperCase();
              op = op + " " + nextOp;
              const matchNextOp = new RegExp("^" + nextOp, "i");
              operandStr = operandStr.replace(matchNextOp, "").trim();
          }

          const ops = operandStr ? tokenizeCommaAware(operandStr) : [];
          const args = ops.map(parseOperand);

          for(const a of args){
            if(a.type === "bad") { logLine(`Line ${ln}: ${a.error}`, "err"); return false; }
          }

          for(let k=0;k<args.length;k++){
            const a = args[k];
            if(a.type === "label"){
              const val = labels.get(a.name);
              if(val === undefined) { logLine(`Line ${ln}: Unknown label "${a.name}"`, "err"); return false; }
              if(controlFlowOps.includes(op)) {
                args[k] = { type:"imm", value: val >>> 0, size: a.size || 16 };
              } else {
                args[k] = { type:"mem", baseReg: null, offset: val, label: null, size: a.size || null };
              }
            }
            if(a.type === "offset"){
              const val = labels.get(a.name);
              if(val === undefined) { logLine(`Line ${ln}: Unknown label "${a.name}"`, "err"); return false; }
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
        cpu.regs.IP=0; cpu.regs.DS=0; 
        cpu.regs.CS=0; cpu.regs.ES=0; cpu.regs.SS=0; 
        
        cpu.flags.ZF=0; cpu.flags.SF=0; cpu.flags.CF=0; cpu.flags.OF=0;
        cpu.flags.AF=0; cpu.flags.DF=0; cpu.flags.IF=0; cpu.flags.TF=0; 
        cpu.flags.PF=0;
        
        cpu.cycles=0;
        executionHistory = []; 
        lastModifiedAddrs.clear(); 
        
        if(!keepMemory) mem.fill(0);
        updateUI();
        refreshGutter();
        refreshMemory();
      }

      function stepOnce(){
        lastModifiedAddrs.clear(); 

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

          // ==========================================
          // DYNAMIC ROUTING: REPs and String Operations
          // ==========================================
          let baseOp = op;
          let repPrefix = null;

          if (op.startsWith("REP")) {
              const parts = op.split(" ");
              repPrefix = parts[0]; 
              baseOp = parts[1];
          }

          const isStringOp = ["MOVSB", "MOVSW", "LODSB", "LODSW", "STOSB", "STOSW", "CMPSB", "CMPSW", "SCASB", "SCASW"].includes(baseOp);

          if (isStringOp) {
              const size = baseOp.endsWith("B") ? 1 : 2;

              if (repPrefix && getReg16("CX") === 0) {
                  cpu.regs.IP = nextIP;
                  cpu.cycles++;
                  return true;
              }

              if (baseOp.startsWith("MOVS")) {
                  const src = clamp20((getReg16("DS") << 4) + getReg16("SI"));
                  const dst = clamp20((getReg16("ES") << 4) + getReg16("DI"));
                  if(size === 1) write8(dst, read8(src));
                  else write16(dst, read16(src));
                  
                  const step = cpu.flags.DF ? -size : size;
                  setReg16("SI", getReg16("SI") + step);
                  setReg16("DI", getReg16("DI") + step);
                  cpu.cycles += 2;
              } else if (baseOp.startsWith("LODS")) {
                  const src = clamp20((getReg16("DS") << 4) + getReg16("SI"));
                  if(size === 1) setReg8("AL", read8(src));
                  else setReg16("AX", read16(src));
                  
                  const step = cpu.flags.DF ? -size : size;
                  setReg16("SI", getReg16("SI") + step);
                  cpu.cycles += 1;
              } else if (baseOp.startsWith("STOS")) {
                  const dst = clamp20((getReg16("ES") << 4) + getReg16("DI"));
                  if(size === 1) write8(dst, getReg8("AL"));
                  else write16(dst, getReg16("AX"));
                  
                  const step = cpu.flags.DF ? -size : size;
                  setReg16("DI", getReg16("DI") + step);
                  cpu.cycles += 1;
              } else if (baseOp.startsWith("CMPS")) {
                  const src = clamp20((getReg16("DS") << 4) + getReg16("SI"));
                  const dst = clamp20((getReg16("ES") << 4) + getReg16("DI"));
                  const valSrc = size === 1 ? read8(src) : read16(src);
                  const valDst = size === 1 ? read8(dst) : read16(dst);
                  subN(valSrc, valDst, size * 8, 0); 
                  
                  const step = cpu.flags.DF ? -size : size;
                  setReg16("SI", getReg16("SI") + step);
                  setReg16("DI", getReg16("DI") + step);
                  cpu.cycles += 2;
              } else if (baseOp.startsWith("SCAS")) {
                  const dst = clamp20((getReg16("ES") << 4) + getReg16("DI"));
                  const valDst = size === 1 ? read8(dst) : read16(dst);
                  const valAcc = size === 1 ? getReg8("AL") : getReg16("AX");
                  subN(valAcc, valDst, size * 8, 0); 
                  
                  const step = cpu.flags.DF ? -size : size;
                  setReg16("DI", getReg16("DI") + step);
                  cpu.cycles += 1;
              }

              if (repPrefix) {
                  setReg16("CX", getReg16("CX") - 1);
                  let continueLoop = (getReg16("CX") !== 0);

                  if (continueLoop && (repPrefix === "REPE" || repPrefix === "REPZ")) {
                      continueLoop = (cpu.flags.ZF === 1);
                  } else if (continueLoop && (repPrefix === "REPNE" || repPrefix === "REPNZ")) {
                      continueLoop = (cpu.flags.ZF === 0);
                  }

                  if (!continueLoop) {
                      cpu.regs.IP = nextIP;
                  }
              } else {
                  cpu.regs.IP = nextIP;
              }

              return true; 
          }

          // ==========================================
          // STANDARD INSTRUCTIONS
          // ==========================================
          switch(op){
            case "HLT":
              cpu.regs.IP = nextIP;
              cpu.cycles++;
              logLine(`HLT at line ${inst.line}`, "ok");
              setStatus("HLT (stopped)","ok");
              return false;

            case "NOP": {
              if(inst.args.length !== 0) throw new Error("NOP takes 0 operands");
              cpu.regs.IP = nextIP; 
              cpu.cycles += 3; 
              break;
            }

            case "CLD": cpu.flags.DF = 0; cpu.regs.IP = nextIP; cpu.cycles++; break;
            case "STD": cpu.flags.DF = 1; cpu.regs.IP = nextIP; cpu.cycles++; break;
            case "CLI": cpu.flags.IF = 0; cpu.regs.IP = nextIP; cpu.cycles++; break;
            case "STI": cpu.flags.IF = 1; cpu.regs.IP = nextIP; cpu.cycles++; break;

            case "LEA": {
              if(inst.args.length !== 2) throw new Error("LEA needs 2 operands");
              if(a0.type !== "reg16") throw new Error("LEA destination must be a 16-bit register");
              if(a1.type !== "mem") throw new Error("LEA source must be a memory operand");

              const regBase = a1.baseReg ? getReg16(a1.baseReg) : 0;
              const off = a1.offset ?? 0;
              const labelBase = a1.label ? (labels.get(a1.label) ?? 0) : 0; 
              
              const ea = clamp16(labelBase + regBase + off);

              setReg16(a0.name, ea);
              cpu.regs.IP = nextIP; cpu.cycles += 2;
              break;
            }

            case "XCHG": {
              if(inst.args.length !== 2) throw new Error("XCHG needs 2 operands");
              if(a0.type === "imm" || a1.type === "imm") throw new Error("Cannot XCHG with immediate values");
              if(a0.type === "mem" && a1.type === "mem") throw new Error("Cannot XCHG memory to memory");
              if((a0.name === "DS") || (a1.name === "DS")) throw new Error("Cannot XCHG segment register DS");
              
              const w = getEffectiveWidth(a0, a1);
              const val0 = evalOperand(a0, w);
              const val1 = evalOperand(a1, w);
              
              writeOperand(a0, val1, w);
              writeOperand(a1, val0, w);
              
              cpu.regs.IP = nextIP; cpu.cycles += 3;
              break;
            }

            case "MOV":{
              if(inst.args.length !== 2) throw new Error("MOV needs 2 operands");
              if(a0.type === "reg16" && a0.name === "DS" && a1.type === "imm") {
                throw new Error("Cannot move immediate value directly into DS register");
              }

              const w = getEffectiveWidth(a0, a1);
              let v = evalOperand(a1, w);

              if(w === 8) v &= 0xFF;
              else if(w === 16) v &= 0xFFFF;
              else v = v >>> 0;

              writeOperand(a0, v, w);
              cpu.flags.CF=0; cpu.flags.OF=0;
              setZS(w, v);

              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }
            
            case "SHL": case "SAL":
            case "SHR": case "SAR":
            case "ROL": case "ROR":
            case "RCL": case "RCR": {
              if(inst.args.length !== 2) throw new Error(op + " needs 2 operands");
              if(a0 && a0.name === "DS") throw new Error(`Cannot perform ${op} on segment register DS`);

              const w = getEffectiveWidth(a0, null);
              let v = evalOperand(a0, w);
              let count = evalOperand(a1, 8) & 0x1F;

              if (count === 0) {
                cpu.regs.IP = nextIP; cpu.cycles++;
                break;
              }

              const msbMask = (w === 8) ? 0x80 : 0x8000;
              let cf = cpu.flags.CF;
              let lastShiftOut = 0;
              let originalV = v;

              for(let i=0; i<count; i++){
                if(op === "SHL" || op === "SAL") {
                  lastShiftOut = (v & msbMask) ? 1 : 0;
                  v = (v << 1) >>> 0;
                } else if(op === "SHR") {
                  lastShiftOut = (v & 1);
                  v = (v >>> 1);
                } else if(op === "SAR") {
                  lastShiftOut = (v & 1);
                  const isNeg = v & msbMask;
                  v = (v >>> 1);
                  if(isNeg) v |= msbMask;
                } else if(op === "ROL") {
                  lastShiftOut = (v & msbMask) ? 1 : 0;
                  v = (v << 1) >>> 0;
                  if(lastShiftOut) v |= 1;
                } else if(op === "ROR") {
                  lastShiftOut = (v & 1);
                  v = (v >>> 1);
                  if(lastShiftOut) v |= msbMask;
                } else if(op === "RCL") {
                  lastShiftOut = (v & msbMask) ? 1 : 0;
                  v = (v << 1) >>> 0;
                  if(cf) v |= 1;
                  cf = lastShiftOut;
                } else if(op === "RCR") {
                  lastShiftOut = (v & 1);
                  v = (v >>> 1);
                  if(cf) v |= msbMask;
                  cf = lastShiftOut;
                }
                
                if(w === 8) v &= 0xFF; else v &= 0xFFFF;
              }

              cpu.flags.CF = (op === "RCL" || op === "RCR") ? cf : lastShiftOut;

              if (count === 1) {
                if(op === "SHL" || op === "SAL") {
                  cpu.flags.OF = ((v & msbMask) ? 1 : 0) ^ cpu.flags.CF;
                } else if(op === "SHR") {
                  cpu.flags.OF = (originalV & msbMask) ? 1 : 0;
                } else if(op === "SAR") {
                  cpu.flags.OF = 0;
                } else if(op === "ROL" || op === "RCL") {
                  cpu.flags.OF = cpu.flags.CF ^ ((v & msbMask) ? 1 : 0);
                } else if(op === "ROR" || op === "RCR") {
                  const msb = (v & msbMask) ? 1 : 0;
                  const msbMinus1 = (v & (msbMask >>> 1)) ? 1 : 0;
                  cpu.flags.OF = msb ^ msbMinus1;
                }
              }

              if(op === "SHL" || op === "SAL" || op === "SHR" || op === "SAR") {
                setZS(w, v);
              }

              writeOperand(a0, v, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "ADD":
            case "SUB":
            case "ADC":
            case "SBB":
            case "CMP": 
            case "AND":
            case "OR":
            case "XOR":
            case "TEST": {
              if(inst.args.length !== 2) throw new Error(op + " needs 2 operands");
              if((a0 && a0.name === "DS") || (a1 && a1.name === "DS")) {
                 throw new Error(`Cannot perform ${op} on segment register DS`);
              }

              const w = getEffectiveWidth(a0, a1);
              const left = evalOperand(a0, w);
              const right = evalOperand(a1, w);
              let res;

              if(op === "ADD") res = addN(left, right, w, 0);
              else if(op === "ADC") res = addN(left, right, w, cpu.flags.CF);
              else if(op === "SUB" || op === "CMP") res = subN(left, right, w, 0);
              else if(op === "SBB") res = subN(left, right, w, cpu.flags.CF);
              else if(op === "AND") {
                res = (left & right) >>> 0;
                if(w===8) res &= 0xFF; else if(w===16) res &= 0xFFFF;
                cpu.flags.CF=0; cpu.flags.OF=0; cpu.flags.AF=0; setZS(w, res);
              } else if(op === "OR") {
                res = (left | right) >>> 0;
                if(w===8) res &= 0xFF; else if(w===16) res &= 0xFFFF;
                cpu.flags.CF=0; cpu.flags.OF=0; cpu.flags.AF=0; setZS(w, res);
              } else if(op === "XOR") {
                res = (left ^ right) >>> 0;
                if(w===8) res &= 0xFF; else if(w===16) res &= 0xFFFF;
                cpu.flags.CF=0; cpu.flags.OF=0; cpu.flags.AF=0; setZS(w, res);
              } else if(op === "TEST") {
                res = (left & right) >>> 0;
                if(w===8) res &= 0xFF; else if(w===16) res &= 0xFFFF;
                cpu.flags.CF=0; cpu.flags.OF=0; cpu.flags.AF=0; setZS(w, res);
              }

              if(op !== "CMP" && op !== "TEST") writeOperand(a0, res, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "NOT":
            case "NEG": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              if (a0 && a0.name === "DS") throw new Error(`Cannot perform ${op} on segment register DS`);
              
              const w = getEffectiveWidth(a0, null);
              const v = evalOperand(a0, w);
              let res;

              if (op === "NOT") {
                res = (~v) >>> 0;
                if (w === 8) res &= 0xFF;
                if (w === 16) res &= 0xFFFF;
              } else {
                res = subN(0, v, w, 0); 
              }

              writeOperand(a0, res, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "MUL":
            case "DIV": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              if(a0 && a0.name === "DS") throw new Error(`Cannot perform ${op} on segment register DS`);
              
              const w = getEffectiveWidth(a0, null);
              if (w === null || w === 32) throw new Error("Missing operand size or unsupported 32-bit for " + op);
              
              const v = evalOperand(a0, w);
              
              if(op === "MUL") {
                if(w === 8) {
                  const res = getReg8("AL") * v;
                  setReg16("AX", res);
                  cpu.flags.CF = cpu.flags.OF = (res > 0xFF) ? 1 : 0;
                } else if (w === 16) {
                  const res = getReg16("AX") * v;
                  setReg16("AX", res & 0xFFFF);
                  setReg16("DX", Math.floor(res / 0x10000) & 0xFFFF);
                  cpu.flags.CF = cpu.flags.OF = (res > 0xFFFF) ? 1 : 0;
                }
              } else { 
                if(v === 0) throw new Error("Divide by zero");
                if(w === 8) {
                  const dividend = getReg16("AX");
                  const quotient = Math.floor(dividend / v);
                  const remainder = dividend % v;
                  if(quotient > 0xFF) throw new Error("Divide error (overflow)");
                  setReg8("AL", quotient);
                  setReg8("AH", remainder);
                } else if (w === 16) {
                  const dividend = (getReg16("DX") * 0x10000) + getReg16("AX");
                  const quotient = Math.floor(dividend / v);
                  const remainder = dividend % v;
                  if(quotient > 0xFFFF) throw new Error("Divide error (overflow)");
                  setReg16("AX", quotient);
                  setReg16("DX", remainder);
                }
              }
              cpu.regs.IP = nextIP; cpu.cycles += 10;
              break;
            }

            case "INC":
            case "DEC": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              if (a0 && a0.name === "DS") throw new Error(`Cannot perform ${op} on segment register DS`);
              
              const w = getEffectiveWidth(a0, null);
              const v = evalOperand(a0, w);
              const oldCF = cpu.flags.CF; 
              const res = op === "INC" ? addN(v, 1, w, 0) : subN(v, 1, w, 0);
              cpu.flags.CF = oldCF;
              writeOperand(a0, res, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "PUSH": {
              if(inst.args.length !== 1) throw new Error("PUSH needs 1 operand");
              const v = evalOperand(a0, 16) & 0xFFFF;
              cpu.regs.SP = (cpu.regs.SP - 2) & 0xFFFF;
              // MODIFIED: Writes to SS segment!
              const spAddr = clamp20((getReg16("SS") << 4) + cpu.regs.SP);
              const w = v & 0xFFFF;
              write8(spAddr, w & 0xFF);
              write8(spAddr+1, (w >> 8) & 0xFF); 
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "POP": {
              if(inst.args.length !== 1) throw new Error("POP needs 1 operand");
              // MODIFIED: Reads from SS segment!
              const spAddr = clamp20((getReg16("SS") << 4) + cpu.regs.SP);
              const v = (read8(spAddr) | (read8(spAddr+1) << 8)) & 0xFFFF;
              cpu.regs.SP = (cpu.regs.SP + 2) & 0xFFFF;
              writeOperand(a0, v, 16);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "CALL": {
              if(inst.args.length !== 1) throw new Error("CALL needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.SP = (cpu.regs.SP - 2) & 0xFFFF;
              // MODIFIED: Writes to SS segment!
              const spAddr = clamp20((getReg16("SS") << 4) + cpu.regs.SP);
              const w = nextIP & 0xFFFF;
              write8(spAddr, w & 0xFF);
              write8(spAddr+1, (w >> 8) & 0xFF); 
              cpu.regs.IP = clamp16(target);
              cpu.cycles++;
              break;
            }

            case "RET": {
              // MODIFIED: Reads from SS segment!
              const spAddr = clamp20((getReg16("SS") << 4) + cpu.regs.SP);
              const retIP = (read8(spAddr) | (read8(spAddr+1) << 8)) & 0xFFFF;
              cpu.regs.SP = (cpu.regs.SP + 2) & 0xFFFF;
              cpu.regs.IP = retIP;
              cpu.cycles++;
              break;
            }

            case "JMP":{
              if(inst.args.length !== 1) throw new Error("JMP needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = clamp16(target);
              cpu.cycles++;
              break;
            }

            case "JZ": case "JE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = cpu.flags.ZF ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "JNZ": case "JNE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = !cpu.flags.ZF ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "JP": case "JPE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = cpu.flags.PF ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JNP": case "JPO": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = !cpu.flags.PF ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "JG": case "JNLE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.ZF === 0) && (cpu.flags.SF === cpu.flags.OF);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JGE": case "JNL": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.SF === cpu.flags.OF);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JL": case "JNGE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.SF !== cpu.flags.OF);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JLE": case "JNG": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.ZF === 1) || (cpu.flags.SF !== cpu.flags.OF);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JA": case "JNBE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.CF === 0) && (cpu.flags.ZF === 0);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JAE": case "JNB": case "JNC": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.CF === 0);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JB": case "JNAE": case "JC": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.CF === 1);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }
            case "JBE": case "JNA": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              const condition = (cpu.flags.CF === 1) || (cpu.flags.ZF === 1);
              cpu.regs.IP = condition ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "JCXZ": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = (getReg16("CX") === 0) ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "LOOP":{
              if(inst.args.length !== 1) throw new Error("LOOP needs 1 operand");
              setReg16("CX", (getReg16("CX") - 1) & 0xFFFF);
              const target = evalOperand(a0);
              cpu.regs.IP = (getReg16("CX") !== 0) ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            default:
              throw new Error(`Unknown instruction "${op}"`);
          }
        }catch(err){
          setStatus("Runtime error","err");
          logLine(`Runtime error at line ${inst.line}: ${err.message}`, "err");
          return false;
        }

        return true;
      }

      function autoSyncMemoryView() {
          if (lastModifiedAddrs.size === 0) return;

          let currentStart = parseAddrInput(memStartEl.value);
          if (currentStart === null) currentStart = 0x0100;
          let currentEnd = currentStart + 255;

          const addrs = Array.from(lastModifiedAddrs);
          const minAddr = Math.min(...addrs);
          const maxAddr = Math.max(...addrs);

          if (minAddr < currentStart || maxAddr > currentEnd) {
              let targetStart = (minAddr & 0xFFFFF0) - 0x40; 
              if (targetStart < 0) targetStart = 0;
              if (targetStart > (0xFFFFF - 255)) targetStart = 0xFFFFF - 255;
              memStartEl.value = "0x" + targetStart.toString(16).toUpperCase().padStart(4, "0");
          }
      }

      function runProgram(){
        clearOutput();
        if(!assemble()){
          return;
        }
        resetCPU(true);
        setStatus("Running…","run");

        const maxSteps = 200000;
        let steps = 0;
        
        lastModifiedAddrs.clear(); 

        while(steps < maxSteps){
          const curLine = ipToLine.get(cpu.regs.IP);
          if(curLine && breakpoints.has(curLine) && steps > 0){
            setStatus(`Paused at breakpoint (line ${curLine})`,"run");
            logLine(`Paused at breakpoint on line ${curLine}.`, "warn");
            autoSyncMemoryView();
            updateUI(); refreshMemory(); refreshGutter();
            return;
          }

          const ok = stepOnce();
          steps++;
          if(!ok) {
              autoSyncMemoryView();
              updateUI(); refreshMemory(); refreshGutter();
              return;
          }

          if(cpu.flags.TF) {
            setStatus("Paused (Trap Flag)", "run");
            logLine(`Trap Flag active: Paused after instruction at line ${curLine}.`, "warn");
            autoSyncMemoryView();
            updateUI(); refreshMemory(); refreshGutter();
            return;
          }
        }

        setStatus("Stopped (max steps)","err");
        logLine("Stopped: exceeded max steps (possible infinite loop).", "err");
        autoSyncMemoryView();
        updateUI(); refreshMemory(); refreshGutter();
      }

      // ---- UI ----
      function updateUI(){
        regsGrid.innerHTML = "";

        const pairs = [
          ["AX", getReg16("AX"), 4], ["BX", getReg16("BX"), 4],
          ["CX", getReg16("CX"), 4], ["DX", getReg16("DX"), 4],
          ["AL", getReg8("AL"), 2], ["AH", getReg8("AH"), 2],
          ["BL", getReg8("BL"), 2], ["BH", getReg8("BH"), 2],
          ["CL", getReg8("CL"), 2], ["CH", getReg8("CH"), 2],
          ["DL", getReg8("DL"), 2], ["DH", getReg8("DH"), 2],
          ["SI", getReg16("SI"), 4], ["DI", getReg16("DI"), 4],
          ["BP", getReg16("BP"), 4], ["SP", getReg16("SP"), 4],
          ["IP", getReg16("IP"), 4], ["DS", getReg16("DS"), 4],
          ["CS", getReg16("CS"), 4], ["ES", getReg16("ES"), 4],
          ["SS", getReg16("SS"), 4]
        ];

        for(const [k,v,w] of pairs){
          const div = document.createElement("div");
          div.className = "kv";
          div.innerHTML = `<span class="k">${k}</span><span class="v">${baseSel.value==="hex" ? fmt(v,w) : String(v)}</span>`;
          regsGrid.appendChild(div);
        }

        flagsRow.innerHTML = "";
        for(const f of FLAGS){
          const div = document.createElement("div");
          div.className = "flag" + (cpu.flags[f] ? " on" : "");
          div.textContent = `${f}=${cpu.flags[f] ? 1 : 0}`;
          flagsRow.appendChild(div);
        }

        cyclesEl.textContent = String(cpu.cycles);
      }

      function parseAddrInput(s){
        const n = parseNumber(s.trim());
        return (n === null) ? null : clamp20(n);
      }

      function refreshMemory(){
        let start = parseAddrInput(memStartEl.value);
        if(start === null) start = 0x0100;

        const rows = 16, cols = 16;
        let out = "";
        for(let r=0;r<rows;r++){
          const addr = clamp20(start + r*cols);
          out += fmt(addr, 5) + "  "; 
          let ascii = "";
          for(let c=0;c<cols;c++){
            const a = clamp20(addr+c);
            const b = mem[a];
            const hexStr = b.toString(16).toUpperCase().padStart(2,"0");
            
            if (lastModifiedAddrs.has(a)) {
                out += `<span style="background: rgba(63,111,255,0.25); color: #0f172a; font-weight: 900; border-radius: 3px;">${hexStr}</span> `;
            } else {
                out += hexStr + " ";
            }
            
            ascii += (b>=32 && b<=126) ? String.fromCharCode(b) : ".";
          }
          ascii = ascii.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          out += " |" + ascii + "|\n";
        }
        memDumpEl.innerHTML = out; 
      }

      function activateTab(name){
        document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
        document.querySelectorAll(".tabContent").forEach(c => c.classList.toggle("active", c.id === "tab-" + name));
      }
      document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));

      // Buttons
      el("assembleBtn").addEventListener("click", () => {
        if(assemble()){
          resetCPU(true);
        }
      });

      el("runBtn").addEventListener("click", runProgram);

      el("stepBtn").addEventListener("click", () => {
        if(program.length === 0){
          clearOutput();
          if(!assemble()){ return; }
          resetCPU(true);
          setStatus("Ready to step","run");
          logLine("Step mode ready. Press Step again.", "ok");
          return;
        }
        setStatus("Stepping…","run");

        executionHistory.push({
          regs: { ...cpu.regs },
          flags: { ...cpu.flags },
          cycles: cpu.cycles,
          memChanges: []
        });
        memChangesThisStep = [];
        isExecutingStep = true;
        lastModifiedAddrs.clear(); 

        const ok = stepOnce();

        isExecutingStep = false;
        if (executionHistory.length > 0) {
          executionHistory[executionHistory.length - 1].memChanges = memChangesThisStep;
        }

        autoSyncMemoryView();
        updateUI(); 
        refreshMemory(); 
        refreshGutter();

        if(!ok) setStatus("Stopped","ok");
      });

      const stepBackBtn = el("stepBackBtn");
      if (stepBackBtn) {
        stepBackBtn.addEventListener("click", () => {
          if (executionHistory.length === 0) {
            logLine("Already at the start of execution. Cannot step back.", "warn");
            return;
          }
          setStatus("Stepping back…", "run");

          const prevState = executionHistory.pop();

          cpu.regs = { ...prevState.regs };
          cpu.flags = { ...prevState.flags };
          cpu.cycles = prevState.cycles;

          lastModifiedAddrs.clear(); 
          for (let i = prevState.memChanges.length - 1; i >= 0; i--) {
            const change = prevState.memChanges[i];
            mem[change.addr] = change.oldVal;
            lastModifiedAddrs.add(change.addr); 
          }

          autoSyncMemoryView();
          updateUI();
          refreshMemory();
          refreshGutter();
          const currentLine = ipToLine.get(cpu.regs.IP);
          logLine(`Stepped back to line ${currentLine !== undefined ? currentLine : '?'}.`, "ok");
        });
      }

      el("resetBtn").addEventListener("click", () => {
        resetCPU(true);
        setStatus("Reset","ok");
        logLine("Reset OK.", "ok");
      });

      baseSel.addEventListener("change", () => { updateUI(); refreshMemory(); });
      el("memRefresh").addEventListener("click", refreshMemory);
      memStartEl.addEventListener("change", refreshMemory); 

      el("exampleSel").addEventListener("change", (e) => {
        const v = e.target.value;
        if(!v) return;

        const EX = {
          ex1: `; --- Ex 1: Basic Math & Flags ---
ORG 100h
MOV AX, 00FFh
ADD AX, 1       ; Should set AF (Half Carry)
SUB AX, 100h    ; Should set ZF (Zero)
MOV BX, 5
MUL BX          ; AX = 0
HLT`,

          ex2: `; --- Ex 2: Shifts & Rotates ---
ORG 100h
MOV AL, 0F0h    ; 1111 0000
SHR AL, 1       ; 0111 1000 (CF=0)
SHL AL, 2       ; 1110 0000 (CF=0)
ROL AL, 3       ; 0000 0111 (CF=1)
SAR AL, 1       ; 0000 0011 
HLT`,

          ex3: `; --- Ex 3: String Operations (MOVSB) ---
ORG 100h
MOV CX, 5
MOV SI, OFFSET STR1
MOV DI, OFFSET STR2
CLD             ; Direction = Forward
REP MOVSB       ; Copies "HELLO" to STR2

HLT
STR1 DB "HELLO"
STR2 DB 5 DUP(0)`,

          ex4: `; --- Ex 4: String Compare (CMPSB) ---
ORG 100h
MOV CX, 4
MOV SI, OFFSET S1
MOV DI, OFFSET S2
CLD
REPE CMPSB      ; Stops when it hits 'X' vs 'Y'
HLT

S1 DB "ABXC"
S2 DB "ABYC"`,

          ex5: `; --- Ex 5: String Scan (SCASB) ---
ORG 100h
MOV AL, 'X'     ; We are looking for 'X'
MOV CX, 5
MOV DI, OFFSET S1
CLD
REPNE SCASB     ; Scans until it finds 'X'
HLT

S1 DB "HELLOX"`,

          ex6: `; --- Ex 6: Loop & Logic ---
ORG 100h
MOV CX, 3
MOV AX, 0

L1: ADD AX, CX
    XOR BX, BX  ; Clear BX
    NOT BX      ; BX = FFFF
    LOOP L1
HLT`,

          ex7: `; --- Ex 7: Stack Operations ---
ORG 100h
MOV AX, 1234h
MOV BX, 5678h
PUSH AX
PUSH BX
POP CX          ; CX = 5678h
POP DX          ; DX = 1234h
HLT`,

          ex8: `; --- Ex 8: Subroutines (CALL/RET) ---
ORG 100h
MOV AX, 10
CALL MYFUNC
ADD AX, 5       ; AX becomes 35
HLT

MYFUNC:
    ADD AX, 20
    RET`,

          ex9: `; --- Ex 9: Multi-Byte Addition (ADC) ---
ORG 100h
; Add 01FFh + 0002h manually
MOV AL, 0FFh
MOV BL, 02h
ADD AL, BL      ; AL = 01, CF = 1

MOV AH, 01h
MOV BH, 00h
ADC AH, BH      ; AH = 01 + 00 + 1 (CF) = 02
; Result in AX is 0201h
HLT`,

          ex10: `; --- Ex 10: LEA & Memory Navigation ---
ORG 100h
MOV BX, 5
LEA SI, DATA[BX] ; SI gets OFFSET DATA + 5
MOV AL, [SI]     ; AL = 'F'
HLT

DATA DB "ABCDEF" `,

          ex11: `; --- Ex 11: Negative Hex & XCHG ---
ORG 100h
MOV AX, -0x1A   ; Loads negative hex (-26 dec = FFE6 hex)
MOV BX, -10h    ; Alternative hex syntax (-16 dec = FFF0 hex)
MOV CX, -0b101  ; Binary negative (-5 dec = FFFB hex)

XCHG AX, BX     ; Swaps AX and BX
XCHG BX, CX     ; Swaps BX and CX

MOV [0x200], AX
XCHG CX, [0x200] ; Memory exchange!
HLT`,

          ex12: `; --- Ex 12: CMP & Conditional Jumps ---
ORG 100h
MOV AX, 15
CMP AX, 20
JL IS_LESS      ; Jump if Less (Signed: 15 < 20)

HLT

IS_LESS:
MOV BX, 99
CMP BX, 99
JE IS_EQUAL     ; Jump if Equal (99 == 99)

HLT

IS_EQUAL:
MOV CX, 50
CMP CX, 20
JA IS_ABOVE     ; Jump if Above (Unsigned: 50 > 20)

HLT

IS_ABOVE:
MOV DX, 777     ; Success! All jumps executed.
HLT`
        };

        codeEl.value = EX[v];
        localStorage.setItem(LS_CODE, codeEl.value);
        program = [];
        refreshGutter();
        clearOutput();
        setStatus("Loaded example","ok");
        e.target.value = "";
      });

      window.addEventListener("keydown", (e) => {
        if(e.ctrlKey && e.key === "Enter"){ e.preventDefault(); runProgram(); }
        if(e.key === "F10"){ e.preventDefault(); el("stepBtn").click(); }
        if(e.key === "F9"){ e.preventDefault(); el("stepBackBtn")?.click(); }
        if(e.ctrlKey && (e.key === "r" || e.key === "R")){ e.preventDefault(); el("resetBtn").click(); }
      });

      function boot(){
        const saved = localStorage.getItem(LS_CODE);
        codeEl.value = saved ?? `ORG 100H
X1 DB ?
X2 DB 'ABC'
X3 DB 32
X4 DB 20H
X5 DB 01011001B
X6 DB 01, 'JAN'
X7 DB '32654'
X8 DB 3 DUP(0)
Y1 DW 0FFF0H
Y2 DW 01011001B
Y3 DW X7
Y4 DW 3, 4, 17
Y5 DW 2 DUP(0)
Y6 DW X8-X7
HLT
`;
        saveHistoryState(); 

        loadBreakpoints();
        refreshGutter();
        updateUI();
        refreshMemory();
        setStatus("Idle","idle");
        clearOutput();
        logLine("Tip: Assemble first to validate OFFSET/DB/DW/DD and labels.", "ok");
        
        const sel = el("exampleSel");
        if (sel && sel.options.length < 5) {
          sel.innerHTML = `<option value="">Load example…</option>
            <option value="ex1">1. Basic Math & Flags</option>
            <option value="ex2">2. Shifts & Rotates</option>
            <option value="ex3">3. String Copy (REP MOVSB)</option>
            <option value="ex4">4. String Compare (REPE CMPSB)</option>
            <option value="ex5">5. String Scan (REPNE SCASB)</option>
            <option value="ex6">6. Loop & Logic (XOR/NOT)</option>
            <option value="ex7">7. Stack (PUSH/POP)</option>
            <option value="ex8">8. Subroutines (CALL/RET)</option>
            <option value="ex9">9. Multi-Byte Add (ADC)</option>
            <option value="ex10">10. LEA & Memory</option>
            <option value="ex11">11. Negative Hex & XCHG</option>
            <option value="ex12">12. CMP & Conditional Jumps</option>`;
        }
      }

      boot();
    })();
});
