document.addEventListener("DOMContentLoaded", () => {
/* ===========================
   Utilities
=========================== */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const varsAll = ["A","B","C","D"];

function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function bitsToIndex(bits){ // bits array [A,B,C,D] with A MSB
  let idx = 0;
  for(let i=0;i<bits.length;i++) idx = (idx<<1) | (bits[i]?1:0);
  return idx;
}
function indexToBits(idx, n){
  const bits = new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){
    bits[i] = idx & 1;
    idx >>= 1;
  }
  return bits;
}
function fmtBits(bits, labels){
  return labels.map((v,i)=>`${v}=${bits[i]}`).join("  ");
}
function joinCsv(arr){ return arr.length ? arr.join(",") : "—"; }

/* ===========================
   Expression Parser
   Supports: ! ~ NOT; AND: &,*, adjacency not supported
             OR: |,+
             XOR: ^
             parentheses
   Returns AST, then can evaluate.
=========================== */
function tokenizeExpr(s){
  const src = (s||"").trim();
  const tokens = [];
  let i=0;

  const isSpace = c => /\s/.test(c);
  const isVar = c => /[A-Da-d]/.test(c);

  while(i < src.length){
    const c = src[i];
    if(isSpace(c)){ i++; continue; }
    if(c==="(" || c===")" || c==="!" || c==="~" || c==="&" || c==="*" || c==="|" || c==="+" || c==="^"){
      tokens.push({t:c}); i++; continue;
    }
    if(isVar(c)){
      tokens.push({t:"VAR", v:c.toUpperCase()}); i++; continue;
    }
    if(c==="0" || c==="1"){
      tokens.push({t:"CONST", v: Number(c)}); i++; continue;
    }
    // allow words AND OR NOT XOR
    if(/[A-Za-z]/.test(c)){
      let j=i;
      while(j<src.length && /[A-Za-z]/.test(src[j])) j++;
      const w = src.slice(i,j).toUpperCase();
      if(w==="AND") tokens.push({t:"&"});
      else if(w==="OR") tokens.push({t:"|"});
      else if(w==="NOT") tokens.push({t:"!"});
      else if(w==="XOR") tokens.push({t:"^"});
      else throw new Error("Unknown word: " + w);
      i=j; continue;
    }
    throw new Error("Invalid character: " + c);
  }
  return tokens;
}

function parseExpr(tokens){
  let pos = 0;
  const peek = () => tokens[pos] || null;
  const eat = (tt) => {
    const p = peek();
    if(!p || p.t !== tt) throw new Error("Expected '" + tt + "'");
    pos++;
    return p;
  };

  // grammar:
  // expr   := xor ( (| or +) xor )*
  // xor    := and ( ^ and )*
  // and    := unary ( (& or *) unary )*
  // unary  := (! or ~) unary | primary
  // primary:= VAR | CONST | ( expr )

  function parsePrimary(){
    const p = peek();
    if(!p) throw new Error("Unexpected end");
    if(p.t==="VAR"){ pos++; return {k:"var", v:p.v}; }
    if(p.t==="CONST"){ pos++; return {k:"const", v:p.v}; }
    if(p.t==="("){ eat("("); const e = parseOr(); eat(")"); return e; }
    throw new Error("Unexpected token: " + p.t);
  }
  function parseUnary(){
    const p = peek();
    if(p && (p.t==="!" || p.t==="~")){
      pos++;
      return {k:"not", a: parseUnary()};
    }
    return parsePrimary();
  }
  function parseAnd(){
    let node = parseUnary();
    while(true){
      const p = peek();
      if(p && (p.t==="&" || p.t==="*")){
        pos++;
        node = {k:"and", a:node, b:parseUnary()};
      } else break;
    }
    return node;
  }
  function parseXor(){
    let node = parseAnd();
    while(true){
      const p = peek();
      if(p && p.t==="^"){
        pos++;
        node = {k:"xor", a:node, b:parseAnd()};
      } else break;
    }
    return node;
  }
  function parseOr(){
    let node = parseXor();
    while(true){
      const p = peek();
      if(p && (p.t==="|" || p.t==="+")){
        pos++;
        node = {k:"or", a:node, b:parseXor()};
      } else break;
    }
    return node;
  }

  const ast = parseOr();
  if(pos !== tokens.length) throw new Error("Unexpected token near: " + tokens[pos].t);
  return ast;
}

function evalAst(ast, env){
  switch(ast.k){
    case "var": return env[ast.v] ? 1 : 0;
    case "const": return ast.v ? 1 : 0;
    case "not": return evalAst(ast.a, env) ? 0 : 1;
    case "and": return (evalAst(ast.a, env) & evalAst(ast.b, env));
    case "or":  return (evalAst(ast.a, env) | evalAst(ast.b, env));
    case "xor": return (evalAst(ast.a, env) ^ evalAst(ast.b, env));
    default: throw new Error("Bad AST node");
  }
}

function parseAndEval(expr, env){
  const toks = tokenizeExpr(expr);
  const ast = parseExpr(toks);
  return {ast, val: evalAst(ast, env)};
}

function astToInfix(ast){
  // normalized infix (for display)
  switch(ast.k){
    case "var": return ast.v;
    case "const": return String(ast.v);
    case "not": return "!" + wrapIfNeeded(ast.a, "not");
    case "and": return wrapIfNeeded(ast.a,"and")+" & "+wrapIfNeeded(ast.b,"and");
    case "or":  return wrapIfNeeded(ast.a,"or")+" | "+wrapIfNeeded(ast.b,"or");
    case "xor": return wrapIfNeeded(ast.a,"xor")+" ^ "+wrapIfNeeded(ast.b,"xor");
  }
  function prec(k){
    if(k==="or") return 1;
    if(k==="xor") return 2;
    if(k==="and") return 3;
    if(k==="not") return 4;
    return 5;
  }
  function wrapIfNeeded(node, parentK){
    if(!node) return "";
    const need = prec(node.k) < prec(parentK);
    const s = astToInfix(node);
    return need ? "(" + s + ")" : s;
  }
}

function envFromBits(bits, n){
  const env = {};
  for(let i=0;i<n;i++) env[varsAll[i]] = !!bits[i];
  return env;
}

function buildTruthTableFromExpr(expr, n){
  const rows = [];
  for(let i=0;i<(1<<n);i++){
    const bits = indexToBits(i,n);
    const env = envFromBits(bits,n);
    let y = 0, err=null;
    try{
      y = parseAndEval(expr, env).val;
    }catch(e){
      err = e.message;
      y = null;
    }
    rows.push({bits, y, err});
  }
  return rows;
}

function mintermsFromRows(rows){
  const mins = [];
  for(let i=0;i<rows.length;i++){
    if(rows[i].y===1) mins.push(i);
  }
  return mins;
}
function maxtermsFromRows(rows){
  const maxs = [];
  for(let i=0;i<rows.length;i++){
    if(rows[i].y===0) maxs.push(i);
  }
  return maxs;
}

function canonicalSOP(minterms, n){
  if(minterms.length===0) return "0";
  if(minterms.length===(1<<n)) return "1";
  const vs = varsAll.slice(0,n);
  const terms = minterms.map(m=>{
    const b = indexToBits(m,n);
    const lits = b.map((bit,i)=> bit? vs[i] : "!" + vs[i]);
    return "(" + lits.join(" & ") + ")";
  });
  return terms.join(" | ");
}
function canonicalPOS(maxterms, n){
  if(maxterms.length===0) return "1";
  if(maxterms.length===(1<<n)) return "0";
  const vs = varsAll.slice(0,n);
  const terms = maxterms.map(M=>{
    const b = indexToBits(M,n);
    const lits = b.map((bit,i)=> bit? "!" + vs[i] : vs[i]); // maxterm: if bit=1 => var complemented
    return "(" + lits.join(" | ") + ")";
  });
  return terms.join(" & ");
}

/* ===========================
   Gate functions
=========================== */
function gateEval(type, bits){
  const n = bits.length;
  const A = bits[0]||0;
  const vals = bits.map(b=>b?1:0);

  const andAll = () => vals.reduce((a,b)=>a&b,1);
  const orAll  = () => vals.reduce((a,b)=>a|b,0);
  const xorAll = () => vals.reduce((a,b)=>a^b,0);

  switch(type){
    case "AND": return andAll();
    case "OR":  return orAll();
    case "XOR": return xorAll();
    case "XNOR": return xorAll()?0:1;
    case "NAND": return andAll()?0:1;
    case "NOR": return orAll()?0:1;
    case "NOT": return A?0:1; // only uses A
    default: return 0;
  }
}
function gateExpr(type, n){
  const vs = varsAll.slice(0,n);
  if(type==="NOT") return "!" + vs[0];
  const op = (type==="AND"||type==="NAND") ? " & "
           : (type==="OR"||type==="NOR") ? " | "
           : (type==="XOR"||type==="XNOR") ? " ^ "
           : " & ";
  let core = vs.join(op);
  if(type==="NAND"||type==="NOR"||type==="XNOR") core = "!("+core+")";
  return core;
}

/* ===========================
   UI Helpers
=========================== */
function mkChips(container, labels, stateArr, onToggle){
  container.innerHTML = "";
  labels.forEach((lab, i)=>{
    const b = document.createElement("button");
    b.className = "chip " + (stateArr[i] ? "on":"");
    b.type = "button";
    b.textContent = `${lab}: ${stateArr[i]?1:0}`;
    b.addEventListener("click", ()=>{
      stateArr[i] = stateArr[i]?0:1;
      onToggle?.(i, stateArr[i]);
      // refresh text
      b.classList.toggle("on", !!stateArr[i]);
      b.textContent = `${lab}: ${stateArr[i]?1:0}`;
    });
    container.appendChild(b);
  });
}

function mkSingleChip(container, label, stateObj, key, onToggle){
  container.innerHTML = "";
  const b = document.createElement("button");
  b.className = "chip " + (stateObj[key] ? "on":"");
  b.type = "button";
  b.textContent = `${label}: ${stateObj[key]?1:0}`;
  b.addEventListener("click", ()=>{
    stateObj[key] = stateObj[key]?0:1;
    onToggle?.(stateObj[key]);
    b.classList.toggle("on", !!stateObj[key]);
    b.textContent = `${label}: ${stateObj[key]?1:0}`;
  });
  container.appendChild(b);
}

function renderTable(el, headers, rows){
  const thead = `<thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>`;
  const tbody = `<tbody>${
    rows.map(r=>`<tr>${r.map(c=>`<td class="${c.mono?'tdmono':''}">${c.v}</td>`).join("")}</tr>`).join("")
  }</tbody>`;
  el.innerHTML = thead + tbody;
}

/* ===========================
   App State (export/import)
=========================== */
const APP = {
  gates:{ n:2, type:"AND", inputs:[0,0,0,0] },
  tt:{ n:3, method:"expr", expr:"(A & !B) | C", terms:"1,3,5,7" },
  be:{ n:4, expr:"(A & !B) | (C ^ D)", inputs:[0,0,0,0] },
  kmap:{ n:4, mode:"cycle01x", cells:[] }, // cells values: 0,1,"X"
  mux:{ type:4, en:1, data:[], sel:[] },
  dmx:{ type:4, en:1, din:1, sel:[] },
  dec:{ type:3, en:1, in:[] },
  enc:{ type:8, in:[] },
  seq:{ type:"jk_ff", inputs:{S:0,R:0,J:0,K:0,D:0,T:0,CLK:0}, Q:0 },
  conv:{ base:"dec", value:"45", bits:8 },
  impl:{ n:4, expr:"(A & B) | (!C)", inputs:[0,0,0,0] }
};

/* ===========================
   Tabs
=========================== */
const nav = document.getElementById("nav");
nav.addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-tab]");
  if(!btn) return;
  [...nav.querySelectorAll("button")].forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  const id = btn.dataset.tab;
  document.querySelectorAll("main .panel").forEach(p=>{
    p.style.display = (p.id===id) ? "" : "none";
  });
});

