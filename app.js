let jsmeApplet;
let viewer3D;
let currentSdfData = "";

// 1. JSME 載入完成後自動觸發的初始化函式
function jsmeOnLoad() {
  jsmeApplet = new JSApplet.JSME("jsme_container", "100%", "100%", {
    options: "oldlook,star,atommovebutton"
  });
  // 預設載入咖啡因 (Caffeine) 結構
  jsmeApplet.readGenericMolecularInput("CN1C=NC2=C1C(=O)N(C(=O)N2C)C");
  init3DViewer();
  convertSmilesTo3D("CN1C=NC2=C1C(=O)N(C(=O)N2C)C");
}

// 2. 初始化 3Dmol 視窗
function init3DViewer() {
  viewer3D = $3Dmol.createViewer("viewer_3d", { backgroundColor: "#f8fafc" });
}

// 3. 透過 PubChem API 將 SMILES 或名稱轉為 3D SDF 並渲染
async function convertSmilesTo3D(query, isName = false) {
  const infoEl = document.getElementById("molInfo");
  infoEl.textContent = "正在計算 3D 結構與查詢資料...";

  try {
    const type = isName ? "name" : "smiles";
    const encoded = encodeURIComponent(query);

    // 取得 3D SDF 結構
    const sdfRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${type}/${encoded}/SDF?record_type=3d`
    );
    if (!sdfRes.ok) throw new Error("資料庫無此分子的 3D 結構，請嘗試常見化合物");
    currentSdfData = await sdfRes.text();

    // 取得分子式與分子量
    const propRes = await fetch(
      `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${type}/${encoded}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`
    );
    const propData = await propRes.json();
    const props = propData.PropertyTable.Properties[0];

    infoEl.innerHTML = `分子式：<b>${props.MolecularFormula}</b> ｜ 分子量：<b>${props.MolecularWeight} g/mol</b> ｜ IUPAC：${props.IUPACName}`;
    render3DModel(currentSdfData);
  } catch (err) {
    infoEl.textContent = `錯誤：${err.message}`;
  }
}

// 4. 在 3D 視窗繪製模型
function render3DModel(sdf) {
  viewer3D.clear();
  viewer3D.addModel(sdf, "sdf");
  apply3DStyle(document.getElementById("styleSelect").value);
  viewer3D.zoomTo();
  viewer3D.render();
}

function apply3DStyle(styleType) {
  if (!viewer3D) return;
  if (styleType === "stick") {
    viewer3D.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.25 } });
  } else if (styleType === "sphere") {
    viewer3D.setStyle({}, { sphere: {} });
  } else if (styleType === "line") {
    viewer3D.setStyle({}, { line: {} });
  }
  viewer3D.render();
}

// 5. 綁定按鈕事件
document.getElementById("syncBtn").addEventListener("click", () => {
  const smiles = jsmeApplet.smiles();
  if (smiles) convertSmilesTo3D(smiles, false);
});

document.getElementById("searchBtn").addEventListener("click", () => {
  const val = document.getElementById("searchInput").value.trim();
  if (val) convertSmilesTo3D(val, true);
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
