import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convert2xkt } from "@xeokit/xeokit-convert";
import * as WebIFC from "web-ifc";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const source = path.join(
  projectRoot,
  "public",
  "models",
  "Snowdon_Level5_Model+HVAC.ifc"
);

const output = path.join(
  projectRoot,
  "public",
  "models",
  "Snowdon_Level5_Model+HVAC.xkt"
);

if (!fs.existsSync(source)) {
  console.error("IFC file not found:");
  console.error(source);
  process.exit(1);
}

// IFC-to-XKT converts the file as exported; it does not strip unwanted floors.
// Report declared building storeys so a multi-floor export isn't mislabelled as Level 5.
const ifcText = fs.readFileSync(source, "utf8");
const storeyNames = [...ifcText.matchAll(/#\d+\s*=\s*IFCBUILDINGSTOREY\s*\(\s*'[^']*'\s*,\s*[^,]*\s*,\s*'([^']*)'/gi)].map(match => match[1]);
if (storeyNames.length) {
  console.log("Declared IFC storeys:", [...new Set(storeyNames)].join(", "));
  console.log("Confirm the exported geometry is Level 5 only; XKT conversion will not crop other floors.");
} else {
  console.log("No IFC storey names detected by the basic metadata check. Verify visually.");
}
console.log("Converting IFC -> XKT...");
console.log("Source:", source);
console.log("Output:", output);

try {
  await convert2xkt({
    WebIFC,
    source,
    output,
    log: (msg) => console.log(msg)
  });

  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new Error("Converter reported success but no nonempty XKT output was found");
  }
  console.log("Conversion complete.");
  console.log("Output XKT size:", (fs.statSync(output).size / (1024 * 1024)).toFixed(2), "MiB");
  console.log("Viewer model URL: /models/Snowdon_Level5_Model+HVAC.xkt");
} catch (error) {
  console.error("Conversion failed:");
  console.error(error);
  process.exit(1);
}