/* ===========================
   Gates Module
=========================== */
const gateN = document.getElementById("gateN");
const gateType = document.getElementById("gateType");
const gateInputs = document.getElementById("gateInputs");
const gateOut = document.getElementById("gateOut");
const gateBin = document.getElementById("gateBin");
const gateTT = document.getElementById("gateTT");

function updateGates(){
  const n = Number(gateN.value);
  APP.gates.n = n;
  APP.gates.type = gateType.value;

  // chips for A..D (but only first n)
  const labs = varsAll.slice(0,n);
  mkChips(gateInputs, labs, APP.gates.inputs, ()=>{
    updateGates();
  });

  const bits = APP.gates.inputs.slice(0,n).map(x=>x?1:0);
  const y = gateEval(APP.gates.type, bits);
  gateOut.textContent = `Gate: ${APP.gates.type}\nInputs: ${fmtBits(bits, labs)}\nOutput Y = ${y}`;
  gateBin.textContent = labs.map((v,i)=>`${v}${bits[i]}`).join(" ") + `   (index ${bitsToIndex(bits)})`;

  // truth table
  const headers = [...labs, "Y"];
  const rows = [];
  for(let i=0;i<(1<<n);i++){
    const b = indexToBits(i,n);
    const yy = gateEval(APP.gates.type, b);
    rows.push([...b.map(v=>({v:String(v), mono:true})), {v:String(yy), mono:true}]);
  }
  renderTable(gateTT, headers, rows);

  // status dot
  const dot = document.getElementById("gateDot");
  const status = document.getElementById("gateStatus");
  dot.classList.toggle("good", true);
  status.textContent = "OK";
}

gateN.addEventListener("change", updateGates);
gateType.addEventListener("change", updateGates);
document.getElementById("gateReset").addEventListener("click", ()=>{
  APP.gates.inputs = [0,0,0,0];
  updateGates();
});
document.getElementById("gateCopyExpr").addEventListener("click", async ()=>{
  const expr = gateExpr(APP.gates.type, APP.gates.n);
  try{ await navigator.clipboard.writeText(expr); }catch{}
  gateOut.textContent = gateOut.textContent + `\n\nExpr: ${expr}`;
});

