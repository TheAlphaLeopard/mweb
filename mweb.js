(function(){
'use strict';
if(location.search.includes('nomods=1'))return;

if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(r){
    for(var i=0;i<r.length;i++)r[i].unregister();
  });
}

var mods=[];
var MG=[0x52,0x53,0x44,0x4B,0x76,0x35];
function formatBytes(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB';}

var R={
parse:function(b){
  console.log('%c[mml][RSDK] Parsing buffer ('+formatBytes(b.byteLength)+')...','color:#60a5fa;font-weight:bold','color:inherit');
  var r=b instanceof Uint8Array?b:new Uint8Array(b),
      d=new DataView(r.buffer,r.byteOffset,r.byteLength),i;
      
  var magicStr='';for(i=0;i<6;i++) magicStr+=String.fromCharCode(r[i]);
  console.log('[mml][RSDK] Magic: "'+magicStr+'"');
  for(i=0;i<6;i++)if(r[i]!==MG[i])throw new Error('Invalid .rsdk (Got: "'+magicStr+'")');
      
  var n=d.getUint32(8,true),h=d.getUint32(12,true);
  console.log('[mml][RSDK] Files: '+n+', Hash Table Size: '+h);
      
  var maxHash=Math.floor((r.length-16)/4);
  if(h>maxHash){console.log('[mml][RSDK] Hash table too large, clamping to 0.');h=0;}
  var p=16+h*4;
  if(p>=r.length)throw new Error('Invalid RSDK header');
  console.log('[mml][RSDK] Directory starts at byte offset: '+p);
      
  var f=[];
  for(var e=0;e<n;e++){
    var rn=[];while(r[p]&&p<r.length)rn.push(r[p++]);p=(p+4)&~3;
    if(p+28>r.length)break; 
    var sz=d.getUint32(p,true),o=d.getUint32(p+4,true),
        en=d.getUint32(p+8,true),md=r.slice(p+12,p+28);p+=28;
    var name=this._d(rn,e);
    f.push({name:name,offset:o,size:sz,enc:en,md5:md});
    if(e<5) console.log('[mml][RSDK]   '+e+'. "'+name+'" @ offset '+o+' ('+formatBytes(sz)+')');
  }
  console.log('[mml][RSDK] Parsed '+f.length+' files successfully.');
  return{files:f,raw:r};
},
_d:function(r,e){
  var o=[];
  for(var i=0;i<r.length;i++)o.push(r[i]^(((e+1)*7+i)&0xFF));
  return String.fromCharCode.apply(null,o);
}};

// ── THE TRUE MML ARCHITECTURE ────────────────────────────────
function hookFS(){
  console.log('%c[mml]%c Waiting for Emscripten to write /Data.rsdk to MEMFS...','color:#60a5fa;font-weight:bold;font-size:14px','color:inherit');

  var origCreate = FS.createDataFile;
  FS.createDataFile = function(){
    var res = origCreate.apply(this, arguments);
    
    if ((arguments[0]==='/Data.rsdk'||arguments[0]==='Data.rsdk') && mods.length > 0) {
      try {
        console.log('[mml] >>> /Data.rsdk WRITE INTERCEPTED! <<<');
        
        // Get the MEMFS node directly
        var node = FS.analyzePath('/Data.rsdk').node;
        if (!node) { console.error('[mml] ERROR: Could not find MEMFS node!'); return res; }
        
        var oldContents = node.contents;
        console.log('[mml] Got MEMFS node. Type: '+(oldContents instanceof Uint8Array?'Uint8Array':typeof oldContents)+', Size: '+formatBytes(oldContents.byteLength));

        // CRITICAL SAFETY: Detach from the XHR ArrayBuffer. 
        // Emscripten might garbage-collect the XHR buffer later, which would
        // detach our Uint8Array and corrupt the game if we don't copy it now.
        console.log('[mml] Copying base data to new ArrayBuffer (safe from GC)...');
        var newBuffer = new ArrayBuffer(oldContents.byteLength);
        var contents = new Uint8Array(newBuffer);
        contents.set(oldContents);
        node.contents = contents; // Replace node contents with our safe copy!
        console.log('[mml] Safely detached from XHR buffer.');

        // 1. Parse base to get exact file offsets
        console.log('[mml] Parsing base file offsets...');
        var base = R.parse(contents);
        console.log('[mml] Base indexed: '+base.files.length+' files.');

        // 2. Apply mod patches IN-PLACE to the safe copy
        mods.forEach(function(mod, modIdx) {
          console.log('%c[mml]%c Processing mod "'+mod._l+'" ('+formatBytes(mod.raw.byteLength)+')...','color:#fbbf24;font-weight:bold','color:inherit');
          var overrides=0, skipped=0, corrupted=[];
          
          mod.files.forEach(function(f) {
            var key = f.name.toLowerCase();
            for(var i=0;i<base.files.length;i++){
              if(base.files[i].name.toLowerCase() === key){
                var baseOffset = base.files[i].offset;
                var baseSize = base.files[i].size;
                var modData = mod.raw.subarray(f.offset, f.offset + f.size);
                
                // OVERWRITE base bytes with mod bytes at the exact base offset!
                contents.set(modData, baseOffset);
                overrides++;
                
                if(modData.length > baseSize) {
                  corrupted.push(key+' ('+formatBytes(baseSize)+' -> '+formatBytes(modData.length)+')');
                  console.warn('[mml]   WARNING: Larger than base! (will overwrite next file): '+corrupted[corrupted.length-1]);
                }
                break;
              }
            }
          });
          
          console.log('[mml] "'+mod._l+'": '+overrides+' overrides applied, '+skipped+' new files skipped.');
          if(corrupted.length>0) console.warn('[mml] Total files larger than base: '+corrupted.length+' (MML accepts this behavior)');
        });
        
        mods = null; // Free mod memory
        console.log('%c[mml]%c PATCHING COMPLETE! All mods written directly into MEMFS node.','color:#4ade80;font-weight:bold;font-size:14px','color:inherit');
        console.log('[mml] The engine will now read the modded data naturally via standard FS.read().');
        
      } catch(e) {
        console.error('%c[mml]%c FATAL ERROR DURING PATCHING:','color:#f87171;font-weight:bold','color:inherit');
        console.error(e.stack || e.message);
      }
    }
    
    return res;
  };
}

window.Module=window.Module||{};
var _hk=false;
function hook(orig){
  if(_hk)return orig;_hk=true;
  return function(){
    var a=arguments;
    if((a[0]==='/Data.rsdk'||a[0]==='Data.rsdk')&&a[2] instanceof Uint8Array){
      var res=orig.apply(this,a);
      // Hook FS immediately after it's initialized
      if(Module.FS && Module.FS.createDataFile && Module.FS.analyzePath) hookFS();
      return res;
    }
    return orig.apply(this,a);
  };
}
try{
  Object.defineProperty(Module,'FS_createDataFile',{
    configurable:true,enumerable:true,
    get:function(){return this.__m;},
    set:function(f){this.__m=typeof f==='function'?hook(f):f;}
  });
}catch(e){
  if(typeof Module.FS_createDataFile==='function'&&!_hk)
    Module.FS_createDataFile=hook(Module.FS_createDataFile);
}

// ── UI ───────────────────────────────────────────────────────
var el=document.createElement('div');el.id='ml';
el.innerHTML=
'<style>'+
'#ml{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.92)}'+
'#ml.off{display:none}'+
'#b{background:#0a0a0a;border:1px solid #161616;border-radius:2px;padding:14px 16px;width:210px;font:11px/1.4 monospace;color:#2a2a2a}'+
'#dz{border:1px dashed #181818;padding:10px;text-align:center;cursor:pointer;color:#222;margin-bottom:5px}'+
'#dz:hover,#dz.ov{border-color:#4ade80;color:#4ade80}'+
'#ls{max-height:80px;overflow-y:auto;margin-bottom:7px}'+
'#ls:empty::after{content:"-";display:block;text-align:center;color:#161616;font-size:10px}'+
'.r{display:flex;justify-content:space-between;padding:1px 0;font-size:10px}'+
'.r span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:155px}'+
'.x{cursor:pointer;opacity:.12;color:#555}.x:hover{opacity:.5}'+
'#go{width:100%;padding:5px;background:#070707;border:1px solid #161616;border-radius:2px;color:#222;cursor:pointer;font:inherit;letter-spacing:.05em}'+
'#go:hover{border-color:#4ade80;color:#4ade80}'+
'</style>'+
'<div id="b"><div id="dz">drop .rsdk</div><div id="ls"></div><button id="go">launch</button></div>';
document.body.appendChild(el);

var ls=el.querySelector('#ls'),dz=el.querySelector('#dz');
var fi=document.createElement('input');fi.type='file';fi.accept='.rsdk';fi.multiple=true;fi.style.display='none';document.body.appendChild(fi);

function ren(){ls.innerHTML='';for(var i=0;i<mods.length;i++){var d=document.createElement('div');d.className='r';d.innerHTML='<span>'+mods[i]._l+'</span><span class="x" data-i="'+i+'">\u00d7</span>';ls.appendChild(d);}}
function go(){el.classList.add('off');}

el.querySelector('#go').onclick=go;
dz.onclick=function(){fi.click();};
fi.onchange=function(){if(fi.files.length)(async function(){for(var i=0;i<fi.files.length;i++)await af(fi.files[i]);ren();})();fi.value='';};
ls.onclick=function(e){if(e.target.classList.contains('x')){mods.splice(+e.target.dataset.i,1);ren();}};
dz.ondragover=function(e){e.preventDefault();dz.classList.add('ov');};
dz.ondragleave=function(){dz.classList.remove('ov');};
el.ondragover=function(e){e.preventDefault();};
el.ondrop=async function(e){
  e.preventDefault();dz.classList.remove('ov');
  var it=e.dataTransfer.items;if(!it)return;
  for(var i=0;i<it.length;i++){
    var en=it[i].webkitGetAsEntry&&it[i].webkitGetAsEntry();
    if(!en)continue;
    if(en.isFile)await af(await new Promise(function(r){en.file(r);}));
  }
  ren();
};

async function af(f){
  if(!f.name.toLowerCase().endsWith('.rsdk'))return;
  try{
    var b=await f.arrayBuffer(),r=R.parse(new Uint8Array(b));
    r._l=f.name.replace(/\.rsdk$/i,'');
    mods.push(r);
    console.log('[mml] Loaded: '+r._l+' ('+formatBytes(b.byteLength)+', '+r.files.length+' files)');
  }catch(e){alert(f.name+': '+e.message);}
}

})();