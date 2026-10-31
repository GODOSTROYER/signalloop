import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
let failed=false;
for(const f of ['server','public','scripts','tests'].flatMap(walk).filter(f=>/\.(mjs|js)$/.test(f))){const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});if(r.status!==0)failed=true;}
if(failed)process.exit(1);console.log('All JavaScript modules passed syntax checks.');