/* ===========================
   Truth Table Builder
=========================== */
const ttVars = document.getElementById("ttVars");
const ttMethod = document.getElementById("ttMethod");
const ttExpr = document.getElementById("ttExpr");
const ttTerms = document.getElementById("ttTerms");
const ttExprBox = document.getElementById("ttExprBox");
const ttTermsBox = document.getElementById("ttTermsBox");
const ttTable = document.getElementById("ttTable");
const ttForms = document.getElementById("ttForms");

function updateTTUI(){
  const method = ttMethod.value;
  ttExprBox.style.display = (method==="expr") ? "" : "none";
  ttTermsBox.style.display = (method==="expr") ? "none" : "";
}
ttMethod.addEventListener("change", updateTTUI);

function parseTermList(s){
  const clean = (s||"").trim();
  if(!clean) return [];
  return clean.split(",").map(x=>x.trim()).filter(Boolean).map(x=>{
    if(!/^\d+$/.test(x)) throw new Error("Bad term: "+x);
    return Number(x);
  });
}

function buildTT(){
  const n = Number(ttVars.value);
  APP.tt.n = n;
  APP.tt.method = ttMethod.value;
  APP.tt.expr = ttExpr.value.trim();
  APP.tt.terms = ttTerms.value.trim();

  const labs = varsAll.slice(0,n);
  const headers = [...labs, "Y"];
  let rows = [];
  let mins = [], maxs = [];
  let exprUsed = "";

  try{
    if(APP.tt.method==="expr"){
      exprUsed = APP.tt.expr || "0";
      rows = buildTruthTableFromExpr(exprUsed, n);
      if(rows.some(r=>r.err)) throw new Error(rows.find(r=>r.err).err);
      mins = mintermsFromRows(rows);
      maxs = maxtermsFromRows(rows);
    } else if(APP.tt.method==="minterms"){
      mins = parseTermList(APP.tt.terms);
      const set = new Set(mins);
      rows = [];
      for(let i=0;i<(1<<n);i++){
        const bits = indexToBits(i,n);
        rows.push({bits, y: set.has(i)?1:0});
      }
      maxs = maxtermsFromRows(rows);
      exprUsed = canonicalSOP(mins,n);
    } else {
      maxs = parseTermList(APP.tt.terms);
      const set = new Set(maxs);
      rows = [];
      for(let i=0;i<(1<<n);i++){
        const bits = indexToBits(i,n);
        rows.push({bits, y: set.has(i)?0:1});
      }
      mins = mintermsFromRows(rows);
      exprUsed = canonicalPOS(maxs,n);
    }

    const tableRows = rows.map(r=>[
      ...r.bits.map(v=>({v:String(v), mono:true})),
      {v:String(r.y), mono:true}
    ]);
    renderTable(ttTable, headers, tableRows);

    const sop = canonicalSOP(mins, n);
    const pos = canonicalPOS(maxs, n);
    ttForms.textContent =
`Σm = (${joinCsv(mins)})
ΠM = (${joinCsv(maxs)})

Canonical SOP:
${sop}

Canonical POS:
${pos}

Expression used:
${exprUsed}`;
  }catch(e){
    ttTable.innerHTML = "";
    ttForms.textContent = "Error: " + e.message;
  }
}
document.getElementById("ttBuild").addEventListener("click", buildTT);
document.getElementById("ttReset").addEventListener("click", ()=>{
  ttExpr.value = "";
  ttTerms.value = "";
  ttForms.textContent = "";
  ttTable.innerHTML = "";
});
document.getElementById("ttFillExample").addEventListener("click", ()=>{
  ttVars.value = "3";
  ttMethod.value = "expr";
  updateTTUI();
  ttExpr.value = "(A & !B) | C";
  buildTT();
});

/* ===========================
   Boolean Expressions Module
=========================== */
const beVars = document.getElementById("beVars");
const beExpr = document.getElementById("beExpr");
const beInputs = document.getElementById("beInputs");
const beOut = document.getElementById("beOut");
const beTable = document.getElementById("beTable");
const beTerms = document.getElementById("beTerms");

function updateBE(){
  const n = Number(beVars.value);
  APP.be.n = n;
  APP.be.expr = beExpr.value.trim();
  const labs = varsAll.slice(0,n);

  mkChips(beInputs, labs, APP.be.inputs, ()=>updateBE());

  const env = envFromBits(APP.be.inputs.slice(0,n).map(x=>x?1:0), n);
  try{
    const {ast, val} = parseAndEval(APP.be.expr || "0", env);
    beOut.textContent =
`Inputs: ${fmtBits(labs.map(v=>env[v]?1:0), labs)}
Expr:   ${astToInfix(ast)}
Y = ${val}`;
  }catch(e){
    beOut.textContent = "Error: " + e.message;
  }
}

function genBETable(){
  const n = Number(beVars.value);
  const labs = varsAll.slice(0,n);
  const expr = beExpr.value.trim() || "0";
  try{
    const rows = buildTruthTableFromExpr(expr, n);
    if(rows.some(r=>r.err)) throw new Error(rows.find(r=>r.err).err);
    const headers = [...labs, "Y"];
    const tableRows = rows.map(r=>[
      ...r.bits.map(v=>({v:String(v), mono:true})),
      {v:String(r.y), mono:true}
    ]);
    renderTable(beTable, headers, tableRows);
    const mins = mintermsFromRows(rows);
    const maxs = maxtermsFromRows(rows);
    beTerms.textContent =
`Σm = (${joinCsv(mins)})
ΠM = (${joinCsv(maxs)})

Canonical SOP:
${canonicalSOP(mins,n)}

Canonical POS:
${canonicalPOS(maxs,n)}`;
  }catch(e){
    beTable.innerHTML = "";
    beTerms.textContent = "Error: " + e.message;
  }
}

document.getElementById("beGenTT").addEventListener("click", genBETable);
document.getElementById("beExample").addEventListener("click", ()=>{
  beVars.value = "4";
  beExpr.value = "(A & !B) | (C ^ D)";
  APP.be.inputs = [1,0,1,0];
  updateBE();
  genBETable();
});
beVars.addEventListener("change", updateBE);
beExpr.addEventListener("input", updateBE);

/* ===========================
   K-Map Module (2-4 vars)
   Gray order:
   2 vars: rows A, cols B (0,1)
   3 vars: rows A (0,1), cols BC in Gray: 00,01,11,10
   4 vars: rows AB in Gray: 00,01,11,10 ; cols CD in Gray: 00,01,11,10
=========================== */
const kmVars = document.getElementById("kmVars");
const kmMode = document.getElementById("kmMode");
const kmWrap = document.getElementById("kmWrap");
const kmTerms = document.getElementById("kmTerms");
const kmSop = document.getElementById("kmSop");

