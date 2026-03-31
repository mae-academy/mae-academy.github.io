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
        // Ignore single quotes here, as they are handled in parseDataItems for multi-char
        if(/^'.{1}'$/.test(t) && t.length === 3) return t.charCodeAt(1); 
        
        if(/^0x[0-9a-f]+$/i.test(t)) return parseInt(t,16);
        if(/^[0-9a-f]+h$/i.test(t)) return parseInt(t.slice(0,-1),16);
        
        if(/^0b[01]+$/i.test(t)) return parseInt(t.slice(2), 2);
        if(/^[01]+b$/i.test(t)) return parseInt(t.slice(0,-1), 2);
        
        if(/^[+-]?\d+$/.test(t)) return parseInt(t,10);
        return null;
      }

      function fmt(n, width=4){
        const base = baseSel.value;
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

      const mem = new Uint8Array(0x10000);

      let program = [];
      let ipToLine = new Map();
      let lineToIp = new Map();
      let labels = new Map();

      const dataPtrDefault = 0x0100;
      let breakpoints = new Set();

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

      codeEl.addEventListener("input", () => {
        localStorage.setItem(LS_CODE, codeEl.value);
        program = [];
        refreshGutter();
      });
      codeEl.addEventListener("scroll", () => { gutterEl.scrollTop = codeEl.scrollTop; });

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

      // ---- Register access (16/8) ----
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
        const diff = (a >>> 0) - (b >>> 0);
        const res = diff >>> 0;
        cpu.flags.CF = ((a >>> 0) < (b >>> 0)) ? 1 : 0;
        const sa = (a & 0x80000000) !== 0, sb = (b & 0x80000000) !== 0, sr = (res & 0x80000000) !== 0;
        cpu.flags.OF = (sa !== sb && sa !== sr) ? 1 : 0;
        setZS(32,res);
        return res;
      }

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

      function parseMemInside(inside){
        let expr = inside.replace(/\s+/g,"");
        expr = expr.replace(/-/g,"+-");

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
          return { ok:true, baseReg, offset: clamp16(offset), label: label.toUpperCase() };
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
        return { ok:true, baseReg, offset: clamp16(offset) };
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
          return { type:"mem", baseReg: parsed.baseReg, offset: parsed.offset, label: parsed.label, size: size || null };
        }

        if(up.startsWith("[") && up.endsWith("]")){
          const parsed = parseMemInside(up.slice(1,-1));
          if(!parsed.ok) return { type:"bad", error: parsed.error };
          return { type:"mem", baseReg: parsed.baseReg, offset: parsed.offset, size: size || null };
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
        return clamp16(labelBase + regBase + off);
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

      // NEW LOGIC: Evaluator for math operations like X8-X7
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
                 val = 0; // Allocate forward space in Pass 1
              } else {
                 return null; // Error in Pass 2
              }
            } else {
              val = parsed;
            }
          }

          if(currentOp === '+') result += val;
          else if(currentOp === '-') result -= val;
        }
        return clamp16(result);
      }

      function parseDataItems(argStr, directive, pass, labelsMap){
        const items = tokenizeCommaAware(argStr);
        if(items.length === 0) return { ok:false, error:`${directive} needs values` };

        const bytes = [];
        const pushWord = (w) => { bytes.push(w & 0xFF, (w >> 8) & 0xFF); };
        const pushDword = (d) => {
          const v = d >>> 0;
          bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
        };

        const processSingleValue = (valStr) => {
          const it = valStr.trim();
          if(!it) return true; 

          // UPDATED: Now handles both 'ABC' and "ABC" strings safely
          const strMatch = it.match(/^["'](.*)["']$/);
          if(strMatch){
            const s = strMatch[1];
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
          
          // UPDATED: Uses evalDataExpr so label math and pointers work!
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
            
            // Uses eval for the count as well
            const count = evalDataExpr(countStr, pass, labelsMap);
            
            if(count === null || count < 0){
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

        // PASS 1
        let ip = 0;
        let dataPtr = dataPtrDefault;

        for(let i=0;i<lines.length;i++){
          const ln = i+1;
          let raw = stripComment(lines[i]);
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

        // PASS 2
        ip = 0;
        dataPtr = dataPtrDefault;
        const controlFlowOps = ["JMP", "JZ", "JE", "JNZ", "JNE", "LOOP", "CALL"];

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

          let rest = raw;

          const colonLabelMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*):/i);
          if(colonLabelMatch){
            rest = rest.slice(colonLabelMatch[0].length).trim();
            if(!rest) continue;
          } else {
            const noColonMatch = rest.match(/^([A-Z_.$][A-Z0-9_.$]*)\s+(DB|DW|DD)\b/i);
            if(noColonMatch){
              rest = rest.slice(noColonMatch[1].length).trim();
            }
          }

          const upRest = rest.toUpperCase();
          if(upRest.startsWith("DB ") || upRest.startsWith("DW ") || upRest.startsWith("DD ")){
            const dir = upRest.slice(0,2);
            const parsed = parseDataItems(rest.slice(2).trim(), dir, 2, labels);
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

          for(let k=0;k<args.length;k++){
            const a = args[k];
            if(a.type === "label"){
              const val = labels.get(a.name);
              if(val === undefined){
                logLine(`Line ${ln}: Unknown label "${a.name}"`, "err");
                setStatus("Assemble error","err");
                return false;
              }
              if(controlFlowOps.includes(op)) {
                args[k] = { type:"imm", value: val >>> 0, size: a.size || 16 };
              } else {
                args[k] = { type:"mem", baseReg: null, offset: val, label: null, size: a.size || null };
              }
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
        updateUI();
        refreshGutter();
        refreshMemory();
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
              updateUI(); refreshMemory(); refreshGutter();
              return false;

            case "MOV":{
              if(inst.args.length !== 2) throw new Error("MOV needs 2 operands");
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

            case "ADD":
            case "SUB":
            case "CMP":
            case "AND":
            case "OR":
            case "XOR":
            case "TEST": {
              if(inst.args.length !== 2) throw new Error(op + " needs 2 operands");
              const w = getEffectiveWidth(a0, a1);
              const left = evalOperand(a0, w);
              const right = evalOperand(a1, w);
              let res;

              if(op === "ADD") res = addN(left, right, w);
              else if(op === "SUB" || op === "CMP") res = subN(left, right, w);
              else if(op === "AND") {
                res = (left & right) >>> 0;
                cpu.flags.CF=0; cpu.flags.OF=0; setZS(w, res);
              } else if(op === "OR") {
                res = (left | right) >>> 0;
                cpu.flags.CF=0; cpu.flags.OF=0; setZS(w, res);
              } else if(op === "XOR") {
                res = (left ^ right) >>> 0;
                cpu.flags.CF=0; cpu.flags.OF=0; setZS(w, res);
              } else if(op === "TEST") {
                res = (left & right) >>> 0;
                cpu.flags.CF=0; cpu.flags.OF=0; setZS(w, res);
              }

              if(op !== "CMP" && op !== "TEST") {
                writeOperand(a0, res, w);
              }
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }
            
            case "NOT": {
              if(inst.args.length !== 1) throw new Error("NOT needs 1 operand");
              const w = getEffectiveWidth(a0, null);
              const v = evalOperand(a0, w);
              let res = (~v) >>> 0;
              if (w === 8) res &= 0xFF;
              if (w === 16) res &= 0xFFFF;
              writeOperand(a0, res, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "INC":
            case "DEC": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const w = getEffectiveWidth(a0, null);
              const v = evalOperand(a0, w);
              const oldCF = cpu.flags.CF;
              const res = op === "INC" ? addN(v, 1, w) : subN(v, 1, w);
              cpu.flags.CF = oldCF;
              writeOperand(a0, res, w);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "PUSH": {
              if(inst.args.length !== 1) throw new Error("PUSH needs 1 operand");
              const v = evalOperand(a0, 16) & 0xFFFF;
              cpu.regs.SP = (cpu.regs.SP - 2) & 0xFFFF;
              write16(cpu.regs.SP, v);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "POP": {
              if(inst.args.length !== 1) throw new Error("POP needs 1 operand");
              const v = read16(cpu.regs.SP);
              cpu.regs.SP = (cpu.regs.SP + 2) & 0xFFFF;
              writeOperand(a0, v, 16);
              cpu.regs.IP = nextIP; cpu.cycles++;
              break;
            }

            case "CALL": {
              if(inst.args.length !== 1) throw new Error("CALL needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.SP = (cpu.regs.SP - 2) & 0xFFFF;
              write16(cpu.regs.SP, nextIP);
              cpu.regs.IP = clamp16(target);
              cpu.cycles++;
              break;
            }

            case "RET": {
              const retIP = read16(cpu.regs.SP);
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

            case "JZ":
            case "JE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = cpu.flags.ZF ? clamp16(target) : nextIP;
              cpu.cycles++;
              break;
            }

            case "JNZ":
            case "JNE": {
              if(inst.args.length !== 1) throw new Error(op + " needs 1 operand");
              const target = evalOperand(a0);
              cpu.regs.IP = !cpu.flags.ZF ? clamp16(target) : nextIP;
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
          updateUI(); refreshMemory(); refreshGutter();
          return false;
        }

        updateUI();
        refreshMemory();
        refreshGutter();
        return true;
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

        while(steps < maxSteps){
          const curLine = ipToLine.get(cpu.regs.IP);
          if(curLine && breakpoints.has(curLine) && steps > 0){
            setStatus(`Paused at breakpoint (line ${curLine})`,"run");
            logLine(`Paused at breakpoint on line ${curLine}.`, "warn");
            return;
          }
          const ok = stepOnce();
          steps++;
          if(!ok) return;
        }

        setStatus("Stopped (max steps)","err");
        logLine("Stopped: exceeded max steps (possible infinite loop).", "err");
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
          ["IP", getReg16("IP"), 4],
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
        return (n === null) ? null : clamp16(n);
      }

      function refreshMemory(){
        let start = parseAddrInput(memStartEl.value);
        if(start === null) start = 0x0100;

        const rows = 16, cols = 16;
        let out = "";
        for(let r=0;r<rows;r++){
          const addr = (start + r*cols) & 0xFFFF;
          out += fmt(addr,4) + "  ";
          let ascii = "";
          for(let c=0;c<cols;c++){
            const b = mem[(addr+c) & 0xFFFF];
            out += b.toString(16).toUpperCase().padStart(2,"0") + " ";
            ascii += (b>=32 && b<=126) ? String.fromCharCode(b) : ".";
          }
          out += " |" + ascii + "|\n";
        }
        memDumpEl.textContent = out;
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
        const ok = stepOnce();
        if(!ok) setStatus("Stopped","ok");
      });

      el("resetBtn").addEventListener("click", () => {
        resetCPU(true);
        setStatus("Reset","ok");
        logLine("Reset OK.", "ok");
      });

      baseSel.addEventListener("change", () => { updateUI(); refreshMemory(); });
      el("memRefresh").addEventListener("click", refreshMemory);

      el("exampleSel").addEventListener("change", (e) => {
        const v = e.target.value;
        if(!v) return;

        const EX = {
          case: `ORG 100h
MOV SI, OFFSET STR
MOV CX, 2

L:  MOV AL, [SI]
    XOR AL, 20h
    MOV [SI], AL
    INC SI
    LOOP L
HLT

STR DB "ab"
`,
          data: `ORG 200h
W1 DW 1234h
D1 DD 11223344h
S1 DB "Hi", 0
BIN DB 0b1010
ARR DB 3 DUP (0xFF)

MOV SI, OFFSET W1
MOV AX, [SI]
ADD AX, 1
MOV [SI], AX

MOV BX, W1
CMP BX, 1235h
JE DONE

DONE:
HLT
`
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
        loadBreakpoints();
        refreshGutter();
        updateUI();
        refreshMemory();
        setStatus("Idle","idle");
        clearOutput();
        logLine("Tip: Assemble first to validate OFFSET/DB/DW/DD and labels.", "ok");
      }

      boot();
    })();
});
