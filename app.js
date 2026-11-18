// === 分子與反應機構資料結構 ===
let atoms = [];  // { id, x, y, el, charge, lonePairs }
let bonds = [];  // { a1, a2, order }
let arrows = []; // { x1, y1, x2, y2 }
let history = [];
let redoStack = [];

let currentMode = "bond";
let currentBondOrder = 1;
let currentRingType = "benzene";
let currentChargeVal = 1;
let currentElement = "C";
let zoom = 1.0;

let hoverAtom = null;
let hoverBond = null;
let hoverArrow = null;
let dragStartAtom = null;
let dragArrowStart = null;
let dragPos = null;

let isRightRotating = false;
let rotateCenter = { x: 0, y: 0 };
let lastRotateAngle = 0;

let isTwoFingerGesture = false;
let lastTouchAngle = 0;
let lastTouchDist = 0;

let viewer3D = null;
let currentSdfData = "";

let base3DAtoms = [];
let base3DBonds = [];
let rotatableBonds = [];

const ATOM_COLORS = {
  C: "#1e293b", H: "#475569", N: "#2563eb", O: "#dc2626",
  S: "#d97706", P: "#ea580c", F: "#16a34a", Cl: "#16a34a",
  Br: "#991b1b", I: "#7e22ce", B: "#be185d", Mg: "#059669", Li: "#7c3aed"
};

const PERIODIC_TABLE = [
  ["H",1,1,"nonmetal"],["He",1,18,"noble"],
  ["Li",2,1,"alkali"],["Be",2,2,"alkaline"],["B",2,13,"metalloid"],["C",2,14,"nonmetal"],["N",2,15,"nonmetal"],["O",2,16,"nonmetal"],["F",2,17,"halogen"],["Ne",2,18,"noble"],
  ["Na",3,1,"alkali"],["Mg",3,2,"alkaline"],["Al",3,13,"metal"],["Si",3,14,"metalloid"],["P",3,15,"nonmetal"],["S",3,16,"nonmetal"],["Cl",3,17,"halogen"],["Ar",3,18,"noble"],
  ["K",4,1,"alkali"],["Ca",4,2,"alkaline"],["Sc",4,3,"transition"],["Ti",4,4,"transition"],["V",4,5,"transition"],["Cr",4,6,"transition"],["Mn",4,7,"transition"],["Fe",4,8,"transition"],["Co",4,9,"transition"],["Ni",4,10,"transition"],["Cu",4,11,"transition"],["Zn",4,12,"transition"],["Ga",4,13,"metal"],["Ge",4,14,"metalloid"],["As",4,15,"metalloid"],["Se",4,16,"nonmetal"],["Br",4,17,"halogen"],["Kr",4,18,"noble"],
  ["Rb",5,1,"alkali"],["Sr",5,2,"alkaline"],["Y",5,3,"transition"],["Zr",5,4,"transition"],["Nb",5,5,"transition"],["Mo",5,6,"transition"],["Tc",5,7,"transition"],["Ru",5,8,"transition"],["Rh",5,9,"transition"],["Pd",5,10,"transition"],["Ag",5,11,"transition"],["Cd",5,12,"transition"],["In",5,13,"metal"],["Sn",5,14,"metal"],["Sb",5,15,"metalloid"],["Te",5,16,"metalloid"],["I",5,17,"halogen"],["Xe",5,18,"noble"],
  ["Cs",6,1,"alkali"],["Ba",6,2,"alkaline"],["Hf",6,4,"transition"],["Ta",6,5,"transition"],["W",6,6,"transition"],["Re",6,7,"transition"],["Os",6,8,"transition"],["Ir",6,9,"transition"],["Pt",6,10,"transition"],["Au",6,11,"transition"],["Hg",6,12,"transition"],["Tl",6,13,"metal"],["Pb",6,14,"metal"],["Bi",6,15,"metal"],["At",6,17,"halogen"],["Rn",6,18,"noble"]
];

const canvas = document.getElementById("molCanvas");
const ctx = canvas.getContext("2d");

window.addEventListener("DOMContentLoaded", () => {
  init3DViewer();
  buildPeriodicTable();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  bindUIEvents();

  const defaultSmiles = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C";
  processMolecule(defaultSmiles, false);
  setTimeout(() => loadSmilesTo2D(defaultSmiles), 150);
});

function buildPeriodicTable() {
  const grid = document.getElementById("ptGrid");
  if (!grid) return;
  PERIODIC_TABLE.forEach(([el, row, col, cat]) => {
    const cell = document.createElement("button");
    cell.className = `pt-cell ${cat}`;
    cell.textContent = el;
    cell.style.gridRow = row;
    cell.style.gridColumn = col;
    cell.addEventListener("click", () => {
      currentElement = el;
      document.querySelectorAll(".atom-btn").forEach((b) => b.classList.remove("active"));
      const existingBtn = document.querySelector(`.atom-btn[data-atom="${el}"]`);
      if (existingBtn) {
        existingBtn.classList.add("active");
      } else {
        document.getElementById("openPtBtn").textContent = el;
        document.getElementById("openPtBtn").classList.add("active");
      }
      document.getElementById("ptModal").classList.add("hidden");
      if (currentMode === "erase") currentMode = "bond";
    });
    grid.appendChild(cell);
  });
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function saveState() {
  history.push(JSON.stringify({ atoms, bonds, arrows }));
  if (history.length > 30) history.shift();
  redoStack = [];
}

function loadSmilesTo2D(smiles) {
  try {
    if (typeof OCL === "undefined") return;
    let mol = null;

    try {
      mol = OCL.Molecule.fromSmiles(smiles);
    } catch (e1) {
      try {
        mol = OCL.Molecule.fromSmiles(smiles.replace(/[\/\\]/g, ""));
      } catch (e2) {
        if (currentSdfData) {
          mol = OCL.Molecule.fromMolfile(currentSdfData);
          mol.deleteImplicitHydrogens();
        }
      }
    }

    if (!mol) return;

    mol.inventCoordinates();
    mol.ensureHelperArrays(7);
    const nAtoms = mol.getAllAtoms();
    const nBonds = mol.getAllBonds();

    const newAtoms = [];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < nAtoms; i++) {
      const x = mol.getAtomX(i) * 32;
      const y = mol.getAtomY(i) * 32;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      newAtoms.push({
        id: i + 1, x, y,
        el: mol.getAtomLabel(i) || "C",
        charge: mol.getAtomCharge(i) || 0,
        lonePairs: 0
      });
    }

    const rect = canvas.parentElement.getBoundingClientRect();
    const offsetX = rect.width / 2 - (minX + maxX) / 2;
    const offsetY = rect.height / 2 - (minY + maxY) / 2;
    newAtoms.forEach((a) => { a.x += offsetX; a.y += offsetY; });

    const newBonds = [];
    for (let i = 0; i < nBonds; i++) {
      newBonds.push({
        a1: mol.getBondAtom(0, i) + 1,
        a2: mol.getBondAtom(1, i) + 1,
        order: mol.getBondOrder(i) || 1
      });
    }

    saveState();
    atoms = newAtoms;
    bonds = newBonds;
    arrows = [];
    draw();
  } catch (e) {
    console.error("2D 解析錯誤:", e);
  }
}