function gray2(n){
  return n===0 ? ["0","1"] : ["00","01","11","10"];
}
function initKmap(){
  const n = Number(kmVars.value);
  APP.kmap.n = n;

  const size = 1<<n;
  if(!APP.kmap.cells || APP.kmap.cells.length!==size){
    APP.kmap.cells = new Array(size).fill(0);
  }
  renderKmap();
}
function cycleCell(val){
  if(val===0) return 1;
  if(val===1) return "X";
  return 0;
}
function renderKmap(){
  const n = Number(kmVars.value);
  const mode = kmMode.value;
  APP.kmap.n = n;
  APP.kmap.mode = mode;

  // create layout
  kmWrap.innerHTML = "";
  const info = document.createElement("div");
  info.className = "small muted";
  info.textContent = (n===2) ? "Rows: A  | Cols: B" : (n===3) ? "Rows: A  | Cols: BC (Gray)" : "Rows: AB (Gray) | Cols: CD (Gray)";
  kmWrap.appendChild(info);

  let rLabels=[], cLabels=[], rBits=[], cBits=[];
  if(n===2){
    rLabels = ["A=0","A=1"];
    cLabels = ["B=0","B=1"];
    rBits = ["0","1"];
    cBits = ["0","1"];
  } else if(n===3){
    rLabels = ["A=0","A=1"];
    cBits = gray2(1); // use 2-bit gray for BC
    cLabels = cBits.map(b=>"BC="+b);
    rBits = ["0","1"]; // A
  } else { // 4
    rBits = gray2(1); // AB gray
    cBits = gray2(1); // CD gray
    rLabels = rBits.map(b=>"AB="+b);
    cLabels = cBits.map(b=>"CD="+b);
  }

  const grid = document.createElement("div");
  grid.className = "kmapGrid";

  // grid columns: +1 for left header
  const cols = cLabels.length + 1;
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(70px, 1fr))`;

  // top-left empty
  const tl = document.createElement("div");
  tl.className = "kcell";
  tl.style.cursor = "default";
  tl.style.background = "linear-gradient(180deg, rgba(63,111,255,.08), #fff)";
  tl.textContent = (n===2) ? "A\\B" : (n===3) ? "A\\BC" : "AB\\CD";
  grid.appendChild(tl);

  // top headers
  cLabels.forEach((lab)=>{
    const h = document.createElement("div");
    h.className = "kcell";
    h.style.cursor = "default";
    h.style.background = "linear-gradient(180deg, rgba(63,111,255,.08), #fff)";
    h.textContent = lab;
    grid.appendChild(h);
  });

  // rows
  for(let r=0;r<rLabels.length;r++){
    const rh = document.createElement("div");
    rh.className = "kcell";
    rh.style.cursor = "default";
    rh.style.background = "linear-gradient(180deg, rgba(63,111,255,.08), #fff)";
    rh.textContent = rLabels[r];
    grid.appendChild(rh);

    for(let c=0;c<cLabels.length;c++){
      const cell = document.createElement("div");
      cell.className = "kcell";

      // compute minterm index from gray labels
      let bitsStr = "";
      if(n===2){
        bitsStr = rBits[r] + cBits[c]; // A B
      } else if(n===3){
        bitsStr = rBits[r] + cBits[c]; // A BC
      } else {
        bitsStr = rBits[r] + cBits[c]; // AB CD
      }
      const bits = bitsStr.split("").map(x=>Number(x));
      const m = bitsToIndex(bits);

      const val = APP.kmap.cells[m];
      cell.classList.toggle("on", val===1);
      cell.innerHTML = `<span class="m">m${m}</span>${val===0?"0":(val===1?"1":"X")}`;

      cell.addEventListener("click", ()=>{
        let v = APP.kmap.cells[m];
        if(mode==="toggle01"){
          APP.kmap.cells[m] = (v===1)?0:1;
        } else if(mode==="cycle01x"){
          APP.kmap.cells[m] = cycleCell(v);
        } else if(mode==="set1"){
          APP.kmap.cells[m] = 1;
        } else if(mode==="set0"){
          APP.kmap.cells[m] = 0;
        } else {
          APP.kmap.cells[m] = "X";
        }
        renderKmap();
      });

      grid.appendChild(cell);
    }
  }
  kmWrap.appendChild(grid);
  updateKmapTermsAndSOP();
}

function updateKmapTermsAndSOP(){
  const n = APP.kmap.n;
  const mins=[], dcs=[];
  for(let i=0;i<APP.kmap.cells.length;i++){
    const v = APP.kmap.cells[i];
    if(v===1) mins.push(i);
    else if(v==="X") dcs.push(i);
  }
  kmTerms.textContent =
`Σm = (${joinCsv(mins)})
d   = (${joinCsv(dcs)})`;

  kmSop.textContent = simplifyKmapBestEffort(mins, dcs, n);
}

// Best-effort K-map SOP simplifier (covers typical groups)
// It searches groups of size powers of two on toroidal map grid.
function simplifyKmapBestEffort(mins, dcs, n){
  const N = 1<<n;
  const onSet = new Set(mins);
  const dcSet = new Set(dcs);
  const allowed = (i)=> onSet.has(i) || dcSet.has(i);

  if(mins.length===0) return "0";
  if(mins.length===N) return "1";

  // map to K-map coordinates
  // Return (r,c) and inverse, using Gray mapping
  function grayOrder2(){ return ["00","01","11","10"]; }
  function grayIndex2(bitstr){
    const order = grayOrder2();
    return order.indexOf(bitstr);
  }
  function getRC(m){
    const b = indexToBits(m,n).map(String).join("");
    if(n===2){
      const A=b[0], B=b[1];
      return {r: Number(A), c: Number(B), rCount:2, cCount:2};
    }
    if(n===3){
      const A=b[0], BC=b.slice(1);
      return {r: Number(A), c: grayIndex2(BC), rCount:2, cCount:4};
    }
    // n===4
    const AB=b.slice(0,2), CD=b.slice(2);
    return {r: grayIndex2(AB), c: grayIndex2(CD), rCount:4, cCount:4};
  }
  function getMFromRC(r,c){
    if(n===2){
      const A = r&1, B = c&1;
      return bitsToIndex([A,B]);
    }
    if(n===3){
      const order = ["00","01","11","10"];
      const A = r&1;
      const bc = order[c%4];
      return bitsToIndex([A, Number(bc[0]), Number(bc[1])]);
    }
    const order = ["00","01","11","10"];
    const ab = order[r%4];
    const cd = order[c%4];
    return bitsToIndex([Number(ab[0]),Number(ab[1]),Number(cd[0]),Number(cd[1])]);
  }

  // prepare grid size
  const sample = getRC(0);
  const R = sample.rCount, C = sample.cCount;

  // list all candidate rectangles sizes (powers of 2, within R,C)
  const sizes = [];
  for(let h=1; h<=R; h*=2){
    for(let w=1; w<=C; w*=2){
      sizes.push({h,w, area:h*w});
    }
  }
  sizes.sort((a,b)=>b.area-a.area); // bigger first

  // find all groups that are fully allowed and cover at least one minterm
  const groups = [];
  for(const {h,w,area} of sizes){
    for(let r0=0;r0<R;r0++){
      for(let c0=0;c0<C;c0++){
        const cells = [];
        let ok = true;
        let coversOn = false;
        for(let dr=0;dr<h;dr++){
          for(let dc=0;dc<w;dc++){
            const r = (r0+dr)%R;
            const c = (c0+dc)%C;
            const m = getMFromRC(r,c);
            cells.push(m);
            if(!allowed(m)){ ok=false; break; }
            if(onSet.has(m)) coversOn = true;
          }
          if(!ok) break;
        }
        if(ok && coversOn){
          const key = [...new Set(cells)].sort((x,y)=>x-y).join(",");
          groups.push({cells:[...new Set(cells)], area, key});
        }
      }
    }
  }
  // unique groups by key, keep max area instance
  const mapG = new Map();
  for(const g of groups){
    if(!mapG.has(g.key) || mapG.get(g.key).area < g.area) mapG.set(g.key,g);
  }
  const uniq = [...mapG.values()].sort((a,b)=>b.area-a.area);

  // greedy cover minterms
  const uncovered = new Set(mins);
  const chosen = [];
  for(const g of uniq){
    let gain=0;
    for(const m of g.cells) if(uncovered.has(m)) gain++;
    if(gain>0){
      chosen.push(g);
      for(const m of g.cells) uncovered.delete(m);
      if(uncovered.size===0) break;
    }
  }
  // if still uncovered, add singletons
  if(uncovered.size>0){
    for(const m of uncovered){
      chosen.push({cells:[m], area:1, key:String(m)});
    }
  }

  // convert group to implicant by detecting stable bits across minterms in group
  const vs = varsAll.slice(0,n);
  function implicantFromCells(cells){
    const bitLists = cells.map(m=>indexToBits(m,n));
    const keep = [];
    for(let i=0;i<n;i++){
      const all0 = bitLists.every(b=>b[i]===0);
      const all1 = bitLists.every(b=>b[i]===1);
      if(all0) keep.push("!"+vs[i]);
      else if(all1) keep.push(vs[i]);
      else ; // eliminated
    }
    if(keep.length===0) return "1";
    return keep.join(" & ");
  }

  const terms = chosen.map(g=>{
    const imp = implicantFromCells(g.cells);
    return (imp.includes(" & ") || imp.includes(" | ")) ? "(" + imp + ")" : imp;
  });

  // de-duplicate same term
  const termSet = [];
  terms.forEach(t=>{ if(!termSet.includes(t)) termSet.push(t); });

  return termSet.join(" | ");
}

kmVars.addEventListener("change", initKmap);
kmMode.addEventListener("change", renderKmap);
document.getElementById("kmClear").addEventListener("click", ()=>{
  APP.kmap.cells = new Array(1<<Number(kmVars.value)).fill(0);
  renderKmap();
});
document.getElementById("kmExample").addEventListener("click", ()=>{
  kmVars.value = "4";
  initKmap();
  // example: Σm(0,2,5,7,8,10,13,15)
  const ex = [0,2,5,7,8,10,13,15];
  APP.kmap.cells.fill(0);
  ex.forEach(m=>APP.kmap.cells[m]=1);
  renderKmap();
});

/* ===========================
   MUX/DEMUX
=========================== */
const muxType = document.getElementById("muxType");
const muxEn = document.getElementById("muxEn");
const muxData = document.getElementById("muxData");
const muxSel = document.getElementById("muxSel");
const muxOut = document.getElementById("muxOut");

function updateMux(){
  const t = Number(muxType.value);
  APP.mux.type = t;
  const selBits = Math.log2(t);

  if(APP.mux.data.length!==t) APP.mux.data = new Array(t).fill(0);
  if(APP.mux.sel.length!==selBits) APP.mux.sel = new Array(selBits).fill(0);

  mkSingleChip(muxEn, "E", APP.mux, "en", ()=>updateMux());
  mkChips(muxData, Array.from({length:t}, (_,i)=>"D"+i), APP.mux.data, ()=>updateMux());
  mkChips(muxSel, Array.from({length:selBits}, (_,i)=>"S"+(selBits-1-i)), APP.mux.sel, ()=>updateMux());

  const selIndex = bitsToIndex(APP.mux.sel.map(x=>x?1:0));
  const enabled = !!APP.mux.en;
  const y = enabled ? (APP.mux.data[selIndex]?1:0) : 0;

  muxOut.textContent =
`Type: ${t}:1
E=${APP.mux.en}
Select (binary) = ${APP.mux.sel.join("")}  -> ${selIndex}
Y = ${y}
Selected input: D${selIndex} = ${APP.mux.data[selIndex]?1:0}`;
}
muxType.addEventListener("change", updateMux);

const dmxType = document.getElementById("dmxType");
const dmxEn = document.getElementById("dmxEn");
const dmxIn = document.getElementById("dmxIn");
const dmxSel = document.getElementById("dmxSel");
const dmxOut = document.getElementById("dmxOut");

function updateDemux(){
  const t = Number(dmxType.value);
  APP.dmx.type = t;
  const selBits = Math.log2(t);

  if(APP.dmx.sel.length!==selBits) APP.dmx.sel = new Array(selBits).fill(0);

  mkSingleChip(dmxEn, "E", APP.dmx, "en", ()=>updateDemux());
  mkSingleChip(dmxIn, "D", APP.dmx, "din", ()=>updateDemux());
  mkChips(dmxSel, Array.from({length:selBits}, (_,i)=>"S"+(selBits-1-i)), APP.dmx.sel, ()=>updateDemux());

  const selIndex = bitsToIndex(APP.dmx.sel.map(x=>x?1:0));
  const outs = new Array(t).fill(0);
  if(APP.dmx.en){
    outs[selIndex] = APP.dmx.din ? 1 : 0;
  }
  dmxOut.textContent =
`Type: 1:${t}
E=${APP.dmx.en}  D=${APP.dmx.din}
Select = ${APP.dmx.sel.join("")} -> ${selIndex}

