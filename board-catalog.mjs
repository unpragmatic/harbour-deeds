// The build and release-engine tests both consume this compiler; the browser only
// needs its self-contained output. File paths in the manifest are relative to web/.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const web=new URL('./web/',import.meta.url);
const readSource=name=>JSON.parse(readFileSync(new URL(name,web),'utf8'));
const check=(condition,message)=>{if(!condition)throw Error(message)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim().length>0;
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9-]*$/.test(x);
const integer=(x,min)=>Number.isSafeInteger(x)&&x>=min;

function perimeter(layout,count){
  check(object(layout),'missing perimeter layout');
  const {rows,columns,start,direction,density,foldColumns}=layout;
  check(integer(rows,3)&&integer(columns,3)&&2*(rows+columns)-4===count,
    `perimeter ${rows}×${columns} must fit exactly ${count} spaces (including an interior)`);
  check(['clockwise','counterclockwise'].includes(direction),'invalid perimeter direction');
  check(['spacious','regular','dense'].includes(density),'invalid tile density');
  check(integer(foldColumns,1)&&foldColumns<=count,'invalid folded route columns');
  const corners={'top-left':0,'top-right':columns-1,'bottom-right':columns+rows-2,'bottom-left':2*columns+rows-3};
  check(typeof start==='string'&&Object.hasOwn(corners,start),'invalid starting corner');
  const cells=[];
  for(let col=1;col<=columns;col++)cells.push([1,col]);
  for(let row=2;row<=rows;row++)cells.push([row,columns]);
  for(let col=columns-1;col>=1;col--)cells.push([rows,col]);
  for(let row=rows-1;row>1;row--)cells.push([row,1]);
  return {...layout,positions:cells.map((_,i)=>cells[(corners[start]+(direction==='clockwise'?i:-i)+count)%count])};
}

// A standalone file is a complete rules object. An extending file replaces
// top-level fields, optionally inserting spaces or replacing just the level costs.
function compose(source,parent){
  check(object(source),'rules file must be an object');
  const {inserts,development_cost_pct:costs,...overrides}=source;
  const rules={...parent,...overrides};
  if(inserts!==undefined){
    check(Array.isArray(inserts)&&Array.isArray(rules.tiles),'invalid tile inserts');
    const additions=new Map();
    for(const row of inserts){
      check(row&&text(row.after)&&Array.isArray(row.tiles)&&row.tiles.length>0&&
        !additions.has(row.after)&&rules.tiles.filter(t=>t.name===row.after).length===1,
        `insert needs one unambiguous anchor: ${row?.after}`);
      additions.set(row.after,row.tiles);
    }
    rules.tiles=rules.tiles.flatMap(t=>[t,...additions.get(t.name)??[]]);
  }
  if(costs!==undefined){
    check(Array.isArray(costs)&&costs.length===rules.development?.levels?.length,
      'supply a construction cost for every level');
    rules.development={...rules.development,levels:rules.development.levels.map((l,i)=>({...l,cost_pct:costs[i]}))};
  }
  return rules;
}

function engineValidator(){
  const wasm=readFileSync(new URL('./target/wasm32-unknown-unknown/release/harbor_deeds.wasm',import.meta.url));
  const e=new WebAssembly.Instance(new WebAssembly.Module(wasm)).exports;
  return rules=>{
    const bytes=Buffer.from(JSON.stringify({action:'start',rules,seed:1,seats:2}));
    const ptr=e.reserve(bytes.length);
    new Uint8Array(e.memory.buffer,ptr,bytes.length).set(bytes);
    const out=e.dispatch(),state=JSON.parse(Buffer.from(e.memory.buffer,out,e.length()).toString());
    check(!state.error,state.error);
  };
}

export function loadCatalog(read=readSource){
  const file=name=>{
    check(typeof name==='string'&&/^[a-z0-9][a-z0-9-]*\.json$/.test(name),`invalid web JSON filename: ${name}`);
    return read(name);
  };
  const manifest=file('boards.json'),prints=file('district-prints.json');
  const palette=Object.values(prints);
  check(palette.every(p=>p&&/^[A-Z]{2}$/.test(p.code)&&text(p.path)&&integer(p.width,1)&&
    [p.stock,p.ink].every(color=>/^#[a-f0-9]{6}$/i.test(color)))&&
    ['code','path'].every(key=>new Set(palette.map(p=>p[key])).size===palette.length),
    'every district print needs a width, stock/ink colors, unique path and unique two-letter code');
  const validateEngine=engineValidator();
  function compile({label,layout},rules){
    check(text(label),'missing board label');
    check(Array.isArray(rules.tiles)&&rules.tiles.every(t=>text(t?.name)),'every space needs a name');
    for(const t of rules.tiles)if(t.kind==='deed'){
      check(text(t.group)&&Object.hasOwn(prints,t.group),`missing district print for ${t.group}`);
    }
    check(integer(rules.rounds,1)&&rules.rounds<=200,'round limit must be 1–200');
    check(['even','district','free'].includes(rules.development?.policy),'missing or invalid development policy');
    const geometry=perimeter(layout,rules.tiles.length);
    validateEngine(rules);
    return {label,layout:geometry,rules};
  }
  check(id(manifest.edition)&&Array.isArray(manifest.boards)&&manifest.boards.length,'invalid board manifest');
  const entries=new Map();
  for(const entry of manifest.boards){
    check(id(entry?.id)&&!entries.has(entry.id),`invalid or duplicate board ID: ${entry?.id}`);
    entries.set(entry.id,entry);
  }
  check(entries.has(manifest.defaultBoard),'defaultBoard must be a registered ID');
  const cache=new Map(),resolving=new Set();
  function resolve(key){
    if(cache.has(key))return cache.get(key);
    check(!resolving.has(key),`board inheritance cycle at ${key}`);
    const entry=entries.get(key);check(entry,`unknown parent board: ${key}`);
    resolving.add(key);
    try{
      const parent=entry.extends===undefined?undefined:resolve(entry.extends).rules;
      const board=compile(entry,compose(file(entry.file),parent));cache.set(key,board);
      return board;
    }catch(e){throw Error(`${key} (${entry.file}): ${e.message}`)}
    finally{resolving.delete(key)}
  }
  const boards=Object.fromEntries([...entries.keys()].map(k=>[k,resolve(k)]));
  const history=Object.create(null);
  check(object(manifest.history),'missing replay history');
  for(const [edition,archive] of Object.entries(manifest.history)){
    check(id(edition)&&edition!==manifest.edition&&typeof archive?.charter==='boolean',`invalid archive: ${edition}`);
    const snapshot=file(archive.file),metadata=file(archive.metadata);
    const archived=Object.entries(snapshot).map(([k,rules])=>{
      check(id(k)&&Object.hasOwn(metadata,k),`${edition}: missing board metadata for ${k}`);
      try{return [k,compile(metadata[k],rules)]}catch(e){throw Error(`${edition}/${k}: ${e.message}`)}
    });
    history[edition]={charter:archive.charter,boards:Object.fromEntries(archived)};
  }
  return {catalog:{edition:manifest.edition,defaultBoard:manifest.defaultBoard,boards,history},prints};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  console.log(JSON.stringify(loadCatalog()));