function exportCanvasToMolfile() {
  if (atoms.length === 0) return "";
  let lines = [
    "MolView",
    "  Native2D",
    "",
    `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`
  ];

  const idMap = new Map();
  atoms.forEach((a, idx) => {
    idMap.set(a.id, idx + 1);
    const x = (a.x / 32).toFixed(4).padStart(10);
    const y = (-a.y / 32).toFixed(4).padStart(10);
    const z = "0.0000".padStart(10);
    const el = a.el.padEnd(3);
    const chg = a.charge === 1 ? "  3" : a.charge === -1 ? "  5" : "  0";
    lines.push(`${x}${y}${z} ${el} 0${chg}  0  0  0  0  0  0  0  0  0  0`);
  });

  bonds.forEach((b) => {
    const i1 = String(idMap.get(b.a1)).padStart(3);
    const i2 = String(idMap.get(b.a2)).padStart(3);
    const ord = String(b.order).padStart(3);
    lines.push(`${i1}${i2}${ord}  0  0  0  0`);
  });

  lines.push("M  END");
  return lines.join("\n");
}

function draw() {
  const rect = canvas.parentElement.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  ctx.translate(rect.width / 2, rect.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-rect.width / 2, -rect.height / 2);

  bonds.forEach((b) => {
    const a1 = atoms.find((a) => a.id === b.a1);
    const a2 = atoms.find((a) => a.id === b.a2);
    if (!a1 || !a2) return;

    const isHover = hoverBond === b;
    ctx.strokeStyle = isHover ? "#0284c7" : "#1e293b";
    ctx.lineWidth = isHover ? 3 : 2;
    ctx.lineCap = "round";

    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    if (b.order === 1) {
      drawLine(a1.x, a1.y, a2.x, a2.y);
    } else if (b.order === 2) {
      const off = 3.2;
      drawLine(a1.x + nx * off, a1.y + ny * off, a2.x + nx * off, a2.y + ny * off);
      drawLine(a1.x - nx * off, a1.y - ny * off, a2.x - nx * off, a2.y - ny * off);
    } else if (b.order === 3) {
      const off = 4.5;
      drawLine(a1.x, a1.y, a2.x, a2.y);
      drawLine(a1.x + nx * off, a1.y + ny * off, a2.x + nx * off, a2.y + ny * off);
      drawLine(a1.x - nx * off, a1.y - ny * off, a2.x - nx * off, a2.y - ny * off);
    }
  });

  if (dragStartAtom && dragPos) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    drawLine(dragStartAtom.x, dragStartAtom.y, dragPos.x, dragPos.y);
    ctx.setLineDash([]);
  }

  atoms.forEach((a) => {
    const degree = bonds.filter((b) => b.a1 === a.id || b.a2 === a.id).length;
    const showLabel = a.el !== "C" || degree === 0 || a.charge !== 0 || (a.lonePairs && a.lonePairs > 0);

    if (hoverAtom === a) {
      ctx.fillStyle = "rgba(186, 230, 253, 0.75)";
      ctx.beginPath();
      ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    if (showLabel) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(a.x, a.y, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = ATOM_COLORS[a.el] || "#1e293b";
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const chargeStr = a.charge === 1 ? "+" : a.charge === -1 ? "−" : "";
      ctx.fillText(a.el + chargeStr, a.x, a.y);
    }

    if (a.lonePairs && a.lonePairs > 0) {
      drawLonePairs(a);
    }
  });

  arrows.forEach((arr) => {
    drawCurvedArrow(arr.x1, arr.y1, arr.x2, arr.y2, hoverArrow === arr);
  });
  if (dragArrowStart && dragPos) {
    drawCurvedArrow(dragArrowStart.x, dragArrowStart.y, dragPos.x, dragPos.y, true);
  }

  ctx.restore();
}