Outputs:
${outs.map((v,i)=>`Y${i}=${v}`).join("  ")}`;
}
dmxType.addEventListener("change", updateDemux);

/* ===========================
   Decoder / Encoder
=========================== */
const decType = document.getElementById("decType");
const decEn = document.getElementById("decEn");
const decIn = document.getElementById("decIn");
const decOut = document.getElementById("decOut");

function updateDecoder(){
  const n = Number(decType.value); // input bits
  APP.dec.type = n;
  const outN = 1<<n;
  if(APP.dec.in.length!==n) APP.dec.in = new Array(n).fill(0);

  mkSingleChip(decEn, "E", APP.dec, "en", ()=>updateDecoder());
  mkChips(decIn, varsAll.slice(0,n), APP.dec.in, ()=>updateDecoder());

  const idx = bitsToIndex(APP.dec.in.map(x=>x?1:0));
  const outs = new Array(outN).fill(0);
  if(APP.dec.en) outs[idx] = 1;

  decOut.textContent =
`Type: ${n}→${outN}
E=${APP.dec.en}
Input = ${APP.dec.in.join("")} (index ${idx})

One-hot outputs:
${outs.map((v,i)=>`Y${i}=${v}`).join("  ")}`;
}
decType.addEventListener("change", updateDecoder);

const encType = document.getElementById("encType");
const encIn = document.getElementById("encIn");
const encOut = document.getElementById("encOut");

function updateEncoder(){
  const m = Number(encType.value); // one-hot inputs
  APP.enc.type = m;
  const n = Math.log2(m); // output bits
  if(APP.enc.in.length!==m) APP.enc.in = new Array(m).fill(0);

  // one-hot chips
  encIn.innerHTML = "";
  for(let i=0;i<m;i++){
    const b = document.createElement("button");
    b.className = "chip " + (APP.enc.in[i]? "on":"");
    b.textContent = `I${i}: ${APP.enc.in[i]?1:0}`;
    b.addEventListener("click", ()=>{
      // toggle, but keep one-hot if user clicks (turn others off when turning on)
      if(APP.enc.in[i]){
        APP.enc.in[i] = 0;
      } else {
        APP.enc.in.fill(0);
        APP.enc.in[i] = 1;
      }
      updateEncoder();
    });
    encIn.appendChild(b);
  }

  const active = APP.enc.in.map((v,i)=>v?i:-1).filter(i=>i>=0);
  if(active.length===0){
    encOut.textContent = `No active input. Output = ${"0".repeat(n)} (idle)`;
    return;
  }
  if(active.length>1){
    encOut.textContent = `Invalid: multiple active inputs: ${active.join(", ")}\nOutput undefined`;
    return;
  }
  const idx = active[0];
  const bits = indexToBits(idx, n);
  encOut.textContent =
`Type: ${m}→${n}
Active input: I${idx}=1
Output = ${bits.join("")}
(A MSB)`;
}
encType.addEventListener("change", updateEncoder);

/* ===========================
   Sequential Module
=========================== */
const seqType = document.getElementById("seqType");
const seqInputs = document.getElementById("seqInputs");
const seqClockInfo = document.getElementById("seqClockInfo");
const seqState = document.getElementById("seqState");
const seqSummary = document.getElementById("seqSummary");

function seqIsFF(type){
  return type==="jk_ff" || type==="d_ff" || type==="t_ff";
}
function renderSeqInputs(){
  const type = seqType.value;
  APP.seq.type = type;

  const needed = [];
  if(type==="sr_nor" || type==="sr_nand") needed.push("S","R");
  if(type==="jk_ff") needed.push("J","K");
  if(type==="d_ff") needed.push("D");
  if(type==="t_ff") needed.push("T");

  seqInputs.innerHTML = "";
  needed.forEach(k=>{
    const b = document.createElement("button");
    b.className = "chip " + (APP.seq.inputs[k] ? "on":"");
    b.textContent = `${k}: ${APP.seq.inputs[k]?1:0}`;
    b.addEventListener("click", ()=>{
      APP.seq.inputs[k] = APP.seq.inputs[k]?0:1;
      renderSeq();
    });
    seqInputs.appendChild(b);
  });

  seqClockInfo.textContent = seqIsFF(type)
    ? `Clocked device. Press “Clock ↑ (Step)” to update Q.\nInternal CLK steps: ${APP.seq.inputs.CLK||0}`
    : `Latch device. Output updates immediately based on inputs (no clock).`;
}
function computeLatchSR(type, S, R, Qprev){
  // NOR SR latch (active high): invalid S=R=1
  if(type==="sr_nor"){
    if(S===1 && R===1) return {Q:Qprev, invalid:true};
    if(S===1 && R===0) return {Q:1, invalid:false};
    if(S===0 && R===1) return {Q:0, invalid:false};
    return {Q:Qprev, invalid:false};
  }
  // NAND SR latch (active low): inputs are /S, /R typically. Here we treat S,R as active-low.
  // invalid when S=R=0
  if(S===0 && R===0) return {Q:Qprev, invalid:true};
  if(S===0 && R===1) return {Q:1, invalid:false};
  if(S===1 && R===0) return {Q:0, invalid:false};
  return {Q:Qprev, invalid:false};
}
function clockStep(){
  APP.seq.inputs.CLK = (APP.seq.inputs.CLK||0) + 1;

  const type = APP.seq.type;
  let Q = APP.seq.Q;

  if(type==="jk_ff"){
    const J = APP.seq.inputs.J?1:0;
    const K = APP.seq.inputs.K?1:0;
    if(J===0 && K===0) Q = Q;
    else if(J===0 && K===1) Q = 0;
    else if(J===1 && K===0) Q = 1;
    else Q = Q?0:1;
  } else if(type==="d_ff"){
    Q = APP.seq.inputs.D?1:0;
  } else if(type==="t_ff"){
    const T = APP.seq.inputs.T?1:0;
    Q = T ? (Q?0:1) : Q;
  }
  APP.seq.Q = Q;
  renderSeq();
}

function renderSeq(){
  renderSeqInputs();
  const type = APP.seq.type;
  let Q = APP.seq.Q;
  let invalid = false;

  if(type==="sr_nor" || type==="sr_nand"){
    const S = APP.seq.inputs.S?1:0;
    const R = APP.seq.inputs.R?1:0;
    const r = computeLatchSR(type, S, R, Q);
    Q = r.Q; invalid = r.invalid;
    APP.seq.Q = Q;
  }

  const Qbar = Q?0:1;
  seqState.textContent = `Q = ${Q}\nQ̅ = ${Qbar}\n${invalid? "⚠ Invalid/Forbidden input combination." : ""}`;

  if(type==="sr_nor"){
    seqSummary.textContent =
`SR Latch (NOR, active-high)
S R | Q(next)
0 0 | Hold
0 1 | 0 (Reset)
1 0 | 1 (Set)
1 1 | Invalid`;
  } else if(type==="sr_nand"){
    seqSummary.textContent =
`SR Latch (NAND, active-low)
S R | Q(next)
1 1 | Hold
1 0 | 0 (Reset)
0 1 | 1 (Set)
0 0 | Invalid`;
  } else if(type==="jk_ff"){
    seqSummary.textContent =
`JK Flip-Flop (on clock edge)
J K | Q(next)
0 0 | Hold
0 1 | 0 (Reset)
1 0 | 1 (Set)
1 1 | Toggle`;
  } else if(type==="d_ff"){
    seqSummary.textContent =
`D Flip-Flop (on clock edge)
D | Q(next)
0 | 0
1 | 1`;
  } else {
    seqSummary.textContent =
`T Flip-Flop (on clock edge)
T | Q(next)
0 | Hold
1 | Toggle`;
  }
}

seqType.addEventListener("change", ()=>{
  APP.seq.Q = 0;
  APP.seq.inputs = {S:0,R:0,J:0,K:0,D:0,T:0,CLK:0};
  renderSeq();
});
document.getElementById("seqClock").addEventListener("click", ()=>{
  if(!seqIsFF(APP.seq.type)) return;
  clockStep();
});
document.getElementById("seqReset").addEventListener("click", ()=>{
  APP.seq.Q = 0;
  renderSeq();
});

/* ===========================
   Conversions
=========================== */
const convBase = document.getElementById("convBase");
const convValue = document.getElementById("convValue");
const convBits = document.getElementById("convBits");
const convStatus = document.getElementById("convStatus");
const convOut = document.getElementById("convOut");

function parseInputByBase(base, s){
  let v = (s||"").trim();
  if(!v) throw new Error("Empty input");

  if(base==="bin"){
    v = v.replace(/^0b/i,"");
    if(!/^[01]+$/.test(v)) throw new Error("Binary must be 0/1 only");
    return BigInt("0b"+v);
  }
  if(base==="hex"){
    v = v.replace(/^0x/i,"");
    if(!/^[0-9a-fA-F]+$/.test(v)) throw new Error("Hex must be 0-9 A-F");
    return BigInt("0x"+v);
  }
  // dec
  if(!/^-?\d+$/.test(v)) throw new Error("Decimal must be integer");
  return BigInt(v);
}

function toTwosComplementUnsigned(x, bits){
  // x can be negative; convert to unsigned in [0,2^bits-1]
  const mod = 1n << BigInt(bits);
  let u = x % mod;
  if(u < 0n) u += mod;
  return u;
}
function signedFromUnsigned(u, bits){
  const mod = 1n << BigInt(bits);
  const half = mod >> 1n;
  if(u >= half) return u - mod;
  return u;
}
function padBin(bin, bits){
  let s = bin;
  if(s.length < bits) s = "0".repeat(bits - s.length) + s;
  return s;
}

function runConv(){
  const base = convBase.value;
  const bits = Number(convBits.value);
  APP.conv.base = base;
  APP.conv.value = convValue.value;
  APP.conv.bits = bits;

  try{
    const x = parseInputByBase(base, convValue.value);
    const u = toTwosComplementUnsigned(x, bits); // store in bits
    const s = signedFromUnsigned(u, bits);

    const bin = padBin(u.toString(2), bits);
    const hex = u.toString(16).toUpperCase();

    convStatus.textContent = "OK";
    convOut.textContent =
`Bit width: ${bits}
Unsigned (within width): ${u.toString(10)}
Signed (two’s complement): ${s.toString(10)}

