document.addEventListener("DOMContentLoaded", () => {
  const workspace = document.getElementById('workspace');
  const svgCanvas = document.getElementById('wireCanvas');
  const propName = document.getElementById('propName');
  const propValue = document.getElementById('propValue');
  const propUnit = document.getElementById('propUnit');
  const configForm = document.getElementById('configForm');
  const noSelection = document.getElementById('noSelection');

  if (!workspace || !svgCanvas) return;

  let selectedComponentId = null;
  let isWiring = false;
  let activeWireLine = null;
  let startTerminalId = null;
  let isDragging = false;
  let draggedComp = null;
  let dragElement = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let wires = [];

  // Component Data updated with Icons and adjusted heights to fit them
  let componentsData = [
    { id: 'src1', icon: 'tabler:battery-4', name: 'DC Source 1', val: 12, unit: 'V', x: 40, y: 40, w: 120, h: 90, terminals: [{id: 't1', x: 20, y: 90, label: '+'}, {id: 't2', x: 100, y: 90, label: '-'}] },
    { id: 'src2', icon: 'tabler:wave-sine', name: 'Func Gen', val: 50, unit: 'Hz', x: 40, y: 160, w: 120, h: 90, terminals: [{id: 't3', x: 20, y: 90, label: '+'}, {id: 't4', x: 100, y: 90, label: '-'}] },
    { id: 'dmm', icon: 'tabler:gauge', name: 'Multimeter', val: 0.00, unit: 'V', x: 220, y: 40, w: 120, h: 90, terminals: [{id: 't5', x: 20, y: 90, label: 'V/Ω'}, {id: 't6', x: 100, y: 90, label: 'COM'}] },
    { id: 'osc', icon: 'tabler:activity', name: 'Oscilloscope', val: 0, unit: 'ms/div', x: 380, y: 40, w: 180, h: 100, terminals: [{id: 't7', x: 30, y: 100, label: 'CH1+'}, {id: 't8', x: 70, y: 100, label: 'CH1-'}, {id: 't9', x: 110, y: 100, label: 'CH2+'}, {id: 't10', x: 150, y: 100, label: 'CH2-'}] },
    
    // Passives - Height bumped to 75 to fit icons, Terminals Y shifted to 38 (center)
    { id: 'r1', icon: 'tabler:circuit-resistor', name: 'R1', val: 200, unit: 'Ω', x: 200, y: 220, w: 80, h: 75, terminals: [{id: 't11', x: -7, y: 38, label: ''}, {id: 't12', x: 80, y: 38, label: ''}] },
    { id: 'r2', icon: 'tabler:circuit-resistor', name: 'R2', val: 330, unit: 'Ω', x: 320, y: 220, w: 80, h: 75, terminals: [{id: 't13', x: -7, y: 38, label: ''}, {id: 't14', x: 80, y: 38, label: ''}] },
    { id: 'c1', icon: 'tabler:circuit-capacitor', name: 'C1', val: 20, unit: 'µF', x: 200, y: 320, w: 80, h: 75, terminals: [{id: 't15', x: -7, y: 38, label: ''}, {id: 't16', x: 80, y: 38, label: ''}] },
    { id: 'c2', icon: 'tabler:circuit-capacitor', name: 'C2', val: 47, unit: 'µF', x: 320, y: 320, w: 80, h: 75, terminals: [{id: 't17', x: -7, y: 38, label: ''}, {id: 't18', x: 80, y: 38, label: ''}] },
    { id: 'l1', icon: 'tabler:circuit-inductor', name: 'L1', val: 0.2, unit: 'mH', x: 200, y: 420, w: 80, h: 75, terminals: [{id: 't19', x: -7, y: 38, label: ''}, {id: 't20', x: 80, y: 38, label: ''}] },
    { id: 'l2', icon: 'tabler:circuit-inductor', name: 'L2', val: 1.0, unit: 'mH', x: 320, y: 420, w: 80, h: 75, terminals: [{id: 't21', x: -7, y: 38, label: ''}, {id: 't22', x: 80, y: 38, label: ''}] }
  ];

  function renderComponents() {
    Array.from(workspace.children).forEach(child => {
      if (child.id !== 'wireCanvas') child.remove();
    });

    componentsData.forEach(comp => {
      const el = document.createElement('div');
      el.className = `component ${selectedComponentId === comp.id ? 'selected' : ''}`;
      el.id = comp.id;
      el.style.left = comp.x + 'px'; 
      el.style.top = comp.y + 'px';
      el.style.width = comp.w + 'px'; 
      el.style.height = comp.h + 'px';

      // Added Iconify span injection here
      el.innerHTML = `
        <div class="comp-icon"><span class="iconify" data-icon="${comp.icon}"></span></div>
        <div class="comp-title">${comp.name}</div>
        <div class="comp-value">${comp.val} ${comp.unit}</div>
      `;

      comp.terminals.forEach(term => {
        const t = document.createElement('div');
        t.className = 'terminal';
        t.id = term.id;
        t.style.left = (term.x - 7) + 'px'; 
        t.style.top = (term.y - 7) + 'px';
        
        if(term.label) {
          const lbl = document.createElement('div');
          lbl.className = 'terminal-label';
          lbl.innerText = term.label;
          lbl.style.left = '-2px'; lbl.style.top = '-16px';
          t.appendChild(lbl);
        }

        t.addEventListener('mousedown', (e) => startWiring(e, term.id));
        t.addEventListener('mouseenter', () => t.classList.add('hovered'));
        t.addEventListener('mouseleave', () => t.classList.remove('hovered'));
        t.addEventListener('mouseup', (e) => finishWiring(e, term.id));
        el.appendChild(t);
      });

      el.addEventListener('mousedown', (e) => {
        if(e.target.classList.contains('terminal')) return;
        selectComponent(comp.id);
        isDragging = true; 
        draggedComp = comp;
        dragElement = el; 
        dragOffsetX = e.clientX - comp.x; 
        dragOffsetY = e.clientY - comp.y;
        el.style.zIndex = 100;
      });

      workspace.appendChild(el);
    });
  }

  function getTerminalCoords(id1, id2) {
    const t1 = document.getElementById(id1);
    const t2 = document.getElementById(id2);
    if(!t1 || !t2) return null;
    const rect1 = t1.getBoundingClientRect();
    const rect2 = t2.getBoundingClientRect();
    const wsRect = workspace.getBoundingClientRect();
    return {
      x1: rect1.left - wsRect.left + 7, y1: rect1.top - wsRect.top + 7,
      x2: rect2.left - wsRect.left + 7, y2: rect2.top - wsRect.top + 7
    };
  }

  function generatePath(x1, y1, x2, y2) {
    const dy = Math.abs(y2 - y1);
    const controlY = Math.max(y1, y2) + dy * 0.5 + 40; 
    return `M ${x1} ${y1} C ${x1} ${controlY}, ${x2} ${controlY}, ${x2} ${y2}`;
  }

  function renderWires() {
    svgCanvas.innerHTML = '';
    wires.forEach(wire => {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('class', 'wire');
      const coords = getTerminalCoords(wire.from, wire.to);
      if(coords) {
        line.setAttribute('d', generatePath(coords.x1, coords.y1, coords.x2, coords.y2));
        svgCanvas.appendChild(line);
      }
    });
  }

  function startWiring(e, terminalId) {
    e.stopPropagation();
    isWiring = true; 
    startTerminalId = terminalId;
    activeWireLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    activeWireLine.setAttribute('class', 'wire wire-active');
    svgCanvas.appendChild(activeWireLine);
  }

  function finishWiring(e, terminalId) {
    e.stopPropagation();
    if(isWiring && startTerminalId !== terminalId) {
      const exists = wires.some(w => 
        (w.from === startTerminalId && w.to === terminalId) || 
        (w.to === startTerminalId && w.from === terminalId)
      );
      if(!exists) wires.push({ from: startTerminalId, to: terminalId });
    }
    cleanupWiring(); 
    renderWires();
  }

  function cleanupWiring() {
    isWiring = false; 
    startTerminalId = null;
    if(activeWireLine) { activeWireLine.remove(); activeWireLine = null; }
  }

  window.addEventListener('mousemove', (e) => {
    const wsRect = workspace.getBoundingClientRect();
    
    if(isWiring && activeWireLine) {
      const t1 = document.getElementById(startTerminalId);
      if(!t1) return;
      const rect1 = t1.getBoundingClientRect();
      const x1 = rect1.left - wsRect.left + 7;
      const y1 = rect1.top - wsRect.top + 7;
      let x2 = e.clientX - wsRect.left;
      let y2 = e.clientY - wsRect.top;
      activeWireLine.setAttribute('d', generatePath(x1, y1, x2, y2));
    }

    if(isDragging && draggedComp && dragElement) {
      let newX = Math.max(0, Math.min(e.clientX - dragOffsetX, wsRect.width - draggedComp.w));
      let newY = Math.max(0, Math.min(e.clientY - dragOffsetY, wsRect.height - draggedComp.h));
      draggedComp.x = newX; 
      draggedComp.y = newY;
      
      dragElement.style.left = newX + 'px'; 
      dragElement.style.top = newY + 'px';
      
      renderWires();
    }
  });

  window.addEventListener('mouseup', () => {
    if(isWiring) cleanupWiring();
    if(isDragging && dragElement) {
      dragElement.style.zIndex = 10;
      isDragging = false; 
      draggedComp = null;
      dragElement = null;
    }
  });

  function selectComponent(id) {
    selectedComponentId = id; 
    renderComponents();
    const comp = componentsData.find(c => c.id === id);
    if(comp && noSelection && configForm) {
      noSelection.style.display = 'none'; 
      configForm.style.display = 'flex';
      if(propName) propName.value = comp.name; 
      if(propValue) propValue.value = comp.val; 
      if(propUnit) propUnit.value = comp.unit;
    }
  }

  function updateComponentFromForm() {
    if(!selectedComponentId) return;
    const comp = componentsData.find(c => c.id === selectedComponentId);
    if(comp) {
      if(propName) comp.name = propName.value; 
      if(propValue) comp.val = parseFloat(propValue.value) || 0; 
      if(propUnit) comp.unit = propUnit.value;
      
      const el = document.getElementById(comp.id);
      if(el) {
        el.querySelector('.comp-title').innerText = comp.name;
        el.querySelector('.comp-value').innerText = `${comp.val} ${comp.unit}`;
      }
    }
  }

  if(propName) propName.addEventListener('input', updateComponentFromForm);
  if(propValue) propValue.addEventListener('input', updateComponentFromForm);
  if(propUnit) propUnit.addEventListener('input', updateComponentFromForm);

  const clearBtn = document.getElementById('clearWiresBtn');
  if(clearBtn) {
    clearBtn.addEventListener('click', () => {
      wires = []; 
      renderWires();
    });
  }

  renderComponents();
  renderWires();
});