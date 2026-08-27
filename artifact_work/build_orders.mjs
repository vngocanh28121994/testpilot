import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Users/tuoiha17/Downloads/Dat_LenhBE_Excel_Template.xlsx";
const outputDir = "/Users/tuoiha17/projects/testpilot/outputs/01a00f56-e1bf-76f3-b12f-a7f8b3488a9a";
const outputPath = `${outputDir}/Dat_LenhBE_500_Dong_BID.xlsx`;
const previewPath = `${outputDir}/Dat_LenhBE_500_Dong_BID_preview.png`;

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sheet = workbook.worksheets.getItem("DS_Dat_Lenh");
const sample = sheet.getRange("A5:L5").values[0];

const rows = [];
for (let i = 2; i <= 500; i += 1) {
  const price = (361 + Math.floor(Math.random() * 15)) / 10;
  const quantity = (1 + Math.floor(Math.random() * 20)) * 100;
  rows.push([i, sample[1], sample[2], sample[3], "BID", sample[5], price, quantity, sample[8], sample[9], sample[10], sample[11]]);
}

for (let row = 6; row <= 504; row += 1) {
  sheet.getRange(`A${row}:L${row}`).copyFrom(sheet.getRange("A5:L5"), "all");
}
sheet.getRange("A6:L504").values = rows;
sheet.getRange("G5:G504").format.numberFormat = "0.0";
sheet.getRange("H5:H504").format.numberFormat = "#,##0";
sheet.freezePanes.freezeRows(4);

const values = sheet.getRange("A5:L504").values;
if (values.length !== 500) throw new Error(`Expected 500 rows, got ${values.length}`);
for (let i = 0; i < values.length; i += 1) {
  const [stt, , , , symbol, , price, quantity] = values[i];
  if (stt !== i + 1) throw new Error(`Invalid STT at row ${i + 5}`);
  if (symbol !== "BID") throw new Error(`Invalid symbol at row ${i + 5}`);
  if (price < 36.1 || price > 37.5 || Math.round(price * 10) !== price * 10) throw new Error(`Invalid price at row ${i + 5}`);
  if (quantity < 100 || quantity > 2000 || quantity % 100 !== 0) throw new Error(`Invalid quantity at row ${i + 5}`);
}

const check = await workbook.inspect({
  kind: "table",
  range: "DS_Dat_Lenh!A4:L12",
  include: "values,formulas",
  tableMaxRows: 12,
  tableMaxCols: 12,
  maxChars: 6000,
});
console.log(check.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(`OUTPUT ${outputPath}`);
try {
  const preview = await workbook.render({ sheetName: "DS_Dat_Lenh", range: "A1:L15", scale: 1.5, format: "png" });
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));
} catch (error) {
  console.warn(`Preview render unavailable: ${error?.message ?? error}`);
}
console.log(`PREVIEW ${previewPath}`);
