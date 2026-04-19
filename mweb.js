(function(){
'use strict';
if(location.search.includes('nomods=1'))return;

var mods=[];
var MG=[0x52,0x53,0x44,0x4B,0x76,0x35];
var R={
parse:function(b){
  var r=b instanceof Uint8Array?b:new Uint8Array(b),
      d=new DataView(r.buffer,r.byteOffset,r.byteLength),i;
  for(i=0;i<6;i++)if(r[i]!==MG[i])throw new Error('Invalid .rsdk');
  var n=d.getUint32(8,true), p=this._findDir(r), f=[];
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
},
// Fingerprint scanner: bypass hash table completely by searching
// for the encrypted '/' character (0x28 for entry 0, 0x21 for entry 1)
_findDir:function(r) {
  var limit = Math.min(r.length, 50 * 1024 * 1024);
  for (var i = 16; i < limit; i++) {
    if (r[i] === 0x28 && this._validDirStart(r, i)) return i;
  }
  return 16;
},
_validDirStart:function(r, start) {
  if (!this._validEntry(r, start, 0)) return false;
  var end = start;
  while (r[end] !== 0) end++;
  end = (end + 1 + 3) & ~3;
  end += 28;
  if (end < r.length && r[end] === 0x21 && this._validEntry(r, end, 1)) return true;
  return false;
},
_validEntry:function(r, start, idx) {
  if (start >= r.length - 28) return false;
  if (r[start] === 0) return false;
  var end = start;
  while (end < r.length && r[end] !== 0) end++;
  if (end === start || end >= r.length) return false;
  var name = this._d(r.slice(start, end), idx);
  if (!name || !name.startsWith('/') || name.length < 2 || name.length > 200) return false;
  for (var i = 0; i < name.length; i++) {
    var c = name.charCodeAt(i);
    if(!((c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===46||c===47||c===95||c===45||c===32||c===43)) return false;
  }
  return true;
},
build:function(entries){
  var n=entries.length;if(!n)return{files:[],raw:new Uint8Array(0)};
  var hs=16,i;for(i=0;i<n;i++){hs+=entries[i].path.length+1;hs=(hs+3)&~3;hs+=28;}
  var doff=hs,inf=[];
  for(i=0;i<n;i++){
    var dl=entries[i].data.byteLength;
    inf.push({name:entries[i].path,offset:doff,size:dl,enc:0,md5:new Uint8Array(16)});
    doff+=dl;
  }
  var out=new Uint8Array(doff),dv=new DataView(out.buffer);
  out.set(MG,0);dv.setUint32(8,n,true);dv.setUint32(12,0,true);
  var p=16;
  for(i=0;i<n;i++){
    var nm=entries[i].path;
    for(var j=0;j<nm.length;j++)out[p++]=nm.charCodeAt(j)^(((i+1)*7+j)&0xFF);
    out[p++]=0;p=(p+3)&~3;
    dv.setUint32(p,inf[i].size,true);p+=4;
    dv.setUint32(p,inf[i].offset,true);p+=4;
    dv.setUint32(p,0,true);p+=4;p+=16;
  }
  for(i=0;i<n;i++)out.set(entries[i].data,inf[i].offset);
  return{files:inf,raw:out};
},
merge:function(base,ml){
  var map=new Map(),i,j;
  for(i=0;i<base.files.length;i++)map.set(base.files[i].name.toLowerCase(),{e:base.files[i],s:base.raw});
  for(i=0;i<ml.length;i++)
    for(j=0;j<ml[i].files.length;j++){
      var mf=ml[i].files[j],k=mf.name.toLowerCase(),ex=map.get(k);
      if(ex)map.set(k,{e:{name:ex.e.name,offset:mf.offset,size:mf.size,enc:mf.enc,md5:mf.md5},s:ml[i].raw});
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
  return out;
}};

function strip(files){
  if(!files.length)return[];
  var p=files[0].path,i;
  for(i=1;i<files.length;i++){while(p&&!files[i].path.startsWith(p))p=p.slice(0,-1);}
  var s=p.lastIndexOf('/');p=s!==-1?p.substring(0,s+1):'';
  var out=[];
  for(i=0;i<files.length;i++){var r=files[i].path.substring(p.length);if(r&&!r.endsWith('/'))out.push({path:'/'+r,data:files[i].data});}
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

window.__mml_merge = function(buf) {
  if(!mods||!mods.length) return buf;
  if(buf.byteLength < 16) {
    console.warn('[mml] Fetch failed. Skipping merge.');
    return buf;
  }
  try {
    var merged = R.merge(R.parse(new Uint8Array(buf)), mods);
    mods = null;
    console.log('%c[mml]%c mods active','color:#4ade80;font-weight:bold','color:inherit');
    return merged.buffer;
  } catch(e) {
    console.error('[mml]', e);
    return buf;
  }
};

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
'<div id="b"><div id="dz">drop .rsdk or Data/</div><a id="fd">pick folder</a><div id="ls"></div><button id="go">launch</button></div>';
document.body.appendChild(el);

var ls=el.querySelector('#ls'),dz=el.querySelector('#dz');
var fi=document.createElement('input');fi.type='file';fi.accept='.rsdk';fi.multiple=true;fi.style.display='none';document.body.appendChild(fi);
var di=document.createElement('input');di.type='file';di.webkitdirectory=true;di.style.display='none';document.body.appendChild(di);

function ren(){ls.innerHTML='';for(var i=0;i<mods.length;i++){var d=document.createElement('div');d.className='r';d.innerHTML='<span>'+mods[i]._l+'</span><span class="x" data-i="'+i+'">\u00d7</span>';ls.appendChild(d);}}
function go(){
  el.classList.add('off');
  var s=document.createElement('script');s.src='index.js';document.body.appendChild(s);
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
    var r=R.build(ent);r._l=lb||'mod';mods.push(r);
  }catch(e){alert(e.message);}
  ren();
}

})();