BIN: ${bin}
HEX: 0x${hex}

Note:
- Negative decimals are stored in two’s complement within the chosen width.
- If your number is too large, it wraps modulo 2^bits.`;
  }catch(e){
    convStatus.textContent = "Error: " + e.message;
    convOut.textContent = "";
  }
}
document.getElementById("convRun").addEventListener("click", runConv);
document.getElementById("convCopy").addEventListener("click", async ()=>{
  try{ await navigator.clipboard.writeText(convOut.textContent); }catch{}
});
document.getElementById("convExample").addEventListener("click", ()=>{
  convBase.value = "dec";
  convBits.value = "8";
  convValue.value = "-45";
  runConv();
});
document.getElementById("convClear").addEventListener("click", ()=>{
  convValue.value = "";
  convOut.textContent = "";
  convStatus.textContent = "";
});

/* ===========================
   NAND/NOR Implementation
   Strategy: parse expr -> AST -> rewrite to NAND-only and NOR-only
   Represent NAND/NOR as function calls:
     NAND(x,y) , NOR(x,y)
   Use these identities:
     NOT a = NAND(a,a)  and also NOT a = NOR(a,a)
     a AND b = NOT(NAND(a,b)) = NAND(NAND(a,b), NAND(a,b))
     a OR b = NAND(NAND(a,a), NAND(b,b))  (DeMorgan)
     XOR: build from AND/OR/NOT:
       a XOR b = (a & !b) | (!a & b)
=========================== */
const implVars = document.getElementById("implVars");
const implExpr = document.getElementById("implExpr");
const implInputs = document.getElementById("implInputs");
const implEval = document.getElementById("implEval");
const onlyNand = document.getElementById("onlyNand");
const onlyNor = document.getElementById("onlyNor");
const implCount = document.getElementById("implCount");

function astExpandXor(ast){
  // convert XOR nodes to OR/AND/NOT form
  if(ast.k==="xor"){
    // (a & !b) | (!a & b)
    const a = astExpandXor(ast.a);
    const b = astExpandXor(ast.b);
    return {
      k:"or",
      a:{k:"and", a: a, b:{k:"not", a:b}},
      b:{k:"and", a:{k:"not", a:a}, b:b}
    };
  }
  if(ast.k==="and" || ast.k==="or"){
    return {k:ast.k, a:astExpandXor(ast.a), b:astExpandXor(ast.b)};
  }
  if(ast.k==="not"){
    return {k:"not", a:astExpandXor(ast.a)};
  }
  return ast; // var/const
}

function astToOnlyNand(ast){
  // returns string with NAND() only
  // constants handled by generating forms using vars? We'll handle 0/1 by fixed NAND patterns:
  // 1 = NAND(A, NAND(A,A)) for any A (choose A) ; 0 = NAND(1,1)
  const anyVar = "A";

  function one(){
    // 1 = NAND(A, NAND(A,A))
    return `NAND(${anyVar}, NAND(${anyVar}, ${anyVar}))`;
  }
  function zero(){
    const o = one();
    return `NAND(${o}, ${o})`;
  }

  function nnot(x){ return `NAND(${x}, ${x})`; }
  function nand(a,b){ return `NAND(${a}, ${b})`; }

  // AND using NAND:
  function aand(a,b){
    const t = nand(a,b);
    return nand(t,t);
  }
  // OR using NAND: a OR b = NAND(NAND(a,a), NAND(b,b))
  function oor(a,b){
    return nand(nnot(a), nnot(b));
  }

  switch(ast.k){
    case "var": return ast.v;
    case "const": return ast.v ? one() : zero();
    case "not": return nnot(astToOnlyNand(ast.a));
    case "and": return aand(astToOnlyNand(ast.a), astToOnlyNand(ast.b));
    case "or":  return oor(astToOnlyNand(ast.a), astToOnlyNand(ast.b));
    default: throw new Error("Unexpected in NAND rewrite");
  }
}

function astToOnlyNor(ast){
  const anyVar = "A";

  function zero(){
    // 0 = NOR(A, NOR(A,A)) because NOR(A,A)=!A, NOR(A,!A)=0
    return `NOR(${anyVar}, NOR(${anyVar}, ${anyVar}))`;
  }
  function one(){
    const z = zero();
    return `NOR(${z}, ${z})`;
  }

  function nnot(x){ return `NOR(${x}, ${x})`; }
  function nor(a,b){ return `NOR(${a}, ${b})`; }

  // OR using NOR:
  function oor(a,b){
    const t = nor(a,b); // t = !(a|b)
    return nor(t,t);    // !t = a|b
  }
  // AND using NOR: a & b = NOR(NOR(a,a), NOR(b,b))
  function aand(a,b){
    return nor(nnot(a), nnot(b));
  }

  switch(ast.k){
    case "var": return ast.v;
    case "const": return ast.v ? one() : zero();
    case "not": return nnot(astToOnlyNor(ast.a));
    case "and": return aand(astToOnlyNor(ast.a), astToOnlyNor(ast.b));
    case "or":  return oor(astToOnlyNor(ast.a), astToOnlyNor(ast.b));
    default: throw new Error("Unexpected in NOR rewrite");
  }
}

function countGates(str, name){
  const re = new RegExp("\\b"+name+"\\s*\\(", "g");
  const m = str.match(re);
  return m ? m.length : 0;
}

function evalOnlyGateExpr(expr, env, gateName){
  // expr is like NAND(A, NAND(B,B)) etc
  // simple recursive descent for functions + variables + commas.
  const s = expr.replace(/\s+/g,"");
  let i=0;

  function peek(){ return s[i] || ""; }
  function eat(ch){
    if(s[i]!==ch) throw new Error(`Expected '${ch}' at ${i}`);
    i++;
  }
  function readName(){
    let j=i;
    while(j<s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    if(j===i) throw new Error("Expected name at "+i);
    const name = s.slice(i,j);
    i=j;
    return name;
  }
  function parseNode(){
    const name = readName();
    if(name==="NAND" || name==="NOR"){
      eat("(");
      const a = parseNode();
      eat(",");
      const b = parseNode();
      eat(")");
      const av = a, bv = b;
      if(name==="NAND") return (av & bv) ? 0 : 1;
      return (av | bv) ? 0 : 1;
    }
    // variable
    if(!/^[A-D]$/.test(name)) throw new Error("Bad token: "+name);
    return env[name] ? 1 : 0;
  }

  const v = parseNode();
  if(i !== s.length) throw new Error("Trailing input near "+i);
  return v;
}

function updateImpl(){
  const n = Number(implVars.value);
  APP.impl.n = n;
  APP.impl.expr = implExpr.value.trim();

  const labs = varsAll.slice(0,n);
  mkChips(implInputs, labs, APP.impl.inputs, ()=>updateImpl());

  const env = envFromBits(APP.impl.inputs.slice(0,n).map(x=>x?1:0), n);

  try{
    const {ast, val} = parseAndEval(APP.impl.expr || "0", env);
    const expanded = astExpandXor(ast); // remove XOR
    const nandForm = astToOnlyNand(expanded);
    const norForm  = astToOnlyNor(expanded);

    onlyNand.textContent = nandForm;
    onlyNor.textContent  = norForm;

    // evaluate both to show equivalence
    const vNand = evalOnlyGateExpr(nandForm, env, "NAND");
    const vNor  = evalOnlyGateExpr(norForm, env, "NOR");

    implEval.textContent =
`Inputs: ${fmtBits(labs.map(v=>env[v]?1:0), labs)}
Original Y = ${val}
Only-NAND Y = ${vNand}
Only-NOR  Y = ${vNor}`;

    const nandCount = countGates(nandForm,"NAND");
    const norCount  = countGates(norForm,"NOR");
    implCount.textContent =
`Rough gate count (2-input):
NAND gates: ${nandCount}
NOR  gates: ${norCount}

