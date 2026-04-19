(function(){
'use strict';
if(location.search.includes('nomods=1'))return;

// Nuke ghost service workers and caches
if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(r){
    for(var i=0;i<r.length;i++)r[i].unregister();
  });
}
if(window.caches){
  window.caches.keys().then(function(n){
    for(var i=0;i<n.length;i++)window.caches.delete(n[i]);
  });
}

var mods=[];
var MG=[0x52,0x53,0x44,0x4B,0x76,0x35];
var R={
parse:function(b){
  var r=b instanceof Uint8Array?b:new Uint8Array(b),
      d=new DataView(r.buffer,r.byteOffset,r.byteLength),i;
  for(i=0;i<6;i++)if(r[i]!==MG[i])throw new Error('Invalid .rsdk');
  var n=d.getUint32(8,true),h=d.getUint32(12,true),p=16+h*4,f=[];
  if(p>=r.length)throw new Error('Invalid RSDK header');
  for(var e=0;e<n;e++){
    var rn=[];while(r[p])rn.push(r[p++]);p=(p+4)&~3;
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

function strip(files){
  if(!files.length)return[];
  var p=files[0].path,i;
  for(i=1;i<files.length;i++){while(p&&!files[i].path.startsWith(p))p=p.slice(0,-1);}
  var s=p.lastIndexOf('/');p=s!==-1?p.substring(0,s+1):'';
  var out=[];
  for(i=0;i<files.length;i++){
    var r=files[i].path.substring(p.length);
    if(r&&!r.endsWith('/'))out.push({name:'/'+r,data:files[i].data});
  }
  return out;
}

function walk(en,path,out){
  return new Promise(function(ok){
    if(en.isFile){en.file(function(f){out.push({file:f,path:path+f.name});ok();});}
    else if(en.isDirectory){
      var rd=en.createReader();
      (function q(){rd.readEntries(function(b){if(!b.length)ok();else Promise.all(b.map(function(e){return walk(e,path+en.name+'/',out);})).then(q);});})();
    }else ok();
  });
}

// Inject mods natively into MEMFS
function injectMods(){
  if(!mods||!mods.length)return;
  try{
    var FS=Module.FS;
    mods.forEach(function(mod,idx){
      var dir='Mods/mod'+idx;
      
      mod.files.forEach(function(f){
        // Map exactly to the mod's internal folder structure
        var fullPath = dir + f.name; 
        var parts = fullPath.split('/');
        parts.pop(); // remove filename
        var fDir = parts.join('/');
        
        if(fDir) FS.createPath('/', fDir, true, true);
        
        var data=mod.raw?mod.raw.subarray(f.offset,f.offset+f.size):f.data;
        FS.createDataFile(fullPath, null, data, true, true, true);
      });

      // Engine strictly requires mod.ini in the mod root to load it
      var hasIni = mod.files.some(function(f){ return f.name.toLowerCase() === '/mod.ini'; });
      if(!hasIni){
         var ini="[Mod]\r\nName="+mod._l+"\r\nVersion=1.0.0\r\n";
         FS.createDataFile(dir+'/mod.ini',null,new TextEncoder().encode(ini),true,true,true);
      }
    });
    mods=null;
    console.log('%c[mml]%c mods injected','color:#4ade80;font-weight:bold','color:inherit');
  }catch(e){console.error('[mml]',e);}
}

window.Module=window.Module||{};
var _hk=false;
function hook(orig){
  if(_hk)return orig;_hk=true;
  return function(){
    var res=orig.apply(this,arguments);
    if(arguments[0]==='/Data.rsdk'||arguments[0]==='Data.rsdk')injectMods();
    return res;
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
'#fd{display:block;text-align:center;font-size:9px;color:#181818;margin-bottom:7px;cursor:pointer}'+
'#fd:hover{color:#4ade80}'+
'#ls{max-height:80px;overflow-y:auto;margin-bottom:7px}'+
'#ls:empty::after{content:"-";display:block;text-align:center;color:#161616;font-size:10px}'+
'.r{display:flex;justify-content:space-between;padding:1px 0;font-size:10px}'+
'.r span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:155px}'+
'.x{cursor:pointer;opacity:.12;color:#555}.x:hover{opacity:.5}'+
'#go{width:100%;padding:5px;background:#070707;border:1px solid #161616;border-radius:2px;color:#222;cursor:pointer;font:inherit;letter-spacing:.05em}'+
'#go:hover{border-color:#4ade80;color:#4ade80}'+
'</style>'+
'<div id="b"><div id="dz">drop .rsdk or Data idk/</div><a id="fd">pick folder</a><div id="ls"></div><button id="go">launch</button></div>';
document.body.appendChild(el);

var ls=el.querySelector('#ls'),dz=el.querySelector('#dz');
var fi=document.createElement('input');fi.type='file';fi.accept='.rsdk';fi.multiple=true;fi.style.display='none';document.body.appendChild(fi);
var di=document.createElement('input');di.type='file';di.webkitdirectory=true;di.style.display='none';document.body.appendChild(di);

function ren(){ls.innerHTML='';for(var i=0;i<mods.length;i++){var d=document.createElement('div');d.className='r';d.innerHTML='<span>'+mods[i]._l+'</span><span class="x" data-i="'+i+'">\u00d7</span>';ls.appendChild(d);}}

function go(){
  el.classList.add('off');
  setTimeout(function(){
    var s=document.createElement('script');s.src='index.js';document.body.appendChild(s);
  }, 10);
}

el.querySelector('#go').onclick=go;
dz.onclick=function(){fi.click();};
el.querySelector('#fd').onclick=function(e){e.preventDefault();di.click();};
fi.onchange=function(){if(fi.files.length)(async function(){for(var i=0;i<fi.files.length;i++)await af(fi.files[i]);ren();})();fi.value='';};
di.onchange=function(){
  if(!di.files.length)return;
  var files=Array.from(di.files).map(function(f){return{file:f,path:f.webkitRelativePath};});
  adf(files,files[0].path.split('/')[0]);di.value='';
};
ls.onclick=function(e){if(e.target.classList.contains('x')){mods.splice(+e.target.dataset.i,1);ren();}};
dz.ondragover=function(e){e.preventDefault();dz.classList.add('ov');};
dz.ondragleave=function(){dz.classList.remove('ov');};
el.ondragover=function(e){e.preventDefault();};
el.ondrop=async function(e){
  e.preventDefault();dz.classList.remove('ov');
  var it=e.dataTransfer.items;if(!it)return;
  for(var i=0;i<it.length;i++){
    var en=it[i].webkitGetAsEntry&&it[i].webkitGetAsEntry();
    if(!en){var f=it[i].getAsFile();if(f)await af(f);continue;}
    if(en.isFile)await af(await new Promise(function(r){en.file(r);}));
    else if(en.isDirectory){var c=[];await walk(en,'',c);adf(c,c[0]?c[0].path.split('/')[0]:'mod');}
  }
  ren();
};

async function af(f){
  if(!f.name.toLowerCase().endsWith('.rsdk'))return;
  try{var b=await f.arrayBuffer(),r=R.parse(new Uint8Array(b));r._l=f.name.replace(/\.rsdk$/i,'');mods.push(r);}
  catch(e){alert(f.name+': '+e.message);}
}

async function adf(fl,lb){
  try{
    var bs=await Promise.all(fl.map(function(f){
      return f.file.arrayBuffer().then(function(b){return{path:f.path,data:new Uint8Array(b)};});
    }));
    var ent=strip(bs);if(!ent.length)throw new Error('empty folder');
    
    // Smart fix: If user uploaded the Data/ folder directly, prepend /Data
    var hasData = ent.some(function(f){ return f.name.startsWith('/Data/'); });
    if(!hasData && (ent.some(function(f){ return f.name.startsWith('/Game/'); }) || ent.some(function(f){ return f.name.startsWith('/Sprites/'); }))) {
      ent.forEach(function(f){ f.name = '/Data' + f.name; });
    }
    
    mods.push({files:ent,_l:lb||'mod',raw:null});
  }catch(e){alert(e.message);}
  ren();
}

})();