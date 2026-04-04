document.addEventListener("DOMContentLoaded", () => {
  /* =========================================================
     Optimized Helper Module with ES6+ Classes
  ========================================================= */
  const DOM = {
    select: (sel) => document.querySelector(sel),
    selectAll: (sel) => document.querySelectorAll(sel),
    create: (tag) => document.createElement(tag),
  };

  const $ = (sel) => DOM.select(sel);

  class OutputManager {
    constructor(elementId) {
      this.element = $(elementId);
      this.buffer = [];
    }

    setOutput(text, type = "") {
      const icons = { ok: "✅ ", warn: "⚠️ ", bad: "❌ " };
      const header = icons[type] || "";
      this.buffer = [`${header}${this.escapeHtml(text)}`];
      this.flush();
    }

    append(text) {
      this.buffer.push(this.escapeHtml(text));
    }

    flush() {
      this.element.textContent = this.buffer.join("\n");
      this.element.scrollTop = this.element.scrollHeight;
    }

    escapeHtml(str) {
      const div = DOM.create("div");
      div.textContent = str;
      return div.innerHTML;
    }
  }

  const out = new OutputManager("#output");

  const format = {
    number: (n) => {
      if (!Number.isFinite(n)) return String(n);
      const abs = Math.abs(n);
      if (abs === 0 || abs < 1e-10) return "0";
      return String(Math.round(n * 1e8) / 1e8);
    },

    value: (x) => {
      if (typeof x === "number") return format.number(x);
      if (x?.isUnit) return x.toString();
      if (x?.im !== undefined) {
        const re = format.number(x.re);
        const im = format.number(Math.abs(x.im));
        if (Math.abs(x.im) < 1e-12) return re;
        if (Math.abs(x.re) < 1e-12) return `${x.im >= 0 ? "" : "-"}${im}i`;
        return `${re} ${x.im >= 0 ? "+" : "-"} ${im}i`;
      }
      if (typeof x === "string") return x;
      if (x?.valueOf) return String(x.valueOf());
      return String(x);
    },

    matrix: (A) => A.map((r) => r.map((v) => format.value(v)).join("\t")).join("\n"),
  };

  const matrixUtils = {
    isSquare: (A) => A.length === A[0].length,
    toNumber: (A) => A.map((r) => r.map((v) => Number(typeof v === "number" ? v : math.number(v)))),
    clone: (A) => A.map((r) => r.map((v) => math.clone(v))),
    parseExpr: (s) => {
      try {
        return math.evaluate(s);
      } catch (e) {
        throw new Error(`Invalid expression: ${s}`);
      }
    },
  };

  /* =========================================================
     Optimized Matrix Algebra Class
  ========================================================= */
  class MatrixAlgebra {
    static rrefWithSteps(A) {
      const M = matrixUtils.clone(A);
      const rows = M.length;
      const cols = M[0].length;
      const steps = [];
      let lead = 0;

      const snap = (msg) => {
        steps.push(`${msg}\n${format.matrix(M)}`);
      };

      snap("Start:");

      for (let r = 0; r < rows; r++) {
        if (lead >= cols) break;

        let i = r;
        while (i < rows && math.equal(M[i][lead], 0)) i++;

        if (i === rows) {
          lead++;
          r--;
          continue;
        }

        if (i !== r) {
          [M[i], M[r]] = [M[r], M[i]];
          snap(`Swap R${i + 1} ↔ R${r + 1}:`);
        }

        const lv = M[r][lead];
        if (!math.equal(lv, 1)) {
          for (let j = 0; j < cols; j++) {
            M[r][j] = math.divide(M[r][j], lv);
          }
          snap(`Scale R${r + 1} ÷ (${format.value(lv)}):`);
        }

        for (let i2 = 0; i2 < rows; i2++) {
          if (i2 === r) continue;
          const lv2 = M[i2][lead];
          if (!math.equal(lv2, 0)) {
            for (let j = 0; j < cols; j++) {
              M[i2][j] = math.subtract(M[i2][j], math.multiply(lv2, M[r][j]));
            }
            snap(`R${i2 + 1} ← R${i2 + 1} − (${format.value(lv2)})·R${r + 1}:`);
          }
        }

        lead++;
      }

      return { RREF: M, steps };
    }

    static gaussEliminationSteps(A, b) {
      const M = A.map((row, i) => row.concat([b[i]]).map((v) => math.clone(v)));
      const n = M.length;
      const m = M[0].length;
      const steps = [];

      const snap = (msg) => {
        steps.push(`${msg}\n${format.matrix(M)}`);
      };

      snap("Start (Augmented [A|b]):");

      for (let k = 0; k < n; k++) {
        let piv = k;
        for (let i = k; i < n; i++) {
          if (!math.equal(M[i][k], 0)) {
            piv = i;
            break;
          }
        }

        if (math.equal(M[piv][k], 0)) {
          snap(`Pivot in column ${k + 1} is zero → skip.`);
          continue;
        }

        if (piv !== k) {
          [M[piv], M[k]] = [M[k], M[piv]];
          snap(`Swap R${piv + 1} ↔ R${k + 1}:`);
        }

        for (let i = k + 1; i < n; i++) {
          if (math.equal(M[i][k], 0)) continue;
          const factor = math.divide(M[i][k], M[k][k]);
          for (let j = k; j < m; j++) {
            M[i][j] = math.subtract(M[i][j], math.multiply(factor, M[k][j]));
          }
          snap(`R${i + 1} ← R${i + 1} − (${format.value(factor)})·R${k + 1}:`);
        }
      }

      const x = Array(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let lead = -1;
        for (let j = 0; j < n; j++) {
          if (!math.equal(M[i][j], 0)) {
            lead = j;
            break;
          }
        }

        if (lead === -1) {
          if (!math.equal(M[i][n], 0)) {
            return { steps, solution: null, status: "inconsistent", augmented: M };
          }
          continue;
        }

        let sum = 0;
        for (let j = lead + 1; j < n; j++) {
          sum = math.add(sum, math.multiply(M[i][j], x[j]));
        }
        x[lead] = math.divide(math.subtract(M[i][n], sum), M[i][lead]);
      }

      return { steps, solution: x, status: "ok", augmented: M };
    }

    static rankOf(A) {
      const { RREF } = this.rrefWithSteps(A);
      let rank = 0;
      for (const row of RREF) {
        if (!row.every((v) => math.equal(v, 0))) rank++;
      }
      return rank;
    }

    static nullSpaceBasis(A) {
      const { RREF } = this.rrefWithSteps(A);
      const m = RREF.length;
      const n = RREF[0].length;

      const pivots = [];
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
          if (!math.equal(RREF[i][j], 0)) {
            pivots.push(j);
            break;
          }
        }
      }

      const pivotSet = new Set(pivots);
      const freeCols = Array.from({ length: n }, (_, j) => j).filter((j) => !pivotSet.has(j));

      if (freeCols.length === 0) {
        return { basis: [], note: "Only trivial null space (full column rank)." };
      }

      const basis = freeCols.map((free) => {
        const v = Array(n).fill(0);
        v[free] = 1;

        for (let i = 0; i < m; i++) {
          let p = -1;
          for (let j = 0; j < n; j++) {
            if (!math.equal(RREF[i][j], 0)) {
              p = j;
              break;
            }
          }
          if (p > -1) {
            v[p] = math.multiply(-1, RREF[i][free]);
          }
        }
        return v;
      });

      return { basis, note: `Found ${basis.length} basis vector(s) for Null(A).` };
    }

    static rowSpaceBasis(A) {
      const { RREF } = this.rrefWithSteps(A);
      return RREF.filter((row) => !row.every((v) => math.equal(v, 0)));
    }

    static eigenSolve(A) {
      if (!matrixUtils.isSquare(A)) {
        throw new Error("Eigenvalues require a square matrix.");
      }

      if (typeof math.eigs === "function") {
        try {
          const M = math.matrix(A);
          const res = math.eigs(M);
          return { mode: "mathjs", values: res.values, vectors: res.vectors };
        } catch (e) {
          // Fallback to 2×2
        }
      }

      if (A.length === 2) {
        const [a, b, c, d] = [A[0][0], A[0][1], A[1][0], A[1][1]];
        const tr = math.add(a, d);
        const det = math.subtract(math.multiply(a, d), math.multiply(b, c));
        const disc = math.subtract(math.multiply(tr, tr), math.multiply(4, det));
        const sqrtDisc = math.sqrt(disc);
        const lam1 = math.divide(math.add(tr, sqrtDisc), 2);
        const lam2 = math.divide(math.subtract(tr, sqrtDisc), 2);

        const eigvec = (lam) => {
          const m11 = math.subtract(a, lam);
          if (!math.equal(b, 0) || !math.equal(m11, 0)) {
            return [b, math.subtract(lam, a)];
          }
          return [math.subtract(lam, d), c];
        };

        return { mode: "2x2", values: [lam1, lam2], vectors: [eigvec(lam1), eigvec(lam2)] };
      }

      throw new Error("Eigenvalues: requires 2×2 or math.eigs library support.");
    }
  }

  // Plotting functions
  function plot2DTransform(A2) {
    const A = matrixUtils.toNumber(A2);
    const pts = [];
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        pts.push([x, y]);
      }
    }

    const after = pts.map((p) => [A[0][0] * p[0] + A[0][1] * p[1], A[1][0] * p[0] + A[1][1] * p[1]]);

    const data = [
      { x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), mode: "markers", type: "scatter", name: "Before", marker: { size: 6 } },
      { x: after.map((p) => p[0]), y: after.map((p) => p[1]), mode: "markers", type: "scatter", name: "After", marker: { size: 6 } },
    ];

    const layout = {
      title: "2D Linear Transformation",
      xaxis: { title: "x", zeroline: true },
      yaxis: { title: "y", zeroline: true, scaleanchor: "x", scaleratio: 1 },
      margin: { l: 50, r: 20, t: 50, b: 45 },
      legend: { orientation: "h" },
    };

    $("#plot").style.display = "block";
    Plotly.newPlot("plot", data, layout, { responsive: true });
  }

  function plot4DTransformProjections(A4) {
    const A = matrixUtils.toNumber(A4);
    const pts = [];
    for (const x of [-2, -1, 0, 1, 2]) {
      for (const y of [-2, -1, 0, 1, 2]) {
        for (const z of [-2, 0, 2]) {
          pts.push([x, y, z, 0]);
        }
      }
    }

    const matVecMul = (M, v) => {
      const r = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        let s = 0;
        for (let j = 0; j < 4; j++) {
          s += M[i][j] * v[j];
        }
        r[i] = s;
      }
      return r;
    };

    const after = pts.map((v) => matVecMul(A, v));

    const data = [
      { x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), mode: "markers", type: "scatter", name: "XY Before", marker: { size: 5 } },
      { x: after.map((p) => p[0]), y: after.map((p) => p[1]), mode: "markers", type: "scatter", name: "XY After", marker: { size: 5 } },
      { x: pts.map((p) => p[2]), y: pts.map((p) => p[3]), mode: "markers", type: "scatter", name: "ZW Before", marker: { size: 5 } },
      { x: after.map((p) => p[2]), y: after.map((p) => p[3]), mode: "markers", type: "scatter", name: "ZW After", marker: { size: 5 } },
    ];

    const layout = {
      title: "4D Transformation Projections",
      xaxis: { title: "X/Z Axis" },
      yaxis: { title: "Y/W Axis" },
      margin: { l: 50, r: 20, t: 50, b: 45 },
      legend: { orientation: "h" },
    };

    $("#plot").style.display = "block";
    Plotly.newPlot("plot", data, layout, { responsive: true });
  }

  /* =========================================================
     Optimized Matrix Editor Component
  ========================================================= */
  function createMatrixEditor(container, idPrefix, r = 3, c = 3, label = "Matrix") {
    const root = DOM.create("div");

    root.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:flex-end;">
        <div>
          <div class="sectionTitle">${label}</div>
          <div class="hint mini">Type numbers/expressions. Paste block with rows separated by newlines.</div>
        </div>
        <div class="row">
          <label>Rows</label><input type="number" min="1" max="8" value="${r}" id="${idPrefix}_r" style="width:88px">
          <label>Cols</label><input type="number" min="1" max="8" value="${c}" id="${idPrefix}_c" style="width:88px">
          <button id="${idPrefix}_resize">Resize</button>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row">
        <button id="${idPrefix}_pasteBtn">Paste → Grid</button>
        <button id="${idPrefix}_gridToText">Grid → Text</button>
        <button id="${idPrefix}_textToGrid">Text → Grid</button>
      </div>
      <textarea id="${idPrefix}_text" placeholder="Paste matrix here"></textarea>
      <div class="divider"></div>
      <div class="matrixWrap">
        <div class="matrixGrid" id="${idPrefix}_grid"></div>
      </div>
    `;
    container.appendChild(root);

    const rInp = root.querySelector(`#${idPrefix}_r`);
    const cInp = root.querySelector(`#${idPrefix}_c`);
    const grid = root.querySelector(`#${idPrefix}_grid`);
    const text = root.querySelector(`#${idPrefix}_text`);

    const buildGrid = (rr, cc, oldValues = null) => {
      grid.style.gridTemplateColumns = `repeat(${cc}, 74px)`;
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < rr; i++) {
        for (let j = 0; j < cc; j++) {
          const inp = DOM.create("input");
          inp.className = "cell";
          inp.type = "text";
          inp.placeholder = "0";
          inp.value = oldValues?.[i]?.[j] ?? "";
          inp.dataset.r = i;
          inp.dataset.c = j;
          fragment.appendChild(inp);
        }
      }
      grid.innerHTML = "";
      grid.appendChild(fragment);
    };

    const readGrid = () => {
      const rr = Number(rInp.value);
      const cc = Number(cInp.value);
      const A = Array.from({ length: rr }, () => Array(cc).fill(0));

      grid.querySelectorAll("input.cell").forEach((cell) => {
        const i = Number(cell.dataset.r);
        const j = Number(cell.dataset.c);
        const val = cell.value.trim();
        A[i][j] = val ? matrixUtils.parseExpr(val) : 0;
      });
      return A;
    };

    const writeGrid = (A) => {
      rInp.value = A.length;
      cInp.value = A[0].length;
      buildGrid(A.length, A[0].length, A.map((r) => r.map((v) => String(v))));
    };

    const parseBlockToMatrix = (block) => {
      const lines = block
        .trim()
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const rows = lines.map((line) => line.split(/[\s,;]+/).filter(Boolean));
      const rr = rows.length;
      const cc = Math.max(...rows.map((r) => r.length), 1);
      return Array.from({ length: rr }, (_, i) => Array.from({ length: cc }, (_, j) => rows[i]?.[j] ?? "0"));
    };

    root.querySelector(`#${idPrefix}_resize`).onclick = () => {
      const rr = Number(rInp.value);
      const cc = Number(cInp.value);
      const old = readGrid().map((r) => r.map((v) => (v === 0 ? "" : format.value(v))));
      const vals = Array.from({ length: rr }, (_, i) => Array.from({ length: cc }, (_, j) => old[i]?.[j] ?? ""));
      buildGrid(rr, cc, vals);
    };

    root.querySelector(`#${idPrefix}_pasteBtn`).onclick = () => {
      text.focus();
      document.execCommand("paste");
    };

    root.querySelector(`#${idPrefix}_textToGrid`).onclick = () => {
      try {
        const Araw = parseBlockToMatrix(text.value);
        writeGrid(Araw);
        out.setOutput("✅ Loaded text → grid", "ok");
      } catch (e) {
        out.setOutput(`Text → grid failed: ${e.message}`, "bad");
      }
    };

    root.querySelector(`#${idPrefix}_gridToText`).onclick = () => {
      try {
        const A = readGrid();
        text.value = format.matrix(A);
        out.setOutput("✅ Exported grid → text", "ok");
      } catch (e) {
        out.setOutput(`Grid → text failed: ${e.message}`, "bad");
      }
    };

    buildGrid(r, c);
    return { readGrid, writeGrid, getText: () => text.value, setText: (v) => (text.value = v), root };
  }

  /* =========================================================
     Tab System
  ========================================================= */
  const TABS = [
    { id: "equations", label: "Linear Equations", build: buildEquations },
    { id: "matops", label: "Matrix Ops", build: buildMatrixOps },
    { id: "vectors", label: "Vectors & Spaces", build: buildVectors },
    { id: "eigen", label: "Eigen", build: buildEigen },
    { id: "transform", label: "Linear Transform", build: buildTransform },
  ];

  function setActiveTab(id) {
    DOM.selectAll(".tabBtn").forEach((b) => {
      b.classList.toggle("active", b.dataset.id === id);
    });
    const tab = TABS.find((t) => t.id === id);
    $("#panelTitle").textContent = tab.label;
    $("#panelBody").innerHTML = "";
    $("#plot").style.display = "none";
    tab.build($("#panelBody"));
    out.setOutput(`Opened: ${tab.label}`, "ok");
  }

  (function initTabs() {
    const tabs = $("#tabs");
    TABS.forEach((t) => {
      const b = DOM.create("div");
      b.className = "tabBtn";
      b.textContent = t.label;
      b.dataset.id = t.id;
      b.onclick = () => setActiveTab(t.id);
      tabs.appendChild(b);
    });
    setActiveTab("equations");
  })();

  /* =========================================================
     Tab Builders
  ========================================================= */
  let eqAEditor, eqbEditor, AEditor, BEditor, VS_Editor, E_Editor, T2_Editor, T4_Editor;

  function buildEquations(root) {
    root.innerHTML = `
      <div class="grid2">
        <div class="card" style="box-shadow:none; border:none; background:transparent;">
          <div class="pad" style="padding:0;">
            <div id="eqA"></div>
            <div class="divider"></div>
            <div class="sectionTitle">Vector b</div>
            <div id="eqb"></div>
            <div class="divider"></div>
            <div class="row">
              <button class="primary" id="btnSolveGauss">Solve (Gauss)</button>
              <button class="primary" id="btnSolveGJ">Solve (Gauss-Jordan)</button>
              <button id="btnShowRREFAug">Show RREF</button>
              <button id="btnCramer">Cramer's Rule</button>
            </div>
          </div>
        </div>
        <div>
          <div class="sectionTitle">How to use</div>
          <div class="hint">Solve <b>A x = b</b> using three methods. Try expressions like <span class="mono">1/2</span> or <span class="mono">sqrt(2)</span>.</div>
        </div>
      </div>
    `;

    eqAEditor = createMatrixEditor(root.querySelector("#eqA"), "eqA", 3, 3, "Matrix A");
    eqbEditor = createMatrixEditor(root.querySelector("#eqb"), "eqb", 3, 1, "b");

    $("#btnSolveGauss").onclick = () => {
      try {
        const A = eqAEditor.readGrid();
        const b = eqbEditor.readGrid().map((r) => r[0]);
        if (A.length !== b.length) throw new Error("Dimension mismatch: rows of A must equal length of b.");

        const res = MatrixAlgebra.gaussEliminationSteps(A, b);
        out.setOutput("Gauss Elimination with Back Substitution", "ok");
        out.append(res.steps.join("\n\n"));
        out.append("\n---\nResult:");

        if (res.status === "inconsistent") {
          out.append("❌ System is inconsistent (no solution)");
        } else if (!res.solution) {
          out.append("⚠️ Infinitely many solutions (free variables)");
        } else {
          out.append(`✅ Solution: x = [${res.solution.map(format.value).join(", ")}]ᵀ`);
        }
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnSolveGJ").onclick = () => {
      try {
        const A = eqAEditor.readGrid();
        const b = eqbEditor.readGrid().map((r) => r[0]);
        if (A.length !== b.length) throw new Error("Dimension mismatch.");

        const Aug = A.map((row, i) => row.concat([b[i]]));
        const { RREF, steps } = MatrixAlgebra.rrefWithSteps(Aug);
        out.setOutput("Gauss-Jordan (RREF) Method", "ok");
        out.append(steps.join("\n\n"));
        out.append("\n---\nFinal RREF:\n" + format.matrix(RREF));

        const n = A[0].length;
        let inconsistent = false;
        for (const row of RREF) {
          const left = row.slice(0, n);
          if (left.every((v) => math.equal(v, 0)) && !math.equal(row[n], 0)) {
            inconsistent = true;
          }
        }

        if (inconsistent) {
          out.append("\n❌ Inconsistent: no solution");
        } else if (A.length === n) {
          const detA = math.det(math.matrix(A));
          if (!math.equal(detA, 0)) {
            const x = math.lusolve(math.matrix(A), math.matrix(b));
            out.append(`\n✅ Unique solution: x = [${x.toArray().map(format.value).join(", ")}]ᵀ`);
          }
        }
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnShowRREFAug").onclick = () => {
      try {
        const A = eqAEditor.readGrid();
        const b = eqbEditor.readGrid().map((r) => r[0]);
        const Aug = A.map((row, i) => row.concat([b[i]]));
        const { RREF } = MatrixAlgebra.rrefWithSteps(Aug);
        out.setOutput(`RREF([A|b]):\n${format.matrix(RREF)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnCramer").onclick = () => {
      try {
        const A = eqAEditor.readGrid();
        const b = eqbEditor.readGrid().map((r) => r[0]);

        if (!matrixUtils.isSquare(A)) throw new Error("Cramer's Rule requires square A.");
        if (A.length !== b.length) throw new Error("Dimension mismatch.");

        const detA = math.det(math.matrix(A));
        out.setOutput(`Cramer's Rule: det(A) = ${format.value(detA)}`, "ok");

        if (math.equal(detA, 0)) {
          out.append("❌ det(A) = 0: no unique solution");
        } else {
          const n = A.length;
          const x = [];
          for (let j = 0; j < n; j++) {
            const Aj = A.map((row, i) => row.map((v, k) => (k === j ? b[i] : v)));
            const detAj = math.det(math.matrix(Aj));
            x[j] = math.divide(detAj, detA);
            out.append(`det(A${j + 1}) = ${format.value(detAj)}  ⟹  x${j + 1} = ${format.value(x[j])}`);
          }
          out.append(`\n✅ Solution: x = [${x.map(format.value).join(", ")}]ᵀ`);
        }
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };
  }

  function buildMatrixOps(root) {
    root.innerHTML = `
      <div class="grid2">
        <div>
          <div id="mA"></div>
          <div class="divider"></div>
          <div id="mB"></div>
        </div>
        <div>
          <div class="sectionTitle">Operations</div>
          <div class="row">
            <button class="primary" id="btnTranspose">Transpose(A)</button>
            <button class="primary" id="btnDet">det(A)</button>
            <button class="primary" id="btnInv">inv(A)</button>
            <button class="primary" id="btnRREF_A">RREF(A)</button>
            <button id="btnRankA">rank(A)</button>
          </div>
          <div class="divider"></div>
          <div class="sectionTitle">Multiplication</div>
          <div class="row">
            <button class="primary" id="btnAxB">A × B</button>
            <button class="primary" id="btnBxA">B × A</button>
          </div>
          <div class="divider"></div>
          <div class="sectionTitle">Extra</div>
          <div class="row">
            <button id="btnATimesScalar">k·A</button>
            <input type="text" id="scalarK" placeholder="k (e.g. 2, -1/3)" style="width:220px">
            <button id="btnTrace">trace(A)</button>
          </div>
        </div>
      </div>
    `;

    AEditor = createMatrixEditor(root.querySelector("#mA"), "mAed", 3, 3, "Matrix A");
    BEditor = createMatrixEditor(root.querySelector("#mB"), "mBed", 3, 3, "Matrix B");

    $("#btnTranspose").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const AT = math.transpose(math.matrix(A)).toArray();
        out.setOutput(`Transpose(A):\n${format.matrix(AT)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnDet").onclick = () => {
      try {
        const A = AEditor.readGrid();
        if (!matrixUtils.isSquare(A)) throw new Error("det() requires square matrix.");
        const d = math.det(math.matrix(A));
        out.setOutput(`det(A) = ${format.value(d)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnInv").onclick = () => {
      try {
        const A = AEditor.readGrid();
        if (!matrixUtils.isSquare(A)) throw new Error("inv() requires square matrix.");
        const d = math.det(math.matrix(A));
        if (math.equal(d, 0)) throw new Error("❌ Singular matrix (det = 0): no inverse exists.");
        const invA = math.inv(math.matrix(A)).toArray();
        out.setOutput(`A⁻¹:\n${format.matrix(invA)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnRREF_A").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const { RREF, steps } = MatrixAlgebra.rrefWithSteps(A);
        out.setOutput("RREF(A)", "ok");
        out.append(steps.join("\n\n"));
        out.append("\n---\nFinal RREF:\n" + format.matrix(RREF));
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnRankA").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const r = MatrixAlgebra.rankOf(A);
        out.setOutput(`rank(A) = ${r}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnAxB").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const B = BEditor.readGrid();
        const prod = math.multiply(math.matrix(A), math.matrix(B)).toArray();
        out.setOutput(`A × B:\n${format.matrix(prod)}`, "ok");
      } catch (e) {
        out.setOutput(`Multiplication failed: ${e.message}`, "bad");
      }
    };

    $("#btnBxA").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const B = BEditor.readGrid();
        const prod = math.multiply(math.matrix(B), math.matrix(A)).toArray();
        out.setOutput(`B × A:\n${format.matrix(prod)}`, "ok");
      } catch (e) {
        out.setOutput(`Multiplication failed: ${e.message}`, "bad");
      }
    };

    $("#btnATimesScalar").onclick = () => {
      try {
        const A = AEditor.readGrid();
        const kStr = $("#scalarK").value.trim();
        if (!kStr) throw new Error("Enter scalar k first.");
        const k = matrixUtils.parseExpr(kStr);
        const outA = A.map((r) => r.map((v) => math.multiply(k, v)));
        out.setOutput(`${format.value(k)} · A:\n${format.matrix(outA)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnTrace").onclick = () => {
      try {
        const A = AEditor.readGrid();
        if (!matrixUtils.isSquare(A)) throw new Error("trace() requires square matrix.");
        let tr = 0;
        for (let i = 0; i < A.length; i++) {
          tr = math.add(tr, A[i][i]);
        }
        out.setOutput(`trace(A) = ${format.value(tr)}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };
  }

  function buildVectors(root) {
    root.innerHTML = `
      <div class="grid2">
        <div>
          <div id="vsMat"></div>
          <div class="divider"></div>
          <div class="sectionTitle">Vector Interpretation</div>
          <div class="hint">
            Put vectors as columns. Then check span, independence, null space, and row space.
          </div>
        </div>
        <div>
          <div class="sectionTitle">Actions</div>
          <div class="row">
            <button class="primary" id="btnSpanRank">Rank/Dimension</button>
            <button class="primary" id="btnIndepCols">Column Independence</button>
            <button class="primary" id="btnNull">Null Space Basis</button>
            <button class="primary" id="btnRowSpace">Row Space Basis</button>
            <button id="btnRREF_VS">RREF</button>
          </div>
          <div class="divider"></div>
          <div class="sectionTitle">Coordinates</div>
          <div class="row">
            <button class="primary" id="btnCoords">Find coordinates</button>
            <button id="btnSpanContains">Check v in span?</button>
          </div>
          <div class="row">
            <label>Target v</label>
            <input type="text" id="vecV" placeholder="e.g. 1,2,3" style="width:100%">
          </div>
        </div>
      </div>
    `;

    VS_Editor = createMatrixEditor(root.querySelector("#vsMat"), "vs", 3, 3, "Matrix A");

    $("#btnSpanRank").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const r = MatrixAlgebra.rankOf(A);
        out.setOutput(`rank(A) = ${r}\nDim(Col(A)) = ${r}\nDim(Row(A)) = ${r}`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnIndepCols").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const r = MatrixAlgebra.rankOf(A);
        const ncols = A[0].length;
        const indep = r === ncols;
        out.setOutput(
          `Columns: rank = ${r}, count = ${ncols}\n${indep ? "✅ LINEARLY INDEPENDENT" : "❌ LINEARLY DEPENDENT"}`,
          indep ? "ok" : "warn"
        );
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnNull").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const ns = MatrixAlgebra.nullSpaceBasis(A);
        out.setOutput(`Null Space N(A): ${ns.note}`, "ok");
        if (ns.basis.length === 0) {
          out.append("Basis: (empty) → only {0}");
        } else {
          out.append("Basis vectors:");
          ns.basis.forEach((v, i) => {
            out.append(`v${i + 1} = [${v.map(format.value).join(", ")}]ᵀ`);
          });
        }
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnRowSpace").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const basis = MatrixAlgebra.rowSpaceBasis(A);
        out.setOutput(`Row Space (RREF nonzero rows)`, "ok");
        basis.forEach((r, i) => {
          out.append(`r${i + 1}: [${r.map(format.value).join(", ")}]`);
        });
        out.append(`\nDim(Row(A)) = ${basis.length}`);
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnRREF_VS").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const { RREF, steps } = MatrixAlgebra.rrefWithSteps(A);
        out.setOutput("RREF(A)", "ok");
        out.append(steps.join("\n\n"));
        out.append("\n---\nFinal:\n" + format.matrix(RREF));
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    const parseVector = (text) => {
      const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
      if (parts.length === 0) throw new Error("Enter target vector v.");
      return parts.map((p) => matrixUtils.parseExpr(p));
    };

    $("#btnCoords").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const v = parseVector($("#vecV").value);
        if (A.length !== v.length) throw new Error("Vector length must match matrix rows.");
        const sol = math.lusolve(math.matrix(A), math.matrix(v));
        out.setOutput(`Coordinates c (solving A·c = v):\nc = [${sol.toArray().map(format.value).join(", ")}]ᵀ`, "ok");
      } catch (e) {
        out.setOutput(`Could not find unique coordinates: ${e.message}`, "warn");
      }
    };

    $("#btnSpanContains").onclick = () => {
      try {
        const A = VS_Editor.readGrid();
        const v = parseVector($("#vecV").value);
        if (A.length !== v.length) throw new Error("Vector length mismatch.");
        const Aug = A.map((row, i) => row.concat([v[i]]));
        const { RREF } = MatrixAlgebra.rrefWithSteps(Aug);

        let inconsistent = false;
        for (const row of RREF) {
          const left = row.slice(0, A[0].length);
          if (left.every((x) => math.equal(x, 0)) && !math.equal(row[A[0].length], 0)) {
            inconsistent = true;
          }
        }

        out.setOutput(inconsistent ? "❌ v is NOT in span" : "✅ v IS in span", inconsistent ? "warn" : "ok");
        out.append("\nRREF([A|v]):\n" + format.matrix(RREF));
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };
  }

  function buildEigen(root) {
    root.innerHTML = `
      <div class="grid2">
        <div>
          <div id="eMat"></div>
          <div class="divider"></div>
          <div class="hint">
            Eigenvalues/vectors satisfy <b>A v = λ v</b>. This tool uses <span class="mono">math.eigs</span> or 2×2 fallback.
          </div>
        </div>
        <div>
          <div class="sectionTitle">Compute</div>
          <div class="row">
            <button class="primary" id="btnEigen">Eigenvalues & Vectors</button>
            <button id="btnCharPoly2x2">Char Poly (2×2)</button>
          </div>
          <div class="divider"></div>
          <div class="hint mini">For 2×2: p(λ) = λ² − (trace)λ + det</div>
        </div>
      </div>
    `;

    E_Editor = createMatrixEditor(root.querySelector("#eMat"), "eig", 2, 2, "Matrix A");

    $("#btnEigen").onclick = () => {
      try {
        const A = E_Editor.readGrid();
        const res = MatrixAlgebra.eigenSolve(A);
        out.setOutput(`Eigenvalues (${res.mode})`, "ok");
        out.append("Values:");
        res.values.forEach((v, i) => {
          out.append(`λ${i + 1} = ${format.value(v)}`);
        });
        out.append("\nVectors:");
        if (res.mode === "mathjs") {
          const V = res.vectors.toArray();
          out.append("V (columns are eigenvectors):\n" + format.matrix(V));
        } else {
          res.vectors.forEach((v, i) => {
            out.append(`v${i + 1} = [${v.map(format.value).join(", ")}]ᵀ`);
          });
        }
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnCharPoly2x2").onclick = () => {
      try {
        const A = E_Editor.readGrid();
        if (A.length !== 2 || A[0].length !== 2) throw new Error("Characteristic polynomial: 2×2 only.");
        const tr = math.add(A[0][0], A[1][1]);
        const det = math.subtract(math.multiply(A[0][0], A[1][1]), math.multiply(A[0][1], A[1][0]));
        out.setOutput(`Characteristic Polynomial (2×2)`, "ok");
        out.append(`trace(A) = ${format.value(tr)}`);
        out.append(`det(A) = ${format.value(det)}`);
        out.append(`p(λ) = λ² − (${format.value(tr)})·λ + (${format.value(det)})`);
        out.flush();
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };
  }

  function buildTransform(root) {
    root.innerHTML = `
      <div class="grid2">
        <div>
          <div class="sectionTitle">2D Transformation</div>
          <div class="hint mini">Enter 2×2 matrix, plot point clouds before/after A·v.</div>
          <div id="t2"></div>
          <div class="row" style="margin-top:12px;">
            <button class="primary" id="btnPlot2D">Plot 2D</button>
            <button id="btnApply2D">Apply to v</button>
            <input type="text" id="vec2" placeholder="(x,y) e.g. 1,2" style="width:180px">
          </div>
        </div>
        <div>
          <div class="sectionTitle">4D Transformation</div>
          <div class="hint mini">4D projections (XY and ZW planes with w=0).</div>
          <div id="t4"></div>
          <div class="row" style="margin-top:12px;">
            <button class="primary" id="btnPlot4D">Plot 4D</button>
            <button id="btnApply4D">Apply to v</button>
            <input type="text" id="vec4" placeholder="(x,y,z,w) e.g. 1,0,2,0" style="width:220px">
          </div>
        </div>
      </div>
    `;

    T2_Editor = createMatrixEditor(root.querySelector("#t2"), "t2ed", 2, 2, "A (2×2)");
    T4_Editor = createMatrixEditor(root.querySelector("#t4"), "t4ed", 4, 4, "A (4×4)");

    const parseVec = (text) => {
      const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
      return parts.map((p) => matrixUtils.parseExpr(p));
    };

    $("#btnPlot2D").onclick = () => {
      try {
        const A = T2_Editor.readGrid();
        if (A.length !== 2 || A[0].length !== 2) throw new Error("Need 2×2.");
        out.setOutput("Plotted 2D transformation", "ok");
        plot2DTransform(A);
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnApply2D").onclick = () => {
      try {
        const A = T2_Editor.readGrid();
        if (A.length !== 2 || A[0].length !== 2) throw new Error("Need 2×2.");
        const v = parseVec($("#vec2").value);
        if (v.length !== 2) throw new Error("Enter 2 values (x,y).");
        const res = math.multiply(math.matrix(A), math.matrix(v)).toArray();
        out.setOutput(`A·v = [${res.map(format.value).join(", ")}]ᵀ`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnPlot4D").onclick = () => {
      try {
        const A = T4_Editor.readGrid();
        if (A.length !== 4 || A[0].length !== 4) throw new Error("Need 4×4.");
        out.setOutput("Plotted 4D projections (XY and ZW)", "ok");
        plot4DTransformProjections(A);
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };

    $("#btnApply4D").onclick = () => {
      try {
        const A = T4_Editor.readGrid();
        if (A.length !== 4 || A[0].length !== 4) throw new Error("Need 4×4.");
        const v = parseVec($("#vec4").value);
        if (v.length !== 4) throw new Error("Enter 4 values (x,y,z,w).");
        const res = math.multiply(math.matrix(A), math.matrix(v)).toArray();
        out.setOutput(`A·v = [${res.map(format.value).join(", ")}]ᵀ`, "ok");
      } catch (e) {
        out.setOutput(e.message, "bad");
      }
    };
  }

  /* =========================================================
     Quick Examples
  ========================================================= */
  $("#btnExample2x2").onclick = () => {
    setActiveTab("equations");
    eqAEditor.writeGrid([
      ["2", "1", "-1"],
      ["-3", "-1", "2"],
      ["-2", "1", "2"],
    ]);
    eqbEditor.writeGrid([["8"], ["-11"], ["-3"]]);
    out.setOutput("Loaded 3×3 system example", "ok");
  };

  $("#btnExample3x3").onclick = () => {
    setActiveTab("matops");
    AEditor.writeGrid([
      ["1", "2", "3"],
      ["0", "1", "4"],
      ["5", "6", "0"],
    ]);
    BEditor.writeGrid([
      ["-2", "1", "0"],
      ["3", "0", "1"],
      ["4", "1", "2"],
    ]);
    out.setOutput("Loaded matrix operations examples", "ok");
  };

  $("#btnExampleEigen").onclick = () => {
    setActiveTab("eigen");
    E_Editor.writeGrid([
      ["4", "2"],
      ["1", "3"],
    ]);
    out.setOutput("Loaded 2×2 eigenvalue example", "ok");
  };

  $("#btnExampleT4").onclick = () => {
    setActiveTab("transform");
    T4_Editor.writeGrid([
      ["0", "-1", "0", "0"],
      ["1", "0", "0", "0"],
      ["0", "0", "2", "0"],
      ["0", "0", "0", "0.5"],
    ]);
    T2_Editor.writeGrid([
      ["1", "1"],
      ["0", "1"],
    ]);
    out.setOutput("Loaded transformation examples", "ok");
  };

  $("#btnClearAll").onclick = () => {
    $("#plot").style.display = "none";
    out.setOutput("Output cleared. Matrices preserved.", "ok");
  };
});
