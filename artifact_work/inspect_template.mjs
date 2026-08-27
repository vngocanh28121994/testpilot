import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Users/tuoiha17/Downloads/Dat_LenhBE_Excel_Template.xlsx";
const previewDir = "/Users/tuoiha17/projects/testpilot/tmp_spreadsheet_preview";
await fs.mkdir(previewDir, { recursive: true });
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region,computedStyle",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 20,
  tableMaxCellChars: 100,
});
console.log(summary.ndjson);
const sheets = workbook.worksheets.items;
for (const sheet of sheets) {
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1.5, format: "png" });
  const safe = sheet.name.replace(/[^a-z0-9_-]+/gi, "_");
  await fs.writeFile(`${previewDir}/${safe}.png`, new Uint8Array(await preview.arrayBuffer()));
  console.log(`PREVIEW ${sheet.name}: ${previewDir}/${safe}.png`);
}
