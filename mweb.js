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
},
merge:function(base,ml){
  var map=new Map(),i,j,overwrites=0;
  for(i=0;i<base.files.length;i++)map.set(base.files[i].name.toLowerCase(),{e:base.files[i],s:base.raw});
  for(i=0;i<ml.length;i++)
    for(j=0;j<ml[i].files.length;j++){
      var mf=ml[i].files[j],k=mf.name.toLowerCase(),ex=map.get(k);
      if(ex){map.set(k,{e:{name:ex.e.name,offset:mf.offset,size:mf.size,enc:mf.enc,md5:mf.md5},s:ml[i].raw});overwrites++;}
      else map.set(k,{e:mf,s:ml[i].raw});
    }
  var items=[];for(var v of map.values())items.push(v);
  var n=items.length,hs=16;
  for(i=0;i<n;i++){hs+=items[i].e.name.length+1;hs=(hs+3)&~3;hs+=28;}
  var doff=hs;for(i=0;i<n;i++)items[i].no=doff,doff+=items[i].e.size;
  var out=new Uint8Array(doff),dv=new DataView(out.buffer);
  out.set(base.raw.subarray(0,8),0);dv.setUint32(8,n,true);dv.setUint32(12,0,true);
  var p=16;
  for(i=0;i<n;i++){
    var e=items[i].e;
    for(j=0;j<e.name.length;j++)out[p++]=e.name.charCodeAt(j)^(((i+1)*7+j)&0xFF);
    out[p++]=0;p=(p+3)&~3;
    dv.setUint32(p,e.size,true);p+=4;dv.setUint32(p,items[i].no,true);p+=4;
    dv.setUint32(p,e.enc,true);p+=4;out.set(e.md5,p);p+=16;
  }
  for(i=0;i<n;i++){var it=items[i];out.set(it.s.subarray(it.e.offset,it.e.offset+it.e.size),it.no);}
  console.log('%c[mml]%c Merge complete: '+base.files.length+' base + '+overwrites+' mod overwrites = '+n+' total files','color:#60a5fa;font-weight:bold','color:inherit');
  return out;
}};

window.Module=window.Module||{};
var _hk=false;
function hook(orig){
  if(_hk)return orig;_hk=true;
  return function(){
    var a=arguments;
    if((a[0]==='/Data.rsdk'||a[0]==='Data.rsdk')&&mods&&mods.length&&a[2] instanceof Uint8Array){
      var baseData=a[2];
      var res=orig.apply(this,a);
      try{
        console.log('%c[mml]%c Base RSDK intercepted ('+formatBytes(baseData.byteLength)+'). Parsing...','color:#fbbf24;font-weight:bold','color:inherit');
        var base=R.parse(baseData);
        console.log('%c[mml]%c Base parsed: '+base.files.length+' files. Merging '+mods.length+' mods...','color:#fbbf24;font-weight:bold','color:inherit');
        var merged=R.merge(base,mods);
        mods=null;
        Module.FS.writeFile('/Data.rsdk', merged);
        console.log('%c[mml]%c SUCCESS! VFS overwritten with '+(merged.byteLength/1048576).toFixed(1)+'MB','color:#4ade80;font-weight:bold','color:inherit');
      }catch(e){
        console.error('%c[mml]%c FATAL ERROR DURING MERGE:','color:#f87171;font-weight:bold','color:inherit', e);
      }
      return res;
    }
    return orig.apply(this,a);
  };
}
function formatBytes(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';return(b/1048576).toFixed(1)+'MB';}

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
    console.log('[mml] Loaded mod: '+r._l+' ('+formatBytes(b.byteLength)+', '+r.files.length+' files)');
  }catch(e){alert(f.name+': '+e.message);}
}

})();