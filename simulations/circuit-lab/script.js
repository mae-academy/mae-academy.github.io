class CircuitApp {
  constructor() {
    this.canvas = document.getElementById('circuitCanvas');
    this.ctx = this.canvas.getContext('2d');
    
    this.oscCanvas = document.getElementById('oscCanvas');
    this.oscCtx = this.oscCanvas.getContext('2d');

    this.gridSize = 20;
    this.components = [];
    this.wires = [];
    this.currentTool = null;
    
    this.isDrawingWire = false;
    this.wireStart = null;
    
    this.selectedComponent = null;

    // Simulation Time
    this.time = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
    
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    
    // Start animation loop
    requestAnimationFrame(() => this.loop());
  }

  resize() {
    this.canvas.width = this.canvas.parentElement.clientWidth;
    this.canvas.height = this.canvas.parentElement.clientHeight;
    
    this.oscCanvas.width = this.oscCanvas.parentElement.clientWidth;
    this.oscCanvas.height = this.oscCanvas.parentElement.clientHeight - 30; // offset for title
  }

  setTool(tool) {
    this.currentTool = tool;
    console.log("Tool selected:", tool);
  }

  // Handle Canvas Clicks
  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    
    // Snap to grid
    const x = Math.round(rawX / this.gridSize) * this.gridSize;
    const y = Math.round(rawY / this.gridSize) * this.gridSize;

    if (this.currentTool === 'Wire') {
      if (!this.isDrawingWire) {
        this.isDrawingWire = true;
        this.wireStart = { x, y };
      } else {
        this.wires.push({ start: this.wireStart, end: { x, y } });
        this.isDrawingWire = false;
        this.wireStart = null;
      }
    } else if (['Resistor', 'Capacitor', 'Inductor', 'DC_Source', 'AC_Source'].includes(this.currentTool)) {
      this.components.push({
        type: this.currentTool,
        x: x,
        y: y,
        value: 10, // Default value
        rotation: 0
      });
      this.currentTool = null; // Reset tool after placement
    } else {
      // Check for component click to open properties
      const clicked = this.components.find(c => 
        Math.abs(c.x - x) < 30 && Math.abs(c.y - y) < 30
      );
      if (clicked) {
        this.openProperties(clicked);
      }
    }
  }

  // UI Modal Handling
  openProperties(comp) {
    this.selectedComponent = comp;
    document.getElementById('propertiesModal').style.display = 'block';
    document.getElementById('propTitle').innerText = `${comp.type} Properties`;
    
    let unit = "Ohms (Ω)";
    if (comp.type === 'Capacitor') unit = "Microfarads (μF)";
    if (comp.type === 'Inductor') unit = "Millihenrys (mH)";
    if (comp.type.includes('Source')) unit = "Volts (V)";
    
    document.getElementById('propLabel').innerText = `Value in ${unit}:`;
    document.getElementById('propInput').value = comp.value;
  }

  closeProperties() {
    document.getElementById('propertiesModal').style.display = 'none';
    this.selectedComponent = null;
  }

  saveProperties() {
    if (this.selectedComponent) {
      this.selectedComponent.value = parseFloat(document.getElementById('propInput').value);
    }
    this.closeProperties();
  }

  // --- Rendering Engine ---
  drawGrid() {
    this.ctx.strokeStyle = '#E5E5E5';
    this.ctx.lineWidth = 1;
    for (let x = 0; x < this.canvas.width; x += this.gridSize) {
      this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, this.canvas.height); this.ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += this.gridSize) {
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(this.canvas.width, y); this.ctx.stroke();
    }
  }

  drawComponent(c) {
    this.ctx.save();
    this.ctx.translate(c.x, c.y);
    this.ctx.rotate(c.rotation);
    this.ctx.strokeStyle = '#000';
    this.ctx.lineWidth = 2;
    this.ctx.fillStyle = '#fff';

    // Academic Textbook style drawing
    this.ctx.beginPath();
    if (c.type === 'Resistor') {
      this.ctx.moveTo(-20, 0); this.ctx.lineTo(-10, 0);
      this.ctx.lineTo(-5, -10); this.ctx.lineTo(5, 10); this.ctx.lineTo(10, 0);
      this.ctx.lineTo(20, 0);
    } else if (c.type === 'Capacitor') {
      this.ctx.moveTo(-20, 0); this.ctx.lineTo(-5, 0);
      this.ctx.moveTo(-5, -15); this.ctx.lineTo(-5, 15);
      this.ctx.moveTo(5, -15); this.ctx.lineTo(5, 15);
      this.ctx.moveTo(5, 0); this.ctx.lineTo(20, 0);
    } else if (c.type === 'DC_Source') {
      this.ctx.arc(0, 0, 15, 0, Math.PI * 2);
      this.ctx.moveTo(-20, 0); this.ctx.lineTo(-15, 0);
      this.ctx.moveTo(15, 0); this.ctx.lineTo(20, 0);
      this.ctx.fillText("+", -5, -5);
      this.ctx.fillText("-", -5, 12);
    } else {
      // Generic block for Inductors/AC for now
      this.ctx.rect(-15, -10, 30, 20);
      this.ctx.moveTo(-20, 0); this.ctx.lineTo(-15, 0);
      this.ctx.moveTo(15, 0); this.ctx.lineTo(20, 0);
    }
    this.ctx.stroke();

    // Value Label
    this.ctx.fillStyle = '#000';
    this.ctx.font = '14px "Cambria Math"';
    this.ctx.fillText(`${c.value}`, -10, -20);
    
    this.ctx.restore();
  }

  drawOscilloscope() {
    this.oscCtx.clearRect(0, 0, this.oscCanvas.width, this.oscCanvas.height);
    
    // Draw Grid
    this.oscCtx.strokeStyle = '#E5E5E5';
    this.oscCtx.lineWidth = 1;
    const midY = this.oscCanvas.height / 2;
    
    this.oscCtx.beginPath();
    this.oscCtx.moveTo(0, midY);
    this.oscCtx.lineTo(this.oscCanvas.width, midY);
    this.oscCtx.stroke();

    // Mock Simulation Data Stream based on components
    // (In a full build, this hooks into the MNA node voltages)
    let amplitude = 0;
    let freq = 0.05;
    
    const hasAC = this.components.find(c => c.type === 'AC_Source');
    const hasDC = this.components.find(c => c.type === 'DC_Source');
    
    if (hasAC) amplitude = hasAC.value;
    else if (hasDC) amplitude = hasDC.value;

    this.oscCtx.strokeStyle = '#000'; // Strict academic black trace
    this.oscCtx.lineWidth = 2;
    this.oscCtx.beginPath();
    
    for (let x = 0; x < this.oscCanvas.width; x++) {
      // Simulate signal: DC is flat, AC is sine
      let signal = hasAC ? Math.sin((x + this.time) * freq) : 1;
      let y = midY - (signal * amplitude * 2); 
      
      if (x === 0) this.oscCtx.moveTo(x, y);
      else this.oscCtx.lineTo(x, y);
    }
    this.oscCtx.stroke();
    
    // Update DMM reading dynamically
    if (hasAC || hasDC) {
      document.getElementById('dmmValue').innerText = (hasAC ? amplitude * 0.707 : amplitude).toFixed(2) + " V";
    }
  }

  loop() {
    this.time += 2; // Advance time for oscilloscope

    // Clear Canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawGrid();

    // Draw Wires
    this.ctx.strokeStyle = '#000';
    this.ctx.lineWidth = 2;
    this.wires.forEach(w => {
      this.ctx.beginPath();
      this.ctx.moveTo(w.start.x, w.start.y);
      this.ctx.lineTo(w.end.x, w.end.y);
      this.ctx.stroke();
    });

    // Draw active wire
    if (this.isDrawingWire && this.wireStart) {
      // We would normally track mouse position here, but omitted for brevity
    }

    // Draw Components
    this.components.forEach(c => this.drawComponent(c));

    // Update Instruments
    this.drawOscilloscope();

    requestAnimationFrame(() => this.loop());
  }
}

// Initialize application
const app = new CircuitApp();