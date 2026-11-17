// === 分子與反應機構資料結構 ===
let atoms = [];  // { id, x, y, el, charge, lonePairs }
let bonds = [];  // { a1, a2, order }
let arrows = []; // { x1, y1, x2, y2 } (電子轉移彎箭頭)
let history = [];
let redoStack = [];

// 當前工具狀態
let currentMode = "bond"; // "bond" | "ring" | "charge" | "lonepair" | "arrow" | "erase"
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

let viewer3D = null;
let currentSdfData = "";

const ATOM_COLORS = {
  C: "#1e293b", H: "#475569", N: "#2563eb", O: "#dc2626",
  S: "#d97706", P: "#ea580c", F: "#16a34a", Cl: "#16a34a",
  Br: "#991b1b", I: "#7e22ce", B: "#be185d", Mg: "#059669", Li: "#7c3aed"
};

// 元素週期表資料 (符號, 週期 row, 族 col, 分類)
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
  setTimeout(() => loadSmilesTo2D(defaultSmiles), 100);
});

function buildPeriodicTable() {
  const grid = document.getElementById("ptGrid");
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
    const mol = OCL.Molecule.fromSmiles(smiles);
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

// === 繪製畫布（化學鍵 + 原子 + 孤電子對 + 電子轉移彎箭頭）===
function draw() {
  const rect = canvas.parentElement.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  ctx.save();
  ctx.translate(rect.width / 2, rect.height / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-rect.width / 2, -rect.height / 2);

  // 1. 化學鍵
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

  // 2. 化學鍵拖曳預覽
  if (dragStartAtom && dragPos) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    drawLine(dragStartAtom.x, dragStartAtom.y, dragPos.x, dragPos.y);
    ctx.setLineDash([]);
  }

  // 3. 原子與孤電子對 (Lone Pairs)
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

    // 繪製孤電子對 (成對黑點圍繞原子四個方位：上、右、下、左)
    if (a.lonePairs && a.lonePairs > 0) {
      drawLonePairs(a);
    }
  });

  // 4. 電子轉移彎箭頭 (Curved Arrows)
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
    { dx: 0, dy: -13, px: 2.6, py: 0 }, // 上
    { dx: 13, dy: 0, px: 0, py: 2.6 },  // 右
    { dx: 0, dy: 13, px: 2.6, py: 0 },  // 下
    { dx: -13, dy: 0, px: 0, py: 2.6 }  // 左
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

  // 計算二次貝茲曲線控制點（向上/外側彎曲）
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

  // 畫弧線
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();

  // 畫終點箭頭
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

canvas.addEventListener("mousemove", (e) => {
  const pos = getMousePos(e);
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
    hitAtom.lonePairs = ((hitAtom.lonePairs || 0) + 1) % 5; // 0 -> 1 -> 2 -> 3 -> 4 -> 0
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

canvas.addEventListener("mouseup", (e) => {
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

  // 週期表彈窗開關
  document.getElementById("openPtBtn").addEventListener("click", () => {
    document.getElementById("ptModal").classList.toggle("hidden");
  });
  document.getElementById("closePtBtn").addEventListener("click", () => {
    document.getElementById("ptModal").classList.add("hidden");
  });

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

  document.getElementById("searchInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const val = e.target.value.trim();
      if (!val) return;
      const isSmiles = /^[A-Za-z0-9@+\-\[\]\(\)\\\/%=#$]+$/.test(val) && /[=\(\)\[\]#1-9]/.test(val);
      processMolecule(val, !isSmiles);
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
}

function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#0f172a" });
}

async function processMolecule(query, isName = false) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  infoEl.textContent = "計算 3D 結構中...";

  try {
    const type = isName ? "name" : "smiles";
    const encoded = encodeURIComponent(query);

    const sdfRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${type}/${encoded}/SDF?record_type=3d`
    );

    if (sdfRes.ok) {
      currentSdfData = await sdfRes.text();
      const propRes = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${type}/${encoded}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`
      );
      const propData = await propRes.json();
      const props = propData.PropertyTable.Properties[0];

      badgeEl.className = "badge cloud";
      badgeEl.textContent = "☁ PubChem";
      formulaEl.textContent = `${props.MolecularFormula} (${props.MolecularWeight})`;
      infoEl.textContent = props.IUPACName || "";

      if (isName) loadSmilesTo2D(query);
      render3DModel(currentSdfData);
      return;
    }

    if (!isName) {
      generateLocal3D(query);
    } else {
      throw new Error("找不到此化合物");
    }
  } catch (err) {
    if (!isName) {
      generateLocal3D(query);
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

function render3DModel(molData) {
  viewer3D.clear();
  viewer3D.addModel(molData, "sdf");
  apply3DStyle(document.getElementById("styleSelect").value);
  viewer3D.zoomTo();
  viewer3D.render();
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