function drawLonePairs(atom) {
  const dirs = [
    { dx: 0, dy: -13, px: 2.6, py: 0 },
    { dx: 13, dy: 0, px: 0, py: 2.6 },
    { dx: 0, dy: 13, px: 2.6, py: 0 },
    { dx: -13, dy: 0, px: 0, py: 2.6 }
  ];
  ctx.fillStyle = "#0f172a";
  for (let i = 0; i < Math.min(4, atom.lonePairs); i++) {
    const d = dirs[i];
    const cx = atom.x + d.dx;
    const cy = atom.y + d.dy;
    ctx.beginPath();
    ctx.arc(cx - d.px, cy - d.py, 1.8, 0, Math.PI * 2);
    ctx.arc(cx + d.px, cy + d.py, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCurvedArrow(x1, y1, x2, y2, highlight = false) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) return;

  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const nx = -dy / dist;
  const ny = dx / dist;
  const curveHeight = Math.min(32, dist * 0.35);
  const cx = mx + nx * curveHeight;
  const cy = my + ny * curveHeight;

  ctx.strokeStyle = highlight ? "#0284c7" : "#e11d48";
  ctx.fillStyle = highlight ? "#0284c7" : "#e11d48";
  ctx.lineWidth = 1.8;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();

  const angle = Math.atan2(y2 - cy, x2 - cx);
  const headLen = 8;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawLine(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const rawX = e.clientX - rect.left;
  const rawY = e.clientY - rect.top;
  return {
    x: (rawX - rect.width / 2) / zoom + rect.width / 2,
    y: (rawY - rect.height / 2) / zoom + rect.height / 2
  };
}

function findAtomAt(pos) {
  return atoms.find((a) => Math.hypot(a.x - pos.x, a.y - pos.y) < 15) || null;
}

function findBondAt(pos) {
  return bonds.find((b) => {
    const a1 = atoms.find((a) => a.id === b.a1);
    const a2 = atoms.find((a) => a.id === b.a2);
    if (!a1 || !a2) return false;
    return pointToSegDist(pos.x, pos.y, a1.x, a1.y, a2.x, a2.y) < 8;
  }) || null;
}

function findArrowAt(pos) {
  return arrows.find((arr) => {
    const mx = (arr.x1 + arr.x2) / 2;
    const my = (arr.y1 + arr.y2) / 2;
    return Math.hypot(pos.x - mx, pos.y - my) < 18 || Math.hypot(pos.x - arr.x2, pos.y - arr.y2) < 14;
  }) || null;
}

function pointToSegDist(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousemove", (e) => {
  const pos = getMousePos(e);

  if (isRightRotating) {
    const currentAngle = Math.atan2(pos.y - rotateCenter.y, pos.x - rotateCenter.x);
    const deltaAngle = currentAngle - lastRotateAngle;
    lastRotateAngle = currentAngle;

    const cos = Math.cos(deltaAngle);
    const sin = Math.sin(deltaAngle);

    atoms.forEach((a) => {
      const dx = a.x - rotateCenter.x;
      const dy = a.y - rotateCenter.y;
      a.x = rotateCenter.x + dx * cos - dy * sin;
      a.y = rotateCenter.y + dx * sin + dy * cos;
    });

    arrows.forEach((arr) => {
      const dx1 = arr.x1 - rotateCenter.x;
      const dy1 = arr.y1 - rotateCenter.y;
      arr.x1 = rotateCenter.x + dx1 * cos - dy1 * sin;
      arr.y1 = rotateCenter.y + dx1 * sin + dy1 * cos;

      const dx2 = arr.x2 - rotateCenter.x;
      const dy2 = arr.y2 - rotateCenter.y;
      arr.x2 = rotateCenter.x + dx2 * cos - dy2 * sin;
      arr.y2 = rotateCenter.y + dx2 * sin + dy2 * cos;
    });

    draw();
    return;
  }

  hoverAtom = findAtomAt(pos);
  hoverBond = hoverAtom ? null : findBondAt(pos);
  hoverArrow = (!hoverAtom && !hoverBond) ? findArrowAt(pos) : null;

  if (dragStartAtom) {
    const dx = pos.x - dragStartAtom.x;
    const dy = pos.y - dragStartAtom.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 6)) * (Math.PI / 6);
    const dist = Math.hypot(dx, dy) < 20 ? 36 : Math.hypot(dx, dy);
    dragPos = {
      x: dragStartAtom.x + Math.cos(angle) * dist,
      y: dragStartAtom.y + Math.sin(angle) * dist
    };
  } else if (dragArrowStart) {
    dragPos = pos;
  }
  draw();
});

canvas.addEventListener("mousedown", (e) => {
  const pos = getMousePos(e);

  if (e.button === 2) {
    if (atoms.length === 0) return;
    saveState();
    isRightRotating = true;
    rotateCenter = {
      x: atoms.reduce((sum, a) => sum + a.x, 0) / atoms.length,
      y: atoms.reduce((sum, a) => sum + a.y, 0) / atoms.length
    };
    lastRotateAngle = Math.atan2(pos.y - rotateCenter.y, pos.x - rotateCenter.x);
    canvas.style.cursor = "grabbing";
    return;
  }

  const hitAtom = findAtomAt(pos);
  const hitBond = hitAtom ? null : findBondAt(pos);
  const hitArrow = (!hitAtom && !hitBond) ? findArrowAt(pos) : null;

  if (currentMode === "erase") {
    if (hitAtom) {
      saveState();
      atoms = atoms.filter((a) => a.id !== hitAtom.id);
      bonds = bonds.filter((b) => b.a1 !== hitAtom.id && b.a2 !== hitAtom.id);
    } else if (hitBond) {
      saveState();
      bonds = bonds.filter((b) => b !== hitBond);
    } else if (hitArrow) {
      saveState();
      arrows = arrows.filter((arr) => arr !== hitArrow);
    }
    draw();
    return;
  }

  if (currentMode === "lonepair" && hitAtom) {
    saveState();
    hitAtom.lonePairs = ((hitAtom.lonePairs || 0) + 1) % 5;
    draw();
    return;
  }

  if (currentMode === "arrow") {
    dragArrowStart = hitAtom ? { x: hitAtom.x, y: hitAtom.y } : pos;
    dragPos = pos;
    draw();
    return;
  }

  if (currentMode === "charge" && hitAtom) {
    saveState();
    hitAtom.charge = hitAtom.charge === currentChargeVal ? 0 : currentChargeVal;
    draw();
    return;
  }

  if (currentMode === "ring") {
    saveState();
    addRingAt(hitAtom ? { x: hitAtom.x, y: hitAtom.y } : pos, currentRingType, hitAtom);
    draw();
    return;
  }

  if (currentMode === "bond") {
    if (hitBond) {
      saveState();
      hitBond.order = hitBond.order >= 3 ? 1 : hitBond.order + 1;
      draw();
      return;
    }
    if (hitAtom) {
      dragStartAtom = hitAtom;
      dragPos = pos;
    } else {
      saveState();
      const newId = Date.now() + Math.random();
      const newAtom = { id: newId, x: pos.x, y: pos.y, el: currentElement, charge: 0, lonePairs: 0 };
      atoms.push(newAtom);
      dragStartAtom = newAtom;
      dragPos = pos;
      draw();
    }
  }
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 2 && isRightRotating) {
    isRightRotating = false;
    canvas.style.cursor = "crosshair";
    return;
  }

  if (dragArrowStart) {
    const pos = getMousePos(e);
    const targetAtom = findAtomAt(pos);
    const endPos = targetAtom ? { x: targetAtom.x, y: targetAtom.y } : pos;
    if (Math.hypot(endPos.x - dragArrowStart.x, endPos.y - dragArrowStart.y) > 12) {
      saveState();
      arrows.push({ x1: dragArrowStart.x, y1: dragArrowStart.y, x2: endPos.x, y2: endPos.y });
    }
    dragArrowStart = null;
    dragPos = null;
    draw();
    return;
  }

  if (!dragStartAtom) return;
  const pos = dragPos || getMousePos(e);
  const targetAtom = findAtomAt(pos);

  if (targetAtom && targetAtom !== dragStartAtom) {
    saveState();
    const exists = bonds.find(
      (b) => (b.a1 === dragStartAtom.id && b.a2 === targetAtom.id) || (b.a1 === targetAtom.id && b.a2 === dragStartAtom.id)
    );
    if (exists) {
      exists.order = currentBondOrder;
    } else {
      bonds.push({ a1: dragStartAtom.id, a2: targetAtom.id, order: currentBondOrder });
    }
  } else if (Math.hypot(pos.x - dragStartAtom.x, pos.y - dragStartAtom.y) > 12) {
    saveState();
    const newId = Date.now() + Math.random();
    atoms.push({ id: newId, x: pos.x, y: pos.y, el: currentElement, charge: 0, lonePairs: 0 });
    bonds.push({ a1: dragStartAtom.id, a2: newId, order: currentBondOrder });
  } else if (dragStartAtom.el !== currentElement) {
    saveState();
    dragStartAtom.el = currentElement;
  }

  dragStartAtom = null;
  dragPos = null;
  draw();
});

