// Copy the browser-global Pako build bundled with the installed xeokit SDK.
// Xeokit's XKT decoder uses window.pako.inflate for this model.
// This keeps the working local fix reproducible without committing node_modules.
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'node_modules/@xeokit/xeokit-sdk/src/plugins/XKTLoaderPlugin/parsers/lib/pako.js');
const target=resolve(root,'public/pako.js');
if(!existsSync(source)){
 console.error('Xeokit Pako runtime missing: '+source);
 console.error('Run npm ci to install dependencies, then retry.');
 process.exit(1);
}
mkdirSync(dirname(target),{recursive:true});
copyFileSync(source,target);
console.log('Prepared Xeokit browser Pako runtime in public/pako.js');
