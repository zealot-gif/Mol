let composer = null;
let viewer3D = null;
let currentSdfData = "";
let zoomPercent = 100;

window.addEventListener("DOMContentLoaded", () => {
  init3DViewer();

  const container = document.getElementById("kekule_canvas");
  composer = new Kekule.Editor.Composer(container);
  // 隱藏原生工具列，完全由我們自訂的懸浮島控制
  composer.setEnableToolbar(false);

  const resizeCanvas = () => {
    if (composer && container) {
      composer.setDimension(container.clientWidth + "px", container.clientHeight + "px");
    }
  };

  setTimeout(() => {
    resizeCanvas();
    const defaultSmiles = "COC(=O)C1CCC2CCCCC2C1=O"; // 與你截圖結構相近的雙環酯類
    loadSmilesToCanvas(defaultSmiles);
    processMolecule(defaultSmiles, false);
  }, 150);

  window.addEventListener("resize", resizeCanvas);
  bindFloatingTools();
});

function loadSmilesToCanvas(smiles) {
  if (!composer) return;
  try {
    const mol = OCL.Molecule.fromSmiles(smiles);
    const molfile = mol.toMolfile();
    const kekuleMol = Kekule.IO.loadFormatData(molfile, "mol");
    composer.setChemObj(kekuleMol);
  } catch (e) {
    console.warn("載入 2D 結構異常:", e);
  }
}

function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#0f172a" });
}

// 綁定原版 MolView 風格懸浮工具列
function bindFloatingTools() {
  // 頂部第二排：編輯動作
  document.querySelectorAll(".tool-icon").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-action");
      if (!composer) return;
      if (act === "undo") composer.undo();
      if (act === "redo") composer.redo();
      if (act === "clear") composer.newDoc();
      if (act === "erase") composer.setActiveIaControllerId("MolEraser");
      if (act === "select" || act === "lasso") composer.setActiveIaControllerId("MolSelect");
      if (act === "center") composer.scrollToObject(composer.getChemObj());
      if (act === "zoomIn") {
        composer.zoomIn();
        zoomPercent += 10;
        document.getElementById("zoomBadge").textContent = `${zoomPercent}%`;
      }
      if (act === "zoomOut") {
        composer.zoomOut();
        zoomPercent = Math.max(30, zoomPercent - 10);
        document.getElementById("zoomBadge").textContent = `${zoomPercent}%`;
      }
    });
  });

  // 左側工具島：鍵結、電荷與環狀模板
  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (!composer) return;

      const bond = btn.getAttribute("data-bond");
      const charge = btn.getAttribute("data-charge");
      const ring = btn.getAttribute("data-ring");

      if (bond) {
        composer.setActiveIaControllerId("MolBond");
      } else if (charge) {
        composer.setActiveIaControllerId("MolCharge");
      } else if (ring) {
        composer.setActiveIaControllerId("MolRing");
      }
    });
  });

  // 右側工具島：元素快選
  document.querySelectorAll(".atom-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".atom-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (!composer) return;
      composer.setActiveIaControllerId("MolAtom");
    });
  });

  // 切換單純 2D / 雙視窗模式
  document.getElementById("toggle3DBtn").addEventListener("click", (e) => {
    const viewerPane = document.getElementById("viewerPane");
    viewerPane.classList.toggle("hidden");
    e.target.classList.toggle("active");
    setTimeout(() => {
      const container = document.getElementById("kekule_canvas");
      composer.setDimension(container.clientWidth + "px", container.clientHeight + "px");
    }, 50);
  });
}

function handleUserQuery(input) {
  const trimmed = input.trim();
  if (!trimmed) return;
  const looksLikeSmiles = /^[A-Za-z0-9@+\-\[\]\(\)\\\/%=#$]+$/.test(trimmed) && /[=\(\)\[\]#1-9]/.test(trimmed);
  processMolecule(trimmed, !looksLikeSmiles);
}

async function processMolecule(query, isName = false) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  infoEl.textContent = "解析 3D 結構中...";

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

      if (isName && composer) {
        const kekuleMol = Kekule.IO.loadFormatData(currentSdfData, "sdf");
        composer.setChemObj(kekuleMol);
      }
      render3DModel(currentSdfData);
      return;
    }

    if (!isName) {
      generateLocal3D(query);
    } else {
      throw new Error("查無此化合物名稱");
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

document.getElementById("syncBtn").addEventListener("click", () => {
  if (!composer) return;
  const chemObj = composer.getChemObj();
  if (!chemObj) return;
  const molData = Kekule.IO.saveFormatData(chemObj, "mol");
  const oclMol = OCL.Molecule.fromMolfile(molData);
  const smiles = oclMol.toSmiles();
  if (smiles && smiles.trim() !== "") {
    processMolecule(smiles.trim(), false);
  }
});

document.getElementById("searchBtn").addEventListener("click", () => {
  handleUserQuery(document.getElementById("searchInput").value);
});

document.getElementById("searchInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleUserQuery(e.target.value);
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