// === 手機觸控支援 ===
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    isTwoFingerGesture = true;
    dragStartAtom = null;
    dragArrowStart = null;
    dragPos = null;

    if (atoms.length > 0) {
      saveState();
      rotateCenter = {
        x: atoms.reduce((sum, a) => sum + a.x, 0) / atoms.length,
        y: atoms.reduce((sum, a) => sum + a.y, 0) / atoms.length
      };
    }

    const t1 = e.touches[0];
    const t2 = e.touches[1];
    lastTouchAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    lastTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    return;
  }

  if (e.touches.length === 1 && !isTwoFingerGesture) {
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent("mousedown", {
      clientX: t.clientX,
      clientY: t.clientY,
      button: 0
    }));
  }
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (e.touches.length === 2 && isTwoFingerGesture) {
    const t1 = e.touches[0];
    const t2 = e.touches[1];

    const currentAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
    const deltaAngle = currentAngle - lastTouchAngle;
    lastTouchAngle = currentAngle;

    if (atoms.length > 0) {
      const cos = Math.cos(deltaAngle);
      const sin = Math.sin(deltaAngle);

      atoms.forEach((a) => {
        const dx = a.x - rotateCenter.x;
        const dy = a.y - rotateCenter.y;
        a.x = rotateCenter.x + dx * cos - dy * sin;
        a.y = rotateCenter.y + dx * sin + dy * cos;
      });

      arrows.forEach((arr) => {
        const dx1 = arr.x1 - rotateCenter.x;
        const dy1 = arr.y1 - rotateCenter.y;
        arr.x1 = rotateCenter.x + dx1 * cos - dy1 * sin;
        arr.y1 = rotateCenter.y + dx1 * sin + dy1 * cos;

        const dx2 = arr.x2 - rotateCenter.x;
        const dy2 = arr.y2 - rotateCenter.y;
        arr.x2 = rotateCenter.x + dx2 * cos - dy2 * sin;
        arr.y2 = rotateCenter.y + dx2 * sin + dy2 * cos;
      });
    }

    const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    if (lastTouchDist > 0) {
      const scaleRatio = currentDist / lastTouchDist;
      zoom = Math.max(0.4, Math.min(2.5, zoom * scaleRatio));
      document.getElementById("zoomBadge").textContent = `${Math.round(zoom * 100)}%`;
    }
    lastTouchDist = currentDist;
    draw();
    return;
  }

  if (e.touches.length === 1 && !isTwoFingerGesture) {
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent("mousemove", {
      clientX: t.clientX,
      clientY: t.clientY
    }));
  }
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  if (e.touches.length === 0) {
    if (!isTwoFingerGesture) {
      window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
    }
    isTwoFingerGesture = false;
    lastTouchDist = 0;
  }
});

function addRingAt(center, type, attachAtom) {
  const sides = type === "cyclopentane" ? 5 : 6;
  const radius = 36;
  const ringAtoms = [];

  for (let i = 0; i < sides; i++) {
    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    if (i === 0 && attachAtom) {
      ringAtoms.push(attachAtom);
    } else {
      const a = { id: Date.now() + Math.random() + i, x, y, el: "C", charge: 0, lonePairs: 0 };
      atoms.push(a);
      ringAtoms.push(a);
    }
  }

  for (let i = 0; i < sides; i++) {
    const a1 = ringAtoms[i];
    const a2 = ringAtoms[(i + 1) % sides];
    const order = type === "benzene" && i % 2 === 0 ? 2 : 1;
    bonds.push({ a1: a1.id, a2: a2.id, order });
  }
}

