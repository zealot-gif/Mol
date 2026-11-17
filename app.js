let jsmeApplet;
let viewer3D;
let currentSdfData = "";

// 1. JSME 初始化
function jsmeOnLoad() {
  setTimeout(() => {
    jsmeApplet = new JSApplet.JSME("jsme_container", "100%", "100%", {
      // 加入 noinfo 隱藏左上角黃色笑臉與右側藍色 i 按鈕
      options: "newlook,star,atommovebutton,noinfo",
      guicolor: "#1e293b"
    });
    const defaultSmiles = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C";
    jsmeApplet.readGenericMolecularInput(defaultSmiles);
    init3DViewer();
    processMolecule(defaultSmiles, false);
  }, 100);
}

// 2. 初始化深色背景的 3Dmol 視窗
function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#0f172a" });
}

// 3. 核心雙引擎處理：優先查詢 PubChem，若無資料則自動切換為本地 3D 演算法
async function processMolecule(query, isName = false) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  infoEl.textContent = "正在解析結構與生成 3D 空間座標...";

  try {
    const type = isName ? "name" : "smiles";
    const encoded = encodeURIComponent(query);

    // 嘗試從 PubChem 取得 3D 結構
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

      // 若是名稱搜尋，同步把 2D 結構畫回左側畫布
      if (isName) {
        jsmeApplet.readGenericMolecularInput(currentSdfData);
      }
      render3DModel(currentSdfData);
      return;
    }

    // 若 PubChem 查無 3D 結構且輸入為 SMILES，啟動本地 OpenChemLib 3D 計算
    if (!isName) {
      generateLocal3D(query);
    } else {
      throw new Error("資料庫找不到此名稱，請嘗試輸入 SMILES 或直接在左側繪製");
    }
  } catch (err) {
    // 網路失敗或查無資料時的本地備援
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

// 4. 本地 3D 座標計算引擎 (使用 OpenChemLib ConformerGenerator)
function generateLocal3D(smiles) {
  const infoEl = document.getElementById("molInfo");
  const badgeEl = document.getElementById("sourceBadge");
  const formulaEl = document.getElementById("molFormula");

  try {
    const mol = OCL.Molecule.fromSmiles(smiles);
    mol.addImplicitHydrogens();

    // 使用本地構象演算法生成 3D 空間座標
    const generator = new OCL.ConformerGenerator(1);
    const mol3D = generator.getOneConformerAsMolecule(mol);
    if (!mol3D) throw new Error("無法為此結構生成有效的 3D 空間座標");

    currentSdfData = mol3D.toMolfileV3();

    // 本地計算分子式與精確分子量
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

// 5. 渲染 3D 模型
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

// 6. 事件綁定
document.getElementById("syncBtn").addEventListener("click", () => {
  const smiles = jsmeApplet.smiles();
  if (smiles) processMolecule(smiles, false);
});

document.getElementById("searchBtn").addEventListener("click", () => {
  const val = document.getElementById("searchInput").value.trim();
  if (val) processMolecule(val, true);
});

document.getElementById("searchInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") document.getElementById("searchBtn").click();
});

document.getElementById("styleSelect").addEventListener("change", (e) => {
  apply3DStyle(e.target.value);
});

document.querySelectorAll(".pill").forEach((btn) => {
  btn.addEventListener("click", () => {
    const smiles = btn.getAttribute("data-smiles");
    jsmeApplet.readGenericMolecularInput(smiles);
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