Note: XOR was expanded using AND/OR/NOT then rewritten.`;
  }catch(e){
    onlyNand.textContent = "";
    onlyNor.textContent = "";
    implEval.textContent = "Error: " + e.message;
    implCount.textContent = "";
  }
}

document.getElementById("implRun").addEventListener("click", updateImpl);
document.getElementById("implClear").addEventListener("click", ()=>{
  implExpr.value = "";
  onlyNand.textContent = "";
  onlyNor.textContent = "";
  implEval.textContent = "";
  implCount.textContent = "";
});
document.getElementById("implExample").addEventListener("click", ()=>{
  implVars.value = "4";
  implExpr.value = "(A & B) | (!C) ^ D";
  APP.impl.inputs = [1,1,0,1];
  updateImpl();
});
document.getElementById("implTest").addEventListener("click", ()=>{
  // random tests 16 cases (or all for 2/3 vars) to compare original vs nand/nor
  const n = Number(implVars.value);
  const expr = implExpr.value.trim() || "0";
  const tests = Math.min(32, 1<<n);
  let ok = true;
  let msg = "";
  try{
    const toks = tokenizeExpr(expr);
    const ast = parseExpr(toks);
    const expanded = astExpandXor(ast);
    const nandForm = astToOnlyNand(expanded);
    const norForm  = astToOnlyNor(expanded);

    for(let t=0;t<tests;t++){
      const bits = indexToBits(Math.floor(Math.random()*(1<<n)), n);
      const env = envFromBits(bits, n);
      const o = evalAst(ast, env);
      const a = evalOnlyGateExpr(nandForm, env, "NAND");
      const b = evalOnlyGateExpr(norForm, env, "NOR");
      if(o!==a || o!==b){
        ok = false;
        msg = `Mismatch on ${bits.join("")}: orig=${o}, nand=${a}, nor=${b}`;
        break;
      }
    }
    implEval.textContent = (ok ? "Quick Test: PASS ✅" : "Quick Test: FAIL ❌\n"+msg) + "\n\n" + implEval.textContent;
  }catch(e){
    implEval.textContent = "Error: " + e.message;
  }
});

/* ===========================
   Global Export / Reset
=========================== */
document.getElementById("btnExport").addEventListener("click", async ()=>{
  const state = deepClone(APP);
  const json = JSON.stringify(state, null, 2);
  try{ await navigator.clipboard.writeText(json); }catch{}
  alert("Export copied to clipboard as JSON.");
});

document.getElementById("btnResetAll").addEventListener("click", ()=>{
  // reset minimal
  APP.gates = { n:2, type:"AND", inputs:[0,0,0,0] };
  APP.tt = { n:3, method:"expr", expr:"(A & !B) | C", terms:"1,3,5,7" };
  APP.be = { n:4, expr:"(A & !B) | (C ^ D)", inputs:[0,0,0,0] };
  APP.kmap = { n:4, mode:"cycle01x", cells:new Array(16).fill(0) };
  APP.mux = { type:4, en:1, data:new Array(4).fill(0), sel:[0,0] };
  APP.dmx = { type:4, en:1, din:1, sel:[0,0] };
  APP.dec = { type:3, en:1, in:[0,0,0] };
  APP.enc = { type:8, in:new Array(8).fill(0) };
  APP.seq = { type:"jk_ff", inputs:{S:0,R:0,J:0,K:0,D:0,T:0,CLK:0}, Q:0 };
  APP.conv = { base:"dec", value:"45", bits:8 };
  APP.impl = { n:4, expr:"(A & B) | (!C)", inputs:[0,0,0,0] };

  // refresh all UIs
  boot();
});

/* ===========================
   Boot
=========================== */
function boot(){
  // Gates
  gateN.value = String(APP.gates.n);
  gateType.value = APP.gates.type;
  updateGates();

  // TT
  ttVars.value = String(APP.tt.n);
  ttMethod.value = APP.tt.method;
  ttExpr.value = APP.tt.expr;
  ttTerms.value = APP.tt.terms;
  updateTTUI();

  // BE
  beVars.value = String(APP.be.n);
  beExpr.value = APP.be.expr;
  updateBE();

  // Kmap
  kmVars.value = String(APP.kmap.n);
  kmMode.value = APP.kmap.mode;
  initKmap();

  // MUX/DEMUX
  muxType.value = String(APP.mux.type);
  dmxType.value = String(APP.dmx.type);
  updateMux();
  updateDemux();

  // Dec/Enc
  decType.value = String(APP.dec.type);
  encType.value = String(APP.enc.type);
  updateDecoder();
  updateEncoder();

  // Seq
  seqType.value = APP.seq.type;
  renderSeq();

  // Conv
  convBase.value = APP.conv.base;
  convValue.value = APP.conv.value;
  convBits.value = String(APP.conv.bits);
  convStatus.textContent = "";
  convOut.textContent = "";

  // Impl
  implVars.value = String(APP.impl.n);
  implExpr.value = APP.impl.expr;
  updateImpl();
}
boot();
});