function bindUIEvents() {
  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
      document.getElementById("btnErase").classList.remove("active");
      btn.classList.add("active");

      currentMode = btn.getAttribute("data-tool");
      if (currentMode === "bond") currentBondOrder = Number(btn.getAttribute("data-order"));
      if (currentMode === "ring") currentRingType = btn.getAttribute("data-ring");
      if (currentMode === "charge") currentChargeVal = Number(btn.getAttribute("data-val"));
    });
  });

  document.querySelectorAll(".atom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".atom-btn").forEach((b) => b.classList.remove("active"));
      document.getElementById("openPtBtn").classList.remove("active");
      document.getElementById("openPtBtn").textContent = "•••";
      btn.classList.add("active");
      currentElement = btn.getAttribute("data-atom");
      if (currentMode === "erase") {
        currentMode = "bond";
        document.getElementById("btnErase").classList.remove("active");
      }
    });
  });

  const openPtBtn = document.getElementById("openPtBtn");
  const closePtBtn = document.getElementById("closePtBtn");
  if (openPtBtn) {
    openPtBtn.addEventListener("click", () => {
      document.getElementById("ptModal").classList.toggle("hidden");
    });
  }
  if (closePtBtn) {
    closePtBtn.addEventListener("click", () => {
      document.getElementById("ptModal").classList.add("hidden");
    });
  }

  document.getElementById("btnErase").addEventListener("click", (e) => {
    currentMode = "erase";
    document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    saveState();
    atoms = [];
    bonds = [];
    arrows = [];
    draw();
  });

  document.getElementById("btnUndo").addEventListener("click", () => {
    if (history.length === 0) return;
    redoStack.push(JSON.stringify({ atoms, bonds, arrows }));
    const prev = JSON.parse(history.pop());
    atoms = prev.atoms;
    bonds = prev.bonds;
    arrows = prev.arrows || [];
    draw();
  });

  document.getElementById("btnRedo").addEventListener("click", () => {
    if (redoStack.length === 0) return;
    history.push(JSON.stringify({ atoms, bonds, arrows }));
    const next = JSON.parse(redoStack.pop());
    atoms = next.atoms;
    bonds = next.bonds;
    arrows = next.arrows || [];
    draw();
  });

  let chairFlipState = false;

  document.getElementById("btnClean").addEventListener("click", () => {
    if (atoms.length === 0) return;
    const molfile = exportCanvasToMolfile();
    if (!molfile) return;

    try {
      const savedLonePairs = atoms.map((a) => a.lonePairs || 0);
      const mol = OCL.Molecule.fromMolfile(molfile);
      mol.inventCoordinates();
      mol.ensureHelperArrays(7);

      const nAtoms = mol.getAllAtoms();
      const nBonds = mol.getAllBonds();
      const newAtoms = [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      for (let i = 0; i < nAtoms; i++) {
        const x = mol.getAtomX(i) * 34;
        const y = mol.getAtomY(i) * 34;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        newAtoms.push({
          id: i + 1,
          x, y,
          el: mol.getAtomLabel(i) || "C",
          charge: mol.getAtomCharge(i) || 0,
          lonePairs: savedLonePairs[i] || 0
        });
      }

      const oldCenterX = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
      const oldCenterY = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
      const offsetX = oldCenterX - (minX + maxX) / 2;
      const offsetY = oldCenterY - (minY + maxY) / 2;
      newAtoms.forEach((a) => { a.x += offsetX; a.y += offsetY; });

      const newBonds = [];
      for (let i = 0; i < nBonds; i++) {
        newBonds.push({
          a1: mol.getBondAtom(0, i) + 1,
          a2: mol.getBondAtom(1, i) + 1,
          order: mol.getBondOrder(i) || 1
        });
      }

      saveState();
      atoms = newAtoms;
      bonds = newBonds;
      draw();
    } catch (err) {
      alert("無法自動重整此結構，請確認化學鍵連線是否有效");
    }
  });

  document.getElementById("btnChair").addEventListener("click", () => {
    const ring6 = findSixMemberedRing();
    if (!ring6) {
      alert("畫布中找不到封閉的六員環結構！");
      return;
    }

    saveState();
    const beforeCenterX = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const beforeCenterY = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;

    const ringCx = ring6.reduce((s, a) => s + a.x, 0) / 6;
    const ringCy = ring6.reduce((s, a) => s + a.y, 0) / 6;

    const chairOffsets = !chairFlipState
      ? [
          { dx: -46, dy:  12 },
          { dx: -14, dy: -14 },
          { dx:  26, dy:  -4 },
          { dx:  46, dy: -20 },
          { dx:  14, dy:  16 },
          { dx: -26, dy:  10 }
        ]
      : [
          { dx: -46, dy: -20 },
          { dx: -14, dy:  16 },
          { dx:  26, dy:  10 },
          { dx:  46, dy:  12 },
          { dx:  14, dy: -14 },
          { dx: -26, dy:  -4 }
        ];

    chairFlipState = !chairFlipState;
    const movedSet = new Set(ring6.map((r) => r.id));

    ring6.forEach((atom, idx) => {
      const targetX = ringCx + chairOffsets[idx].dx;
      const targetY = ringCy + chairOffsets[idx].dy;
      const moveX = targetX - atom.x;
      const moveY = targetY - atom.y;

      moveSubstituents(atom.id, movedSet, moveX, moveY);
      atom.x = targetX;
      atom.y = targetY;
    });

    const afterCenterX = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const afterCenterY = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const fixX = beforeCenterX - afterCenterX;
    const fixY = beforeCenterY - afterCenterY;

    atoms.forEach((a) => {
      a.x += fixX;
      a.y += fixY;
    });

    draw();
  });

  document.getElementById("btnCenter").addEventListener("click", () => {
    if (atoms.length === 0) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const avgX = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const avgY = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const dx = rect.width / 2 - avgX;
    const dy = rect.height / 2 - avgY;
    atoms.forEach((a) => { a.x += dx; a.y += dy; });
    arrows.forEach((arr) => { arr.x1 += dx; arr.y1 += dy; arr.x2 += dx; arr.y2 += dy; });
    draw();
  });

  document.getElementById("btnZoomIn").addEventListener("click", () => {
    zoom = Math.min(2.5, zoom + 0.1);
    document.getElementById("zoomBadge").textContent = `${Math.round(zoom * 100)}%`;
    draw();
  });

  document.getElementById("btnZoomOut").addEventListener("click", () => {
    zoom = Math.max(0.4, zoom - 0.1);
    document.getElementById("zoomBadge").textContent = `${Math.round(zoom * 100)}%`;
    draw();
  });

  document.getElementById("toggle3DBtn").addEventListener("click", (e) => {
    document.getElementById("viewerPane").classList.toggle("hidden");
    e.target.classList.toggle("active");
    setTimeout(resizeCanvas, 50);
  });

  document.getElementById("syncBtn").addEventListener("click", () => {
    const molfile = exportCanvasToMolfile();
    if (!molfile) return;
    try {
      const oclMol = OCL.Molecule.fromMolfile(molfile);
      const smiles = oclMol.toSmiles();
      if (smiles) processMolecule(smiles, false);
    } catch (err) {
      alert("請確認畫布上的化學結構連線完整");
    }
  });

  document.getElementById("styleSelect").addEventListener("change", (e) => {
    apply3DStyle(e.target.value);
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    if (!currentSdfData) return;
    const blob = new Blob([currentSdfData], { type: "chemical/x-mdl-sdfile" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "molecule_3d.sdf";
    a.click();
  });

  document.getElementById("torsionSlider").addEventListener("input", (e) => {
    const deg = Number(e.target.value);
    document.getElementById("torsionAngleLabel").textContent = `${deg}°`;

    const mod120 = deg % 120;
    const statusEl = document.getElementById("torsionStatus");
    if (mod120 <= 8 || mod120 >= 112) {
      statusEl.textContent = "✦ 交錯式 (Staggered · 能量最低)";
      statusEl.style.color = "#38bdf8";
    } else if (Math.abs(mod120 - 60) <= 8) {
      statusEl.textContent = "⚡ 重疊式 (Eclipsed · 能量最高)";
      statusEl.style.color = "#fbbf24";
    } else {
      statusEl.textContent = "過渡扭轉角 (Skew)";
      statusEl.style.color = "#94a3b8";
    }

    const bondIdx = Number(document.getElementById("bondSelect").value);
    const targetBond = rotatableBonds[bondIdx];
    if (!targetBond) return;

    const pA = base3DAtoms[targetBond.a1];
    const pB = base3DAtoms[targetBond.a2];

    let ux = pB.x - pA.x;
    let uy = pB.y - pA.y;
    let uz = pB.z - pA.z;
    const len = Math.hypot(ux, uy, uz) || 1;
    ux /= len; uy /= len; uz /= len;

    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rotatedAtoms = base3DAtoms.map((a) => ({ ...a }));
    targetBond.movingIndices.forEach((idx) => {
      if (idx === targetBond.a2) return;
      const atom = rotatedAtoms[idx];
      const vx = atom.x - pB.x;
      const vy = atom.y - pB.y;
      const vz = atom.z - pB.z;

      const dot = ux * vx + uy * vy + uz * vz;
      const crossX = uy * vz - uz * vy;
      const crossY = uz * vx - ux * vz;
      const crossZ = ux * vy - uy * vx;

      atom.x = pB.x + vx * cos + crossX * sin + ux * dot * (1 - cos);
      atom.y = pB.y + vy * cos + crossY * sin + uy * dot * (1 - cos);
      atom.z = pB.z + vz * cos + crossZ * sin + uz * dot * (1 - cos);
    });

    const newSdf = buildSdfFromAtoms(rotatedAtoms, base3DBonds);
    viewer3D.clear();
    viewer3D.addModel(newSdf, "sdf");
    apply3DStyle(document.getElementById("styleSelect").value);
  });

  document.getElementById("bondSelect").addEventListener("change", () => {
    document.getElementById("torsionSlider").value = 0;
    document.getElementById("torsionAngleLabel").textContent = "0°";
  });

  // === 搜尋框即時推薦引擎 ===
  const COMMON_MOLECULES = [
    { zh: "乙烷 (Staggered / Eclipsed)", en: "ethane", formula: "C2H6", tag: "烷烴" },
    { zh: "丙烷", en: "propane", formula: "C3H8", tag: "烷烴" },
    { zh: "正丁烷", en: "butane", formula: "C4H10", tag: "烷烴" },
    { zh: "環己烷", en: "cyclohexane", formula: "C6H12", tag: "環烷" },
    { zh: "苯", en: "benzene", formula: "C6H6", tag: "芳香烴" },
    { zh: "甲苯", en: "toluene", formula: "C7H8", tag: "芳香烴" },
    { zh: "順丁烯二酸 (cis)", en: "maleic acid", formula: "C4H4O4", tag: "Z異構物" },
    { zh: "反丁烯二酸 (trans)", en: "fumaric acid", formula: "C4H4O4", tag: "E異構物" },
    { zh: "乙醇 (酒精)", en: "ethanol", formula: "C2H6O", tag: "醇類" },
    { zh: "乙酸 (醋酸)", en: "acetic acid", formula: "C2H4O2", tag: "羧酸" },
    { zh: "丙酮", en: "acetone", formula: "C3H6O", tag: "酮類" },
    { zh: "苯酚 (石炭酸)", en: "phenol", formula: "C6H6O", tag: "酚類" },
    { zh: "苯甲酸 (安息香酸)", en: "benzoic acid", formula: "C7H6O2", tag: "羧酸" },
    { zh: "水楊酸", en: "salicylic acid", formula: "C7H6O3", tag: "藥物前驅" },
    { zh: "阿斯匹靈 (乙醯水楊酸)", en: "aspirin", formula: "C9H8O4", tag: "藥物" },
    { zh: "普拿疼 (對乙醯氨基酚)", en: "acetaminophen", formula: "C8H9NO2", tag: "藥物" },
    { zh: "布洛芬", en: "ibuprofen", formula: "C13H18O2", tag: "藥物" },
    { zh: "咖啡因", en: "caffeine", formula: "C8H10N4O2", tag: "生物鹼" },
    { zh: "葡萄糖", en: "glucose", formula: "C6H12O6", tag: "單醣" },
    { zh: "膽固醇", en: "cholesterol", formula: "C27H46O", tag: "類固醇" },
    { zh: "腎上腺素", en: "epinephrine", formula: "C9H13NO3", tag: "神經傳導" },
    { zh: "多巴胺", en: "dopamine", formula: "C8H11NO2", tag: "神經傳導" },
    { zh: "血清素 (5-HT)", en: "serotonin", formula: "C10H12N2O", tag: "神經傳導" },
    { zh: "青黴素 (盤尼西林)", en: "penicillin G", formula: "C16H18N2O4S", tag: "抗生素" }
  ];

  const searchInput = document.getElementById("searchInput");
  const searchDropdown = document.getElementById("searchDropdown");
  let suggestTimer = null;
  let activeSuggestIdx = -1;

  function renderSuggestions(items) {
    if (!items || items.length === 0) {
      searchDropdown.classList.add("hidden");
      searchDropdown.innerHTML = "";
      activeSuggestIdx = -1;
      return;
    }

    searchDropdown.innerHTML = "";
    activeSuggestIdx = -1;

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "search-item";
      row.innerHTML = `
        <div class="search-item-main">
          <span class="search-item-title">${item.title}</span>
          <span class="search-item-sub">${item.sub}</span>
        </div>
        <span class="search-item-tag">${item.tag}</span>
      `;
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        searchInput.value = item.query;
        searchDropdown.classList.add("hidden");
        processMolecule(item.query, true);
      });
      searchDropdown.appendChild(row);
    });

    searchDropdown.classList.remove("hidden");
  }

  async function updateSearchSuggestions(keyword) {
    const q = keyword.trim().toLowerCase();
    if (!q) {
      const featured = COMMON_MOLECULES.slice(0, 6).map((m) => ({
        title: m.zh,
        sub: `${m.en} · ${m.formula}`,
        tag: m.tag,
        query: m.en
      }));
      renderSuggestions(featured);
      return;
    }

    const localMatches = COMMON_MOLECULES.filter(
      (m) => m.zh.toLowerCase().includes(q) || m.en.toLowerCase().includes(q) || m.formula.toLowerCase() === q
    ).map((m) => ({
      title: m.zh,
      sub: `${m.en} · ${m.formula}`,
      tag: m.tag,
      query: m.en
    }));

    renderSuggestions(localMatches);

    if (/^[a-zA-Z0-9\-\s]{2,}$/.test(q)) {
      try {
        const res = await fetch(
          `https://pubchem.ncbi.nlm.nih.gov/rest/autocomplete/compound/${encodeURIComponent(q)}/json?limit=6`
        );
        if (!res.ok) return;
        const data = await res.json();
        const cloudTerms = data?.dictionary_terms?.compound || [];

        const existingQueries = new Set(localMatches.map((m) => m.query.toLowerCase()));
        const cloudMatches = cloudTerms
          .filter((name) => !existingQueries.has(name.toLowerCase()))
          .map((name) => ({
            title: name,
            sub: "PubChem 資料庫化合物",
            tag: "☁ 雲端",
            query: name
          }));

        if (searchInput.value.trim().toLowerCase() === q) {
          renderSuggestions([...localMatches, ...cloudMatches].slice(0, 8));
        }
      } catch (err) {}
    }
  }

  searchInput.addEventListener("focus", () => updateSearchSuggestions(searchInput.value));
  searchInput.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => updateSearchSuggestions(searchInput.value), 180);
  });
  searchInput.addEventListener("blur", () => {
    setTimeout(() => searchDropdown.classList.add("hidden"), 150);
  });
  searchInput.addEventListener("keydown", (e) => {
    const items = searchDropdown.querySelectorAll(".search-item");
    if (e.key === "ArrowDown" && items.length > 0) {
      e.preventDefault();
      activeSuggestIdx = (activeSuggestIdx + 1) % items.length;
      items.forEach((el, i) => el.classList.toggle("selected", i === activeSuggestIdx));
      return;
    }
    if (e.key === "ArrowUp" && items.length > 0) {
      e.preventDefault();
      activeSuggestIdx = (activeSuggestIdx - 1 + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle("selected", i === activeSuggestIdx));
      return;
    }
    if (e.key === "Escape") {
      searchDropdown.classList.add("hidden");
      return;
    }
    if (e.key === "Enter") {
      if (activeSuggestIdx >= 0 && items[activeSuggestIdx]) {
        e.preventDefault();
        items[activeSuggestIdx].dispatchEvent(new MouseEvent("mousedown"));
        return;
      }
      const val = searchInput.value.trim();
      if (!val) return;
      searchDropdown.classList.add("hidden");
      const isSmiles = /^[A-Za-z0-9@+\-\[\]\(\)\\\/%=#$]+$/.test(val) && /[=\(\)\[\]#1-9]/.test(val);
      processMolecule(val, !isSmiles);
    }
  });
}

