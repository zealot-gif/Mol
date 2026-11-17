let jsmeApplet = null;
let viewer3D = null;
let currentSdfData = "";

// 1. 頁面載入後先啟動 3D 引擎
window.addEventListener("DOMContentLoaded", () => {
  init3DViewer();
  const defaultSmiles = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C";
  processMolecule(defaultSmiles, false);
});

// 2. JSME 載入完成後初始化（加入 noborder, noinfo 隱藏框線與黃色笑臉）
function jsmeOnLoad() {
  setTimeout(() => {
    jsmeApplet = new JSApplet.JSME("jsme_container", "100%", "100%", {
      options: "newlook,star,atommovebutton,noborder,noinfo",
      guicolor: "#1e293b"
    });
    jsmeApplet.readGenericMolecularInput("CN1C=NC2=C1C(=O)N(C(=O)N2C)C");
  }, 100);
}

function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#0f172a" });
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

  infoEl.textContent = "正在解析結構與生成 3D 空間座標...";

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

      badgeEl.className = "badge badge-cloud";
      badgeEl.textContent = "☁ PubChem 資料庫";
      formulaEl.textContent = `${props.MolecularFormula} (${props.MolecularWeight} g/mol)`;
      infoEl.textContent = `IUPAC 命名：${props.IUPACName || "無資料"}`;

      if (isName && jsmeApplet) {
        jsmeApplet.readGenericMolecularInput(currentSdfData);
      }
      render3DModel(currentSdfData);
      return;
    }

    if (!isName) {
      generateLocal3D(query);
    } else {
      throw new Error("資料庫找不到此名稱，請嘗試輸入 SMILES 或直接在左側繪製");
    }
  } catch (err) {
    if (!isName) {
      generateLocal3D(query);
    } else {
      badgeEl.className = "badge badge-local";
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
    if (!mol3D) throw new Error("無法為此結構生成有效的 3D 空間座標");

    currentSdfData = mol3D.toMolfileV3();

    const formulaObj = mol.getMolecularFormula();
    badgeEl.className = "badge badge-local";
    badgeEl.textContent = "⚡ 本地 3D 演算引擎";
    formulaEl.textContent = `${formulaObj.formula} (${formulaObj.relativeWeight.toFixed(2)} g/mol)`;
    infoEl.textContent = `自創／未收錄結構已於瀏覽器本地完成 3D 構象優化 ｜ SMILES: ${smiles}`;

    render3DModel(currentSdfData);
  } catch (localErr) {
    badgeEl.className = "badge badge-local";
    badgeEl.textContent = "格式錯誤";
    formulaEl.textContent = "—";
    infoEl.textContent = `結構解析失敗：${localErr.message}`;
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

// 一鍵從左側畫布讀取結構並轉成 3D
document.getElementById("syncBtn").addEventListener("click", () => {
  if (!jsmeApplet) return;
  const smiles = jsmeApplet.smiles();
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

document.querySelectorAll(".pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const smiles = btn.getAttribute("data-smiles");
    if (jsmeApplet) jsmeApplet.readGenericMolecularInput(smiles);
    processMolecule(smiles, false);
  });
});

document.getElementById("exportBtn").addEventListener("click", () => {
  if (!currentSdfData) return;
  const blob = new Blob([currentSdfData], { type: "chemical/x-mdl-sdfile" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "molecule_3d.sdf";
  a.click();
});
