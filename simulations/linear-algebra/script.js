/**
 * Linear Algebra Simulator - Professional Engineering Tool
 * Rebuild with robust math engine, step-by-step solutions, and professional UX
 */

document.addEventListener("DOMContentLoaded", () => {
  // =========================================================
  //  STATE MANAGEMENT - Centralized Application State
  // =========================================================
  const AppState = (() => {
    let state = {
      matrices: {
        A: null,
        B: null,
        b: null,
      },
      selectedTab: "equations",
      results: [],
      stepSolution: null,
    };

    return {
      getState: () => ({ ...state }),
      setMatrix: (name, matrix) => {
        state.matrices[name] = matrix;
      },
      getMatrix: (name) => state.matrices[name],
      setTab: (tab) => {
        state.selectedTab = tab;
      },
      addResult: (result) => {
        state.results.push(result);
      },
      clearResults: () => {
        state.results = [];
      },
      setStepSolution: (solution) => {
        state.stepSolution = solution;
      },
    };
  })();

  // =========================================================
  //  MATH ENGINE - Core Linear Algebra Operations
  // =========================================================
  const MathEngine = {
    /**
     * Validate matrix dimensions and values
     */
    validateMatrix: (matrix, context = "") => {
      if (!Array.isArray(matrix) || matrix.length === 0) {
        throw new Error(`${context}: Invalid matrix (empty or not an array)`);
      }
      const cols = matrix[0].length;
      if (!matrix.every((row) => Array.isArray(row) && row.length === cols)) {
        throw new Error(`${context}: Inconsistent row lengths`);
      }
      if (!matrix.every((row) => row.every((val) => typeof val === "number" || val === 0))) {
        throw new Error(`${context}: Non-numeric values detected`);
      }
      return true;
    },

    /**
     * Clone a matrix deeply
     */
    clone: (matrix) => matrix.map((row) => [...row]),

    /**
     * Get matrix dimensions
     */
    dims: (matrix) => ({
      rows: matrix.length,
      cols: matrix[0].length,
    }),

    /**
     * Matrix Addition: A + B
     */
    add: (A, B) => {
      MathEngine.validateMatrix(A, "Matrix A (addition)");
      MathEngine.validateMatrix(B, "Matrix B (addition)");

      const dimA = MathEngine.dims(A);
      const dimB = MathEngine.dims(B);

      if (dimA.rows !== dimB.rows || dimA.cols !== dimB.cols) {
        throw new Error(
          `Dimension mismatch: A is ${dimA.rows}×${dimA.cols}, B is ${dimB.rows}×${dimB.cols}`
        );
      }

      return A.map((row, i) => row.map((val, j) => val + B[i][j]));
    },

    /**
     * Matrix Subtraction: A - B
     */
    subtract: (A, B) => {
      MathEngine.validateMatrix(A, "Matrix A (subtraction)");
      MathEngine.validateMatrix(B, "Matrix B (subtraction)");

      const dimA = MathEngine.dims(A);
      const dimB = MathEngine.dims(B);

      if (dimA.rows !== dimB.rows || dimA.cols !== dimB.cols) {
        throw new Error(
          `Dimension mismatch: A is ${dimA.rows}×${dimA.cols}, B is ${dimB.rows}×${dimB.cols}`
        );
      }

      return A.map((row, i) => row.map((val, j) => val - B[i][j]));
    },

    /**
     * Scalar Multiplication: k * A
     */
    scalarMult: (k, A) => {
      MathEngine.validateMatrix(A, "Matrix A (scalar mult)");
      return A.map((row) => row.map((val) => k * val));
    },

    /**
     * Matrix Multiplication: A × B
     */
    multiply: (A, B) => {
      MathEngine.validateMatrix(A, "Matrix A (multiplication)");
      MathEngine.validateMatrix(B, "Matrix B (multiplication)");

      const { cols: colsA } = MathEngine.dims(A);
      const { rows: rowsB, cols: colsB } = MathEngine.dims(B);

      if (colsA !== rowsB) {
        throw new Error(
          `Cannot multiply: A columns (${colsA}) ≠ B rows (${rowsB})`
        );
      }

      const result = [];
      for (let i = 0; i < A.length; i++) {
        result[i] = [];
        for (let j = 0; j < colsB; j++) {
          let sum = 0;
          for (let k = 0; k < colsA; k++) {
            sum += A[i][k] * B[k][j];
          }
          result[i][j] = MathEngine.round(sum);
        }
      }
      return result;
    },

    /**
     * Matrix Transpose: A^T
     */
    transpose: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (transpose)");
      const rows = A.length;
      const cols = A[0].length;
      const result = [];
      for (let j = 0; j < cols; j++) {
        result[j] = [];
        for (let i = 0; i < rows; i++) {
          result[j][i] = A[i][j];
        }
      }
      return result;
    },

    /**
     * Matrix Trace: sum of diagonal elements
     */
    trace: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (trace)");
      const { rows, cols } = MathEngine.dims(A);
      if (rows !== cols) {
        throw new Error(`Trace requires square matrix, got ${rows}×${cols}`);
      }
      return A.reduce((sum, row, i) => sum + row[i], 0);
    },

    /**
     * Determinant (2×2 and 3×3 with Laplace expansion for larger)
     */
    determinant: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (determinant)");
      const { rows, cols } = MathEngine.dims(A);

      if (rows !== cols) {
        throw new Error(
          `Determinant requires square matrix, got ${rows}×${cols}`
        );
      }

      if (rows === 1) return A[0][0];
      if (rows === 2) {
        return A[0][0] * A[1][1] - A[0][1] * A[1][0];
      }
      if (rows === 3) {
        return (
          A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
          A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
          A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])
        );
      }

      // Laplace expansion along first row (for larger matrices)
      let det = 0;
      for (let j = 0; j < cols; j++) {
        const minor = MathEngine._getMinor(A, 0, j);
        const cofactor = Math.pow(-1, j) * MathEngine.determinant(minor);
        det += A[0][j] * cofactor;
      }
      return MathEngine.round(det);
    },

    /**
     * Get minor matrix (for determinant calculation)
     */
    _getMinor: (A, row, col) => {
      return A.filter((_, i) => i !== row).map((r) =>
        r.filter((_, j) => j !== col)
      );
    },

    /**
     * Matrix Inverse: A^(-1) using Gauss-Jordan elimination
     */
    inverse: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (inverse)");
      const { rows, cols } = MathEngine.dims(A);

      if (rows !== cols) {
        throw new Error(
          `Inverse requires square matrix, got ${rows}×${cols}`
        );
      }

      const det = MathEngine.determinant(A);
      if (Math.abs(det) < 1e-10) {
        throw new Error(
          `Matrix is singular (det ≈ 0), inverse does not exist`
        );
      }

      // Augment [A | I]
      const n = rows;
      const aug = A.map((row, i) => {
        const identity = Array(n).fill(0);
        identity[i] = 1;
        return [...row, ...identity];
      });

      // Gauss-Jordan elimination
      for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
            maxRow = k;
          }
        }

        // Swap rows
        [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

        // Scale pivot row
        const pivot = aug[i][i];
        if (Math.abs(pivot) < 1e-10) {
          throw new Error(`Singular matrix encountered during inversion`);
        }

        for (let j = 0; j < 2 * n; j++) {
          aug[i][j] /= pivot;
        }

        // Eliminate column
        for (let k = 0; k < n; k++) {
          if (k !== i) {
            const factor = aug[k][i];
            for (let j = 0; j < 2 * n; j++) {
              aug[k][j] -= factor * aug[i][j];
            }
          }
        }
      }

      // Extract inverse from right half
      return aug.map((row) => row.slice(n).map((val) => MathEngine.round(val)));
    },

    /**
     * Gaussian Elimination with Partial Pivoting for solving Ax = b
     */
    gaussianElimination: (A, b) => {
      MathEngine.validateMatrix(A, "Matrix A");
      if (!Array.isArray(b) || !b.every((v) => typeof v === "number")) {
        throw new Error("Vector b must be array of numbers");
      }

      const { rows, cols } = MathEngine.dims(A);
      if (rows !== b.length) {
        throw new Error(
          `Dimension mismatch: A has ${rows} rows, b has ${b.length} elements`
        );
      }

      // Create augmented matrix [A | b]
      const aug = A.map((row, i) => [...row, b[i]]);
      const n = rows;
      const steps = { forward: [], backward: [], solution: null };

      // ===== FORWARD ELIMINATION =====
      for (let i = 0; i < n; i++) {
        // Find pivot by partial pivoting
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
            maxRow = k;
          }
        }

        // Swap rows if needed
        if (maxRow !== i) {
          [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
        }

        // Check for singular matrix
        if (Math.abs(aug[i][i]) < 1e-10) {
          throw new Error(
            `Singular matrix at step ${i + 1}: coefficient is zero`
          );
        }

        // Eliminate below
        for (let k = i + 1; k < n; k++) {
          const factor = aug[k][i] / aug[i][i];
          for (let j = i; j <= n; j++) {
            aug[k][j] -= factor * aug[i][j];
          }
        }
      }

      // ===== BACK SUBSTITUTION =====
      const x = Array(n);
      for (let i = n - 1; i >= 0; i--) {
        let sum = aug[i][n];
        for (let j = i + 1; j < n; j++) {
          sum -= aug[i][j] * x[j];
        }
        x[i] = sum / aug[i][i];
      }

      return {
        solution: x.map((v) => MathEngine.round(v)),
        augmented: aug,
      };
    },

    /**
     * RREF (Reduced Row Echelon Form) for rank and null space
     */
    rref: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (RREF)");
      const M = MathEngine.clone(A);
      const rows = M.length;
      const cols = M[0].length;

      let lead = 0;
      for (let r = 0; r < rows; r++) {
        if (lead >= cols) return M;

        let i = r;
        while (Math.abs(M[i][lead]) < 1e-10) {
          i++;
          if (i === rows) {
            i = r;
            lead++;
            if (lead === cols) return M;
          }
        }

        [M[i], M[r]] = [M[r], M[i]];

        const div = M[r][lead];
        for (let j = 0; j < cols; j++) {
          M[r][j] /= div;
        }

        for (let i = 0; i < rows; i++) {
          if (i !== r) {
            const mult = M[i][lead];
            for (let j = 0; j < cols; j++) {
              M[i][j] -= mult * M[r][j];
            }
          }
        }
        lead++;
      }

      return M;
    },

    /**
     * Calculate matrix rank
     */
    rank: (A) => {
      MathEngine.validateMatrix(A, "Matrix A (rank)");
      const rrefMatrix = MathEngine.rref(A);
      let rank = 0;
      for (const row of rrefMatrix) {
        if (!row.every((v) => Math.abs(v) < 1e-10)) {
          rank++;
        }
      }
      return rank;
    },

    /**
     * Utility: round to 10 decimal places
     */
    round: (val) => {
      return Math.abs(val) < 1e-10 ? 0 : Math.round(val * 1e10) / 1e10;
    },
  };

  // =========================================================
  //  LATEX FORMATTER - Output Rendering
  // =========================================================
  const LatexFormatter = {
    /**
     * Format matrix as LaTeX
     */
    matrix: (M, inline = false) => {
      if (!M || M.length === 0) return "\\text{empty}";
      const rows = M.map((row) =>
        row
          .map((v) => {
            const str = typeof v === "number" ? v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(v);
            return str;
          })
          .join(" & ")
      ).join(" \\\\ ");
      return inline ? `\\begin{bmatrix} ${rows} \\end{bmatrix}` : `\\[\\begin{bmatrix} ${rows} \\end{bmatrix}\\]`;
    },

    /**
     * Format vector as LaTeX
     */
    vector: (v) => {
      if (!Array.isArray(v)) return "\\text{invalid}";
      const elements = v
        .map((x) => {
          const str = typeof x === "number" ? x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(x);
          return str;
        })
        .join(" \\\\ ");
      return `\\begin{bmatrix} ${elements} \\end{bmatrix}`;
    },

    /**
     * Format equation
     */
    equation: (left, right) => {
      return `\\[${left} = ${right}\\]`;
    },

    /**
     * Format scalar result
     */
    scalar: (value) => {
      const str = typeof value === "number" ? value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : String(value);
      return `\\[${str}\\]`;
    },
  };

  // =========================================================
  //  UI CONTROLLER - Manage DOM and Interactions
  // =========================================================
  const UIController = (() => {
    const DOM = {
      select: (sel) => document.querySelector(sel),
      selectAll: (sel) => document.querySelectorAll(sel),
      create: (tag) => document.createElement(tag),
    };

    return {
      /**
       * Display result with LaTeX rendering
       */
      showResult: (title, latexContent, html = "") => {
        const output = DOM.select("#output");
        const resultHTML = `
          <div class="result-block">
            <div class="result-title">${title}</div>
            <div class="result-latex">${latexContent}</div>
            ${html ? `<div class="result-extra">${html}</div>` : ""}
          </div>
        `;
        output.innerHTML += resultHTML;
        output.scrollTop = output.scrollHeight;

        // Render LaTeX if KaTeX is available
        if (window.katex && window.katex.render) {
          const latexBlocks = output.querySelectorAll(".result-latex");
          latexBlocks.forEach((block) => {
            try {
              window.katex.render(block.textContent, block, { throwOnError: false });
            } catch (e) {
              console.warn("KaTeX render error:", e);
            }
          });
        }
      },

      /**
       * Clear output panel
       */
      clearOutput: () => {
        const output = DOM.select("#output");
        output.innerHTML = "";
      },

      /**
       * Show error message
       */
      showError: (message) => {
        const output = DOM.select("#output");
        const errorHTML = `<div class="error-message">❌ ${message}</div>`;
        output.innerHTML = errorHTML;
      },

      /**
       * Read matrix from grid
       */
      readMatrixGrid: (gridId) => {
        const grid = DOM.select(`#${gridId}`);
        const inputs = grid.querySelectorAll("input");
        const cols = parseInt(grid.style.gridTemplateColumns?.match(/\d+/)?.[0]) || 3;

        const matrix = [];
        for (let i = 0; i < inputs.length; i += cols) {
          const row = Array.from(inputs.slice(i, i + cols)).map((inp) => {
            const val = parseFloat(inp.value);
            if (isNaN(val)) throw new Error(`Non-numeric value: ${inp.value}`);
            return val;
          });
          matrix.push(row);
        }
        return matrix;
      },

      /**
       * Write matrix to grid
       */
      writeMatrixGrid: (gridId, matrix, cols = null) => {
        const grid = DOM.select(`#${gridId}`);
        if (!matrix) return;

        cols = cols || matrix[0].length;
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        grid.innerHTML = "";

        for (const row of matrix) {
          for (const val of row) {
            const inp = DOM.create("input");
            inp.type = "number";
            inp.className = "cell";
            inp.value = typeof val === "number" ? val.toFixed(2) : val;
            grid.appendChild(inp);
          }
        }
      },

      /**
       * Create matrix editor UI
       */
      createMatrixEditor: (container, idPrefix, rows = 3, cols = 3, label = "Matrix") => {
        const wrapper = DOM.create("div");
        wrapper.className = "matrix-editor";
        wrapper.innerHTML = `
          <div class="matrix-header">
            <h3>${label}</h3>
            <div class="matrix-controls">
              <label>Rows: <input type="number" class="dim-input" min="1" max="10" value="${rows}" data-dim="rows" data-prefix="${idPrefix}"></label>
              <label>Cols: <input type="number" class="dim-input" min="1" max="10" value="${cols}" data-dim="cols" data-prefix="${idPrefix}"></label>
              <button class="resize-btn" data-prefix="${idPrefix}">Resize</button>
            </div>
          </div>
          <div class="matrix-grid" id="${idPrefix}_grid"></div>
        `;

        container.appendChild(wrapper);

        // Initialize grid
        UIController.buildMatrixGrid(idPrefix, rows, cols);

        // Resize handler
        wrapper.querySelector(".resize-btn").onclick = () => {
          const newRows = parseInt(wrapper.querySelector(`[data-dim="rows"]`).value);
          const newCols = parseInt(wrapper.querySelector(`[data-dim="cols"]`).value);
          UIController.buildMatrixGrid(idPrefix, newRows, newCols);
        };

        return { readGrid: () => UIController.readMatrixGrid(`${idPrefix}_grid`) };
      },

      /**
       * Build matrix grid
       */
      buildMatrixGrid: (idPrefix, rows, cols) => {
        const grid = DOM.select(`#${idPrefix}_grid`);
        grid.innerHTML = "";
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        for (let i = 0; i < rows * cols; i++) {
          const inp = DOM.create("input");
          inp.type = "number";
          inp.className = "cell";
          inp.placeholder = "0";
          inp.value = "0";
          grid.appendChild(inp);
        }
      },
    };
  })();

  // =========================================================
  //  TAB BUILDERS - Each operation module
  // =========================================================

  /**
   * Linear Equations Solver
   */
  function buildEquations(root) {
    UIController.clearOutput();

    root.innerHTML = `
      <div class="operations-panel">
        <div class="operation-section">
          <h3>Solve Linear System Ax = b</h3>
          <div id="eq-a-editor"></div>
          <div id="eq-b-editor"></div>
          <div class="button-group">
            <button class="btn-primary" onclick="window.solveSysGauss()">Solve (Gaussian Elimination)</button>
            <button class="btn-secondary" onclick="window.solveViaCramer()">Solve (Cramer's Rule)</button>
          </div>
        </div>
      </div>
    `;

    const aEditor = UIController.createMatrixEditor(root.querySelector("#eq-a-editor"), "eqA", 3, 3, "Matrix A");
    const bEditor = UIController.createMatrixEditor(root.querySelector("#eq-b-editor"), "eqb", 3, 1, "Vector b");

    window.solveSysGauss = () => {
      try {
        const A = UIController.readMatrixGrid("eqA_grid");
        const b = UIController.readMatrixGrid("eqb_grid").map((row) => row[0]);

        const result = MathEngine.gaussianElimination(A, b);
        UIController.clearOutput();
        UIController.showResult(
          "Solution via Gaussian Elimination",
          LatexFormatter.vector(result.solution),
          `<p><strong>System:</strong> ${A.length} equations, ${A[0].length} variables</p>`
        );
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.solveViaCramer = () => {
      try {
        const A = UIController.readMatrixGrid("eqA_grid");
        const b = UIController.readMatrixGrid("eqb_grid").map((row) => row[0]);
        const { rows, cols } = MathEngine.dims(A);

        if (rows !== cols) {
          throw new Error("Cramer's rule requires square matrix");
        }

        const detA = MathEngine.determinant(A);
        if (Math.abs(detA) < 1e-10) {
          throw new Error("Determinant is zero: Cramer's rule not applicable");
        }

        UIController.clearOutput();
        UIController.showResult("Determinant of A", LatexFormatter.scalar(detA));

        const solutions = [];
        for (let i = 0; i < cols; i++) {
          const Ai = A.map((row, ri) => row.map((val, cj) => (cj === i ? b[ri] : val)));
          const detAi = MathEngine.determinant(Ai);
          solutions.push(detAi / detA);
        }

        UIController.showResult("Solution via Cramer's Rule", LatexFormatter.vector(solutions));
      } catch (e) {
        UIController.showError(e.message);
      }
    };
  }

  /**
   * Matrix Operations
   */
  function buildMatrixOps(root) {
    UIController.clearOutput();

    root.innerHTML = `
      <div class="operations-panel">
        <div class="operation-section">
          <h3>Matrix Operations</h3>
          <div id="mop-a-editor"></div>
          <div id="mop-b-editor"></div>
          <div class="button-group">
            <button class="btn-primary" onclick="window.opTranspose()">A<sup>T</sup> (Transpose)</button>
            <button class="btn-primary" onclick="window.opAdd()">A + B</button>
            <button class="btn-primary" onclick="window.opSubtract()">A - B</button>
            <button class="btn-primary" onclick="window.opMultiply()">A × B</button>
            <button class="btn-secondary" onclick="window.opDeterminant()">det(A)</button>
            <button class="btn-secondary" onclick="window.opTrace()">trace(A)</button>
            <button class="btn-secondary" onclick="window.opInverse()">A<sup>-1</sup></button>
            <button class="btn-secondary" onclick="window.opRank()">rank(A)</button>
          </div>
        </div>
      </div>
    `;

    const aEditor = UIController.createMatrixEditor(root.querySelector("#mop-a-editor"), "mopA", 3, 3, "Matrix A");
    const bEditor = UIController.createMatrixEditor(root.querySelector("#mop-b-editor"), "mopB", 3, 3, "Matrix B");

    window.opTranspose = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const AT = MathEngine.transpose(A);
        UIController.clearOutput();
        UIController.showResult("A<sup>T</sup> (Transpose)", LatexFormatter.matrix(AT));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opAdd = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const B = UIController.readMatrixGrid("mopB_grid");
        const C = MathEngine.add(A, B);
        UIController.clearOutput();
        UIController.showResult("A + B", LatexFormatter.matrix(C));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opSubtract = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const B = UIController.readMatrixGrid("mopB_grid");
        const C = MathEngine.subtract(A, B);
        UIController.clearOutput();
        UIController.showResult("A - B", LatexFormatter.matrix(C));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opMultiply = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const B = UIController.readMatrixGrid("mopB_grid");
        const C = MathEngine.multiply(A, B);
        UIController.clearOutput();
        UIController.showResult("A × B", LatexFormatter.matrix(C));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opDeterminant = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const det = MathEngine.determinant(A);
        UIController.clearOutput();
        UIController.showResult("det(A)", LatexFormatter.scalar(det));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opTrace = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const tr = MathEngine.trace(A);
        UIController.clearOutput();
        UIController.showResult("trace(A)", LatexFormatter.scalar(tr));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opInverse = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const Ainv = MathEngine.inverse(A);
        UIController.clearOutput();
        UIController.showResult("A<sup>-1</sup> (Inverse)", LatexFormatter.matrix(Ainv));
      } catch (e) {
        UIController.showError(e.message);
      }
    };

    window.opRank = () => {
      try {
        const A = UIController.readMatrixGrid("mopA_grid");
        const r = MathEngine.rank(A);
        UIController.clearOutput();
        UIController.showResult("rank(A)", LatexFormatter.scalar(r));
      } catch (e) {
        UIController.showError(e.message);
      }
    };
  }

  // =========================================================
  //  INITIALIZE APP
  // =========================================================

  function initApp() {
    const TABS = [
      { id: "equations", label: "Equations", build: buildEquations },
      { id: "matops", label: "Operations", build: buildMatrixOps },
    ];

    function setActiveTab(id) {
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === id);
      });

      const panelBody = document.querySelector("#panelBody");
      panelBody.innerHTML = "";

      const tab = TABS.find((t) => t.id === id);
      if (tab) {
        tab.build(panelBody);
      }
    }

    // Initialize tabs
    const tabsContainer = document.querySelector("#tabs");
    if (tabsContainer) {
      tabsContainer.innerHTML = TABS.map(
        (t) => `<button class="tab-btn ${t.id === "equations" ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
      ).join("");

      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.onclick = () => setActiveTab(btn.dataset.tab);
      });
    }

    setActiveTab("equations");
  }

  initApp();
});
