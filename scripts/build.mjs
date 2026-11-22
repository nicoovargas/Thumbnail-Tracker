import {readFile,mkdir,writeFile} from 'node:fs/promises';
const assets={};
for (const [file,type] of Object.entries({'index.html':'text/html; charset=utf-8','app.js':'text/javascript; charset=utf-8','period-filter.mjs':'text/javascript; charset=utf-8','config.js':'text/javascript; charset=utf-8','styles.css':'text/css; charset=utf-8'})) assets['/'+file]={type,body:await readFile(new URL('../'+file,import.meta.url),'utf8')};
await mkdir(new URL('../build',import.meta.url),{recursive:true});
const declaration='const assets='+JSON.stringify(assets)+';';
await writeFile(new URL('../build/assets.mjs',import.meta.url),declaration+'\nexport {assets};\n');
const source=await readFile(new URL('../worker.mjs',import.meta.url),'utf8');
await writeFile(new URL('../build/worker.mjs',import.meta.url),source.replace("import { assets } from './build/assets.mjs';",() => declaration));
console.log('Worker y archivos de la página preparados.');
