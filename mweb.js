(function(){
'use strict';
if(location.search.includes('nomods=1'))return;

if('serviceWorker' in navigator){
  navigator.serviceWorker.getRegistrations().then(function(r){for(var i=0;i<r.length;i++)r[i].unregister();});
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
    f.push({name:name,path:'/'+name,offset:o,size:sz,enc:en});
  }
  return{files:f,raw:r};
},
_d:function(r,e){
  var o=[];
  for(var i=0;i<r.length;i++)o.push(r[i]^(((e+1)*7+i)&0xFF));
  return String.fromCharCode.apply(null,o);
}};

console.log('%c[mml]%c Initializing...','color:#60a5fa;font-weight:bold;font-size:14px','color:inherit');

var pollId = setInterval(function() {
  try {
    if (typeof Module !== 'undefined' && typeof Module['removeRunDependency'] === 'function') {
      clearInterval(pollId);
      console.log('%c[mml]%c Found Module.removeRunDependency! Installing patch...','color:#4ade80;font-weight:bold','color:inherit');
      
      var origRemove = Module['removeRunDependency'];
      Module['removeRunDependency'] = function(id) {
        if (id === 'index.data') {
          console.log('%c[mml]%c >>> index.data resolved! Patching NOW! <<<','color:#f472b6;font-weight:bold;font-size:14px','color:inherit');
          
          var byteArray = DataRequest.prototype.byteArray;
          
          if (!byteArray) {
            console.error('[mml] ERROR: DataRequest.prototype.byteArray not set yet!');
            return origRemove.call(this, id);
          }
          
          var base = R.parse(byteArray);
          
          var totalPatches = 0, corrupted = [];
          mods.forEach(function(mod) {
            var overrides = 0;
            mod.files.forEach(function(f) {
              var key = f.name.toLowerCase();
              for (var i = 0; i < base.files.length; i++) {
                if (base.files[i].name.toLowerCase() === key) {
                  var offset = base.files[i].offset;
                  var modData = mod.raw.subarray(f.offset, f.offset + f.size);
                  if (offset + modData.length > byteArray.byteLength) {
                    console.warn('[mml] WARNING: Mod file larger than base! Will corrupt next file: '+f.name);
                    corrupted.push(f.name);
                  } else {
                    byteArray.set(modData, offset);
                    overrides++;
                  }
                  break;
                }
              }
            });
          });
          
          mods = null;
          console.log('%c[mml]%c PATCHING COMPLETE!','color:#4ade80;font-weight:bold;font-size:14px','color:inherit');
          
        }
        
        return origRemove.call(this, id);
      };
    }
  } catch(e) {}
}, 10);

// ── UI ───────────────────────────────────────────────────────────
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
  if(!f.name.toLowerCase().endswith('.rsdk'))return;
  try{
    var b=await f.arrayBuffer(),r=R.parse(new Uint8Array(b));
    r._l=f.name.replace(/\.rsdk$/i,'');
    mods.push(r);
    console.log('[mml] Loaded: '+r._l+' ('+formatBytes(b.byteLength)+')');
  }catch(e){alert(f.name+': '+e.message);}
}

})();