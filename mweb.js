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
var baseFiles=null, modMap=new Map(), lastMatch=-1;

var R={
parse:function(b){
  var r=b instanceof Uint8Array?b:new Uint8Array(b),
      d=new DataView(r.buffer,r.byteOffset,r.byteLength),i;
  for(i=0;i<6;i++)if(r[i]!==MG[i])throw new Error('Invalid .rsdk');
  var n=d.getUint32(8,true),h=d.getUint32(12,true);
  var maxHash=Math.floor((r.length-16)/4);
  if(h>maxHash)h=0; 
  var p=16+h*4;
  if(p>=r.length)throw new Error('Invalid RSDK header');
  var f=[];
  for(var e=0;e<n;e++){
    var rn=[];while(r[p])rn.push(r[p++]);p=(p+4)&~3;
    if(p+28>r.length)break; 
    var sz=d.getUint32(p,true),o=d.getUint32(p+4,true),
        en=d.getUint32(p+8,true),md=r.slice(p+12,p+28);p+=28;
    f.push({name:this._d(rn,e),offset:o,size:sz,enc:en,md5:md});
  }
  return{files:f,raw:r};
},
_d:function(r,e){
  var o=[];
  for(var i=0;i<r.length;i++)o.push(r[i]^(((e+1)*7+i)&0xFF));
  return String.fromCharCode.apply(null,o);
}};

// ── The MML Architecture: Hook FS.read instead of merging ──
function hookFS(){
  var origCreate = FS.createDataFile;
  FS.createDataFile = function(){
    var res = origCreate.apply(this, arguments);
    if ((arguments[0]==='/Data.rsdk'||arguments[0]==='Data.rsdk')&&arguments[2] instanceof Uint8Array&&mods.length>0){
      try{
        // 1. Parse base file ONLY to get the offset map (fast, no data copying)
        baseFiles = R.parse(arguments[2]).files;
        
        // 2. Build mod map: lowercase path -> mod data slice
        mods.forEach(function(mod){
          mod.files.forEach(function(f){
            if(!modMap.has(f.name.toLowerCase())){
              modMap.set(f.name.toLowerCase(), mod.raw.subarray(f.offset, f.offset + f.size));
            }
          });
        });
        mods = null;
        console.log('%c[mml]%c Base indexed ('+baseFiles.length+' files). Mod map ready ('+modMap.size+' overrides).','color:#60a5fa;font-weight:bold','color:inherit');
      }catch(e){console.error('[mml] Index failed:',e);}
    }
    return res;
  };

  var origRead = FS.read;
  FS.read = function(stream, buffer, offset, length, position){
    // Only intercept reads from the base RSDK
    if(stream.path==='/Data.rsdk' && modMap.size>0 && baseFiles){
      var pos = position!==undefined ? position : stream.position;
      
      // Find which file the engine is trying to read
      var fIdx = lastMatch;
      if(fIdx>=0 && pos>=baseFiles[fIdx].offset && pos<baseFiles[fIdx].offset+baseFiles[fIdx].size){
        // Optimization: Still reading the same file as last time
      } else {
        // Find the file using offset bounds
        fIdx = -1;
        for(var i=0; i<baseFiles.length; i++){
          if(pos>=baseFiles[i].offset && pos<baseFiles[i].offset+baseFiles[i].size){
            fIdx = i; break;
          }
        }
        lastMatch = fIdx;
      }
      
      // If we found a file, check if we have a mod override
      if(fIdx!==-1){
        var file = baseFiles[fIdx];
        var modData = modMap.get(file.name.toLowerCase());
        if(modData){
          // Write mod data directly into the WASM heap buffer!
          var readOffset = pos - file.offset;
          var readLen = Math.min(length, modData.length - readOffset);
          if(readLen > 0){
            buffer.set(modData.subarray(readOffset, readOffset + readLen), offset);
          }
          return readLen;
        }
      }
    }
    return origRead.apply(this, arguments);
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
      if(!baseFiles && Module.FS && Module.FS.read) hookFS();
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
    console.log('[mml] Loaded: '+r._l+' ('+r.files.length+' files)');
  }catch(e){alert(f.name+': '+e.message);}
}

})();