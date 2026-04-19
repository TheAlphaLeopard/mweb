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
    var rn=[];while(r[p]&&p<r.length)rn.push(r[p++]);p=(p+4)&~3;
    if(p+28>r.length)break; 
    var sz=d.getUint32(p,true),o=d.getUint32(p+4,true),
        en=d.getUint32(p+8,true),md=r.slice(p+12,p+28);p+=28;
    var name=this._d(rn,e);
    f.push({name:name,offset:o,size:sz,enc:en,md5:md});
  }
  return{files:f,raw:r};
},
_d:function(r,e){
  var o=[];
  for(var i=0;i<r.length;i++)o.push(r[i]^(((e+1)*7+i)&0xFF));
  return String.fromCharCode.apply(null,o);
}};

console.log('%c[mml]%c Waiting for Emscripten FS...','color:#60a5fa;font-weight:bold','color:inherit');

var pollId = setInterval(function() {
  if (typeof FS !== 'undefined' && typeof FS.createDataFile === 'function') {
    clearInterval(pollId);
    console.log('%c[mml]%c FS found! Installing patch...','color:#4ade80;font-weight:bold','color:inherit');
    
    var origCreate = FS.createDataFile;
    FS.createDataPass = origCreate; // Backup original just in case
    
    FS.createDataFile = function(path, data, canRead, canWrite, canDelete, canOwn) {
      // MUST pass arguments explicitly. Emscripten's path.resolve() 
      // will crash if we pass the 'arguments' object directly.
      var res = origCreate(path, data, canRead, canWrite, canDelete, canOwn);
      
      if ((path==='/Data.rsdk'||path==='Data.rsdk') && data instanceof Uint8Array && mods.length > 0) {
        try {
          console.log('%c[mml]%c >>> /Data.rsdk INTERCEPTED <<<','color:#f472b6;font-weight:bold;font-size:14px','color:inherit');
          
          var node = FS.analyzePath('/Data.rsdk').node;
          if (!node) { console.error('[mml] ERROR: MEMFS node not found!'); return res; }
          
          var oldContents = node.contents;
          console.log('[mml] Node size: '+formatBytes(oldContents.byteLength));

          // SAFETY: Copy to prevent XHR GC from detaching buffer
          console.log('[mml] Detaching from XHR...');
          var contents = new Uint8Array(oldContents.byteLength);
          contents.set(oldContents);
          node.contents = contents;

          // Parse base to get file offsets
          console.log('[mml] Parsing offsets...');
          var base = R.parse(contents);

          // Patch!
          mods.forEach(function(mod) {
            console.log('[mml] Patching: '+mod._l);
            var overrides=0;
            
            mod.files.forEach(function(f) {
              var key = f.name.toLowerCase();
              for(var i=0;i<base.files.length;i++){
                if(base.files[i].name.toLowerCase() === key){
                  var baseOffset = base.files[i].offset;
                  var modData = mod.raw.subarray(f.offset, f.offset + f.size);
                  contents.set(modData, baseOffset);
                  overrides++;
                  break;
                }
              }
            });
            
            console.log('[mml] Applied '+overrides+' overrides.');
          });
          
          mods = null;
          console.log('%c[mml]%c SUCCESS! Megamix is now active in memory.','color:#4ade80;font-weight:bold;font-size:14px','color:inherit');
          
        } catch(e) {
          console.error('%c[mml]%c FATAL:','color:#f87171;font-weight:bold','color:inherit',e);
        }
      }
      
      return res;
    };
    
    // Restore normal behavior for all other files
    FS.createDataFile = origCreate;
  }
}, 10);

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
    console.log('[mml] Loaded: '+r._l+' ('+formatBytes(b.byteLength)+')');
  }catch(e){alert(f.name+': '+e.message);}
}

})();