function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#0f172a" });
}

async function processMolecule(query, isName = false) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  let searchQuery = query;

  if (isName && /[\u4e00-\u9fa5]/.test(query)) {
    infoEl.textContent = `正在將「${query}」翻譯為英文化學名...`;
    const specialDict = {
      "阿斯匹靈": "aspirin", "阿司匹林": "aspirin", "青黴素": "penicillin",
      "盤尼西林": "penicillin", "布洛芬": "ibuprofen", "對乙醯氨基酚": "acetaminophen",
      "普拿疼": "acetaminophen", "乙醇": "ethanol", "酒精": "ethanol",
      "乙酸": "acetic acid", "醋酸": "acetic acid", "丙酮": "acetone"
    };

    if (specialDict[query]) {
      searchQuery = specialDict[query];
    } else {
      try {
        const transRes = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=zh-TW|en`
        );
        const transData = await transRes.json();
        if (transData?.responseData?.translatedText) {
          searchQuery = transData.responseData.translatedText.toLowerCase().trim();
        }
      } catch (e) {
        console.warn("自動翻譯連線失敗:", e);
      }
    }
  }

  infoEl.textContent = `正在向資料庫檢索「${searchQuery}」...`;

  try {
    const type = isName ? "name" : "smiles";
    const encoded = encodeURIComponent(searchQuery);

    const propRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${type}/${encoded}/property/MolecularFormula,MolecularWeight,IUPACName,IsomericSMILES,CanonicalSMILES,ConnectivitySMILES/JSON`
    );

    if (propRes.ok) {
      const propData = await propRes.json();
      const props = propData.PropertyTable.Properties[0];
      const exactSmiles = props.IsomericSMILES || props.CanonicalSMILES || props.ConnectivitySMILES || props.SMILES;

      const sdfTarget = exactSmiles ? `smiles/${encodeURIComponent(exactSmiles)}` : `${type}/${encoded}`;
      const sdfRes = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${sdfTarget}/SDF?record_type=3d`
      );

      badgeEl.className = "badge cloud";
      badgeEl.textContent = "☁ PubChem";
      formulaEl.textContent = `${props.MolecularFormula} (${props.MolecularWeight})`;
      infoEl.textContent = `${searchQuery} ｜ ${props.IUPACName || ""}`;

      if (sdfRes.ok) {
        currentSdfData = await sdfRes.text();
        render3DModel(currentSdfData);
      } else if (exactSmiles) {
        generateLocal3D(exactSmiles);
      }

      if (isName && exactSmiles) {
        loadSmilesTo2D(exactSmiles);
      }
      return;
    }

    if (!isName) {
      generateLocal3D(searchQuery);
    } else {
      throw new Error(`資料庫找不到「${searchQuery}」（請嘗試輸入英文名或 SMILES）`);
    }
  } catch (err) {
    if (!isName) {
      generateLocal3D(searchQuery);
    } else {
      badgeEl.className = "badge local";
      badgeEl.textContent = "提示";
      formulaEl.textContent = "—";
      infoEl.textContent = err.message;
    }
  }
}

function generateLocal3D(smiles) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  try {
    const mol = OCL.Molecule.fromSmiles(smiles);
    mol.addImplicitHydrogens();

    const generator = new OCL.ConformerGenerator(1);
    const mol3D = generator.getOneConformerAsMolecule(mol);
    if (!mol3D) throw new Error("無法生成 3D 座標");

    currentSdfData = mol3D.toMolfileV3();
    const formulaObj = mol.getMolecularFormula();

    badgeEl.className = "badge local";
    badgeEl.textContent = "⚡ 本地演算";
    formulaEl.textContent = `${formulaObj.formula} (${formulaObj.relativeWeight.toFixed(2)})`;
    infoEl.textContent = `SMILES: ${smiles}`;

    render3DModel(currentSdfData);
  } catch (localErr) {
    badgeEl.className = "badge local";
    badgeEl.textContent = "錯誤";
    formulaEl.textContent = "—";
    infoEl.textContent = localErr.message;
  }
}

function parseSdfForRotation(sdfText) {
  const lines = sdfText.split(/\r?\n/);
  if (lines.length < 4) return null;

  const countsLine = lines[3];

  if (countsLine.includes("V3000")) {
    const parsedAtoms = [];
    const parsedBonds = [];
    let inAtomBlock = false;
    let inBondBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "M  V30 BEGIN ATOM") { inAtomBlock = true; continue; }
      if (trimmed === "M  V30 END ATOM") { inAtomBlock = false; continue; }
      if (trimmed === "M  V30 BEGIN BOND") { inBondBlock = true; continue; }
      if (trimmed === "M  V30 END BOND") { inBondBlock = false; continue; }

      if (inAtomBlock && trimmed.startsWith("M  V30 ")) {
        const parts = trimmed.slice(7).trim().split(/\s+/);
        parsedAtoms.push({
          idx: parseInt(parts[0], 10) - 1,
          el: parts[1],
          x: parseFloat(parts[2]),
          y: parseFloat(parts[3]),
          z: parseFloat(parts[4])
        });
      } else if (inBondBlock && trimmed.startsWith("M  V30 ")) {
        const parts = trimmed.slice(7).trim().split(/\s+/);
        parsedBonds.push({
          order: parseInt(parts[1], 10),
          a1: parseInt(parts[2], 10) - 1,
          a2: parseInt(parts[3], 10) - 1
        });
      }
    }
    return parsedAtoms.length > 0 ? { parsedAtoms, parsedBonds } : null;
  }

  const nAtoms = parseInt(countsLine.slice(0, 3).trim(), 10);
  const nBonds = parseInt(countsLine.slice(3, 6).trim(), 10);
  if (isNaN(nAtoms) || isNaN(nBonds)) return null;

  const parsedAtoms = [];
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[4 + i];
    if (!l) continue;
    parsedAtoms.push({
      idx: i,
      x: parseFloat(l.slice(0, 10)),
      y: parseFloat(l.slice(10, 20)),
      z: parseFloat(l.slice(20, 30)),
      el: l.slice(31, 34).trim()
    });
  }

  const parsedBonds = [];
  for (let i = 0; i < nBonds; i++) {
    const l = lines[4 + nAtoms + i];
    if (!l) continue;
    parsedBonds.push({
      a1: parseInt(l.slice(0, 3).trim(), 10) - 1,
      a2: parseInt(l.slice(3, 6).trim(), 10) - 1,
      order: parseInt(l.slice(6, 9).trim(), 10)
    });
  }

  return { parsedAtoms, parsedBonds };
}

function setupRotatableBonds(sdfText) {
  const box = document.getElementById("torsionBox");
  const select = document.getElementById("bondSelect");
  const slider = document.getElementById("torsionSlider");
  const angleLabel = document.getElementById("torsionAngleLabel");
  const statusEl = document.getElementById("torsionStatus");

  const parsed = parseSdfForRotation(sdfText);
  if (!parsed) {
    box.style.display = "none";
    return;
  }

  base3DAtoms = parsed.parsedAtoms;
  base3DBonds = parsed.parsedBonds;
  rotatableBonds = [];

  base3DBonds.forEach((b) => {
    if (b.order !== 1) return;
    const deg1 = base3DBonds.filter((x) => x.a1 === b.a1 || x.a2 === b.a1).length;
    const deg2 = base3DBonds.filter((x) => x.a1 === b.a2 || x.a2 === b.a2).length;
    if (deg1 < 2 || deg2 < 2) return;

    const groupB = getSubtreeAtoms(b.a2, b.a1);
    if (!groupB.has(b.a1)) {
      const atomA = base3DAtoms[b.a1];
      const atomB = base3DAtoms[b.a2];
      rotatableBonds.push({
        a1: b.a1,
        a2: b.a2,
        label: `${atomA.el}${b.a1 + 1} - ${atomB.el}${b.a2 + 1}`,
        movingIndices: Array.from(groupB)
      });
    }
  });

  if (rotatableBonds.length === 0) {
    box.style.display = "none";
    return;
  }

  select.innerHTML = "";
  rotatableBonds.forEach((rb, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `軸: ${rb.label}`;
    select.appendChild(opt);
  });

  slider.value = 0;
  angleLabel.textContent = "0°";
  statusEl.textContent = "初始能量最低構象 (Staggered)";
  box.style.display = "block";
}

function getSubtreeAtoms(startIdx, blockedIdx) {
  const visited = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length > 0) {
    const curr = queue.shift();
    base3DBonds.forEach((b) => {
      const next = b.a1 === curr ? b.a2 : b.a2 === curr ? b.a1 : null;
      if (next !== null && next !== blockedIdx && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    });
  }
  return visited;
}

function buildSdfFromAtoms(atomList, bondList) {
  const lines = [
    "MolView",
    "  Torsion3D",
    "",
    `${String(atomList.length).padStart(3)}${String(bondList.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`
  ];
  atomList.forEach((a) => {
    lines.push(
      `${a.x.toFixed(4).padStart(10)}${a.y.toFixed(4).padStart(10)}${a.z.toFixed(4).padStart(10)} ${a.el.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`
    );
  });
  bondList.forEach((b) => {
    lines.push(`${String(b.a1 + 1).padStart(3)}${String(b.a2 + 1).padStart(3)}${String(b.order).padStart(3)}  0  0  0  0`);
  });
  lines.push("M  END");
  return lines.join("\n");
}

function render3DModel(molData) {
  viewer3D.clear();
  viewer3D.addModel(molData, "sdf");
  apply3DStyle(document.getElementById("styleSelect").value);
  viewer3D.zoomTo();
  viewer3D.render();
  setupRotatableBonds(molData);
}

function apply3DStyle(styleType) {
  if (!viewer3D) return;
  if (styleType === "stick") {
    viewer3D.setStyle({}, { stick: { radius: 0.16 }, sphere: { scale: 0.26 } });
  } else if (styleType === "sphere") {
    viewer3D.setStyle({}, { sphere: {} });
  } else if (styleType === "line") {
    viewer3D.setStyle({}, { line: { linewidth: 2 } });
  }
  viewer3D.render();
}

function findSixMemberedRing() {
  const adj = new Map();
  atoms.forEach((a) => adj.set(a.id, []));
  bonds.forEach((b) => {
    if (adj.has(b.a1) && adj.has(b.a2)) {
      adj.get(b.a1).push(b.a2);
      adj.get(b.a2).push(b.a1);
    }
  });

  function dfs(startId, currId, path) {
    if (path.length === 6) {
      return adj.get(currId).includes(startId) ? path : null;
    }
    for (const nextId of adj.get(currId)) {
      if (!path.includes(nextId)) {
        const res = dfs(startId, nextId, [...path, nextId]);
        if (res) return res;
      }
    }
    return null;
  }

  for (const a of atoms) {
    const cycleIds = dfs(a.id, a.id, [a.id]);
    if (cycleIds) {
      return cycleIds.map((id) => atoms.find((atom) => atom.id === id));
    }
  }
  return null;
}

function moveSubstituents(rootId, movedSet, dx, dy) {
  const queue = [rootId];
  while (queue.length > 0) {
    const curr = queue.shift();
    bonds.forEach((b) => {
      const neighbor = b.a1 === curr ? b.a2 : b.a2 === curr ? b.a1 : null;
      if (neighbor && !movedSet.has(neighbor)) {
        movedSet.add(neighbor);
        const atomObj = atoms.find((a) => a.id === neighbor);
        if (atomObj) {
          atomObj.x += dx;
          atomObj.y += dy;
        }
        queue.push(neighbor);
      }
    });
  }
}
