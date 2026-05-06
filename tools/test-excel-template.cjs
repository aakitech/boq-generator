const jiti = require("jiti")(__filename, { interopDefault: true });
const { generateBOQExcelFromTemplate } = jiti("../lib/excel-template.ts");
const fs = require("fs");
const path = require("path");

const boq = {
  project: "Test School Project",
  location: "Lusaka",
  prepared_by: "Brighton T",
  date: "2026-05-05",
  bills: [
    {
      number: 1,
      title: "Substructure",
      items: [
        { description: "EARTHWORKS", unit: "", qty: null, rate: null, amount: null, is_header: true },
        { description: "Excavate in pickable material for foundation trenches", unit: "m³", qty: 45, rate: 380, amount: null, is_header: false, note: "" },
        { description: "Concrete Grade 25 in foundations", unit: "m³", qty: 12, rate: 2800, amount: null, is_header: false, note: "" },
      ],
    },
    {
      number: 2,
      title: "Superstructure",
      items: [
        { description: "Brickwork in cement mortar", unit: "m²", qty: 200, rate: 450, amount: null, is_header: false, note: "" },
        { description: "Roof structure — timber trusses", unit: "m²", qty: 150, rate: 1200, amount: null, is_header: false, note: "" },
      ],
    },
  ],
};

generateBOQExcelFromTemplate(boq)
  .then((buf) => {
    const out = path.join(__dirname, "spike", "test-template-output.xlsx");
    fs.writeFileSync(out, buf);
    console.log("Written:", out, `(${buf.length} bytes)`);
  })
  .catch((e) => console.error(e));
