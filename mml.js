// mod-loader.js — drop .rsdk / .zip / Data folder
// <script src="mod-loader.js"></script> before game script
// disable: ?nomods=1
(function(){
'use strict';
if(location.search.includes('nomods=1'))return;

var mods=[],pending=true,_rel=null,_ff=null;
function ff(){if(!_ff)_ff=import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm');return _ff;}

// ── RSDK v5 ──────────────────────────────────────────────────────
// Magic on disk: 52 53 4B 44 76 35 = "RSKDv5"
// Verified: getUint32(0,true)=0x444B5352, getUint16(4,true)=0x3576
var RSDK={
parse:function(buf){
  var r=buf instanceof Uint8Array?buf:new Uint8Array(buf);
  var d=new DataView(r.buffer,r.byteOffset,r.byteLength);
  if(d.getUint32(0,true)!==0x444B5352||d.getUint16(4,true)!==0x3576)
    throw new Error('Not a valid RSDKv5 file');
  var n=d.getUint32(8,true),files=[],p=16;
  for(var e=0;e<n;e++){
    var raw=[];while(r[p]){raw.push(r[p]);p++;}
    p=(p+4)&~3;
    var sz=d.getUint32(p,true),off=d.getUint32(p+4,true),
        enc=d.getUint32(p+8,true),md5=r.slice(p+12,p+28);
    p+=28;
    var name=this._dec(raw,e);
    if(!this._ok(name))name=String.fromCharCode.apply(null,raw);
    files.push({name:name,offset:off,size:sz,enc:enc,md5:md5});
  }
  return{files:files,raw:r};
},

_dec:function(r,i){
  var o=[];for(var j=0;j<r.length;j++)o.push(r[j]^(((i+1)*7+j)&0xFF));
  return String.fromCharCode.apply(null,o);
},

_ok:function(s){
  if(!s)return false;
  for(var i=0;i<Math.min(s.length,80);i++){
    var c=s.charCodeAt(i);
    if(!((c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c===46||c===47||c===95||c===45||c===32||c===43))return false;
  }return true;
},

// Build from [{path,data}]. Returns same shape as parse() — no round-trip needed.
build:function(entries){
  var cnt=entries.length;
  if(!cnt)throw new Error('No files to pack');
  var hs=16,i;
  for(i=0;i<cnt;i++){hs+=entries[i].path.length+1;hs=(hs+3)&~3;hs+=28;}
  var doff=hs,infos=[];
  for(i=0;i<cnt;i++){
    var dlen=entries[i].data.byteLength;
    infos.push({name:entries[i].path,offset:doff,size:dlen,enc:0,md5:new Uint8Array(16)});
    doff+=dlen;
  }
  var out=new Uint8Array(doff),dv=new DataView(out.buffer);
  // Correct magic: R S K D v 5
  out[0]=0x52;out[1]=0x53;out[2]=0x4B;out[3]=0x44;out[4]=0x76;out[5]=0x35;
  dv.setUint32(8,cnt,true);dv.setUint32(12,0,true);
  var p=16;
  for(i=0;i<cnt;i++){
    var nm=entries[i].path;
    for(var j=0;j<nm.length;j++)
      out[p++]=nm.charCodeAt(j)^(((i+1)*7+j)&0xFF);
    out[p++]=0;p=(p+3)&~3;
    dv.setUint32(p,entries[i].data.byteLength,true);p+=4;
    dv.setUint32(p,infos[i].offset,true);p+=4;
    dv.setUint32(p,0,true);p+=4;
    p+=16;
  }
  for(i=0;i<cnt;i++)out.set(entries[i].data,infos[i].offset);
  return{files:infos,raw:out};
},

merge:function(base,ml){
  var map=new Map(),i,j;
  for(i=0;i<base.files.length;i++)
    map.set(base.files[i].name.toLowerCase(),{e:base.files[i],s:base.raw});
  for(i=0;i<ml.length;i++)
    for(j=0;j<ml[i].files.length;j++)
      map.set(ml[i].files[j].name.toLowerCase(),{e:ml[i].files[j],s:ml[i].raw});
  var items=[];for(var v of map.values())items.push(v);
  var cnt=items.length,hs=16;
  for(i=0;i<cnt;i++){hs+=items[i].e.name.length+1;hs=(hs+3)&~3;hs+=28;}
  var doff=hs;
  for(i=0;i<cnt;i++){items[i].no=doff;doff+=items[i].e.size;}
  var out=new Uint8Array(doff),dv=new DataView(out.buffer);
  out.set(base.raw.subarray(0,8),0);
  dv.setUint32(8,cnt,true);dv.setUint32(12,0,true);
  var p=16;
  for(i=0;i<cnt;i++){
    var e=items[i].e;
    for(j=0;j<e.name.length;j++)
      out[p++]=e.name.charCodeAt(j)^(((i+1)*7+j)&0xFF);
    out[p++]=0;p=(p+3)&~3;
    dv.setUint32(p,e.size,true);p+=4;
    dv.setUint32(p,items[i].no,true);p+=4;
    dv.setUint32(p,e.enc,true);p+=4;
    out.set(e.md5,p);p+=16;
  }
  for(i=0;i<cnt;i++){
    var it=items[i];
    out.set(it.s.subarray(it.e.offset,it.e.offset+it.e.size),it.no);
  }
  return out;
}};

// ── Path resolution ──────────────────────────────────────────────
// Input: [{path,data}] from zip or folder
// Output: [{path,data}] with Data/ prefix stripped, junk filtered
var SKIP_EXT={md:1,txt:1,ini:1,cfg:1,url:1,htm:1,html:1,py:1,bat:1,sh:1,json:1,xml:1};
var KNOWN_DIR=['game/','sprites/','stage/','objects/','scripts/','audio/',
  'images/','title/','global/','player/','database/','background/','tile/','palette/'];

function resolvePaths(rawFiles){
  var paths=[];
  for(var i=0;i<rawFiles.length;i++)paths.push(rawFiles[i].path.replace(/\\/g,'/'));

  // Find Data/ directory (case-insensitive)
  var root=null;
  for(i=0;i<paths.length;i++){
    var lo=paths[i].toLowerCase();
    var idx=lo.indexOf('data/');
    if(idx!==-1&&(idx===0||lo[idx-1]==='/')){
      var c=paths[i].substring(0,idx+5);
      if(!root||c.length<root.length)root=c;
    }
  }
  // Fallback: strip first path component (uploaded folder IS Data/)
  if(!root&&paths.length){
    var s=paths[0].indexOf('/');
    if(s!==-1)root=paths[0].substring(0,s+1);
  }
  if(!root)throw new Error(
    'No Data/ folder found.\n\n'+
    'Upload the Data folder from your mod.\n'+
    'Inside should be: Game/, Sprites/, Stage/, etc.'
  );

  var out=[];
  for(i=0;i<rawFiles.length;i++){
    var p=rawFiles[i].path.replace(/\\/g,'/');
    if(p.toLowerCase().substring(0,root.length)!==root.toLowerCase())continue;
    var rel=p.substring(root.length);
    if(!rel||rel.endsWith('/'))continue;
    var dot=rel.lastIndexOf('.');
    var ext=dot!==-1?rel.substring(dot+1).toLowerCase():'';
    if(SKIP_EXT[ext])continue;
    if(rel.toLowerCase().indexOf('__macosx')!==-1)continue;
    out.push({path:rel,data:rawFiles[i].data});
  }

  // Validate: at least one file under a known RSDK subdirectory
  var valid=false;
  for(i=0;i<out.length;i++){
    var l=out[i].path.toLowerCase();
    for(var j=0;j<KNOWN_DIR.length;j++){
      if(l.indexOf(KNOWN_DIR[j])!==-1){valid=true;break;}
    }if(valid)break;
  }
  if(!valid)throw new Error(
    'No game data found inside Data/.\n\n'+
    'Expected subfolders: Game/, Sprites/, Stage/, Objects/, etc.\n'+
    'Got: '+(out.length?out[0].path:'(empty)')
  );
  return out;
}

// ── Entry walker (folder drag-and-drop) ───────────────────────────
function walkEntry(en,path,out){
  return new Promise(function(res){
    if(en.isFile){
      en.file(function(f){out.push({file:f,path:path+f.name});res();});
    }else if(en.isDirectory){
      var rd=en.createReader(),all=[];
      (function q(){rd.readEntries(function(e){
        if(!e.length){
          var c=Promise.resolve();
          for(var i=0;i<all.length;i++)
            c=c.then(function(x){return walkEntry(x,path+en.name+'/',out);}.bind(null,all[i]));
          c.then(res);
        }else{for(var j=0;j<e.length;j++)all.push(e[j]);q();}
      });})();
    }else res();
  });
}
function entryFile(en){return new Promise(function(r){en.file(r);});}

// ── Script mutation: subarray truncation fix ─────────────────────
var patched=false;
for(var si=0;si<document.scripts.length;si++){
  var t=document.scripts[si].textContent;
  if(t&&t.indexOf('Data.rsdk')!==-1&&t.indexOf('loadPackage')!==-1){
    document.scripts[si].textContent=t
      .replace(/"end"\s*:\s*\d+/g,'"end":2147483647')
      .replace(/"remote_package_size"\s*:\s*\d+/g,'"remote_package_size":2147483647');
    patched=true;break;
  }
}
var _bp=false;
if(!patched){
  var _sa=Uint8Array.prototype.subarray;
  Uint8Array.prototype.subarray=function(s,e){
    if(_bp&&s===0&&typeof e==='number'&&e<this.byteLength){_bp=false;return _sa.call(this,0,this.byteLength);}
    return _sa.call(this,s,e);
  };
}

// ── FS hook ──────────────────────────────────────────────────────
window.Module=window.Module||{};
var _hk=false;
function makeHook(orig){
  if(_hk)return orig;_hk=true;
  return function(){
    var a=new Array(arguments.length);
    for(var i=0;i<a.length;i++)a[i]=arguments[i];
    if((a[0]==='/Data.rsdk'||a[0]==='Data.rsdk')&&mods&&mods.length){
      for(i=0;i<a.length;i++){
        if(a[i] instanceof Uint8Array){
          try{
            var base=RSDK.parse(a[i]);
            a[i]=RSDK.merge(base,mods);
            mods=null; // free all mod memory
            if(!patched)_bp=true;
            console.log('%c[ml]%c merged','color:#4ade80;font-weight:bold','color:#666');
          }catch(err){console.error('[ml] merge:',err.message);}
          break;
        }
      }
    }
    return orig.apply(this,a);
  };
}
try{
  Object.defineProperty(Module,'FS_createDataFile',{
    configurable:true,enumerable:true,
    get:function(){return this.__m;},
    set:function(f){this.__m=typeof f==='function'?makeHook(f):f;}
  });
}catch(e){
  if(typeof Module.FS_createDataFile==='function'&&!_hk)
    Module.FS_createDataFile=makeHook(Module.FS_createDataFile);
}

// ── XHR delay ────────────────────────────────────────────────────
var _xo=XMLHttpRequest.prototype.open,_xs=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(m,u){
  this.__d=typeof u==='string'&&u.indexOf('index.data')!==-1;
  return _xo.apply(this,arguments);
};
XMLHttpRequest.prototype.send=function(b){
  if(this.__d&&pending){this.__d=false;var x=this;_rel=function(){_xs.call(x,b);};return;}
  return _xs.apply(this,arguments);
};

// ── UI ───────────────────────────────────────────────────────────
var el=document.createElement('div');el.id='ml';
el.innerHTML=
'<style>'+
'#ml{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.88)}'+
'#ml.off{display:none}'+
'#ml-b{background:#0e0e0e;border:1px solid #1a1a1a;border-radius:3px;padding:14px 18px;width:260px;font:11px/1.5 monospace;color:#444}'+
'#ml-dz{border:1px dashed white;border-radius:2px;padding:12px;text-align:center;cursor:pointer;margin-bottom:6px;color:#383838;user-select:none}'+
'#ml-dz:hover,#ml-dz.ov{border-color:#4ade80;color:#4ade80}'+
'#ml-dir{display:block;text-align:center;font-size:9px;color:#252525;margin-bottom:8px;text-decoration:none;cursor:pointer}'+
'#ml-dir:hover{color:#4ade80}'+
'#ml-ls{max-height:110px;overflow-y:auto;margin-bottom:8px}'+
'#ml-ls:empty::after{content:"no mods";display:block;color:#1a1a1a;font-style:italic;padding:2px 0}'+
'.mr{display:flex;justify-content:space-between;padding:1px 0}'+
'.mx{cursor:pointer;opacity:.2;color:#666}.mx:hover{opacity:.7}'+
'#ml-go{width:100%;padding:5px;background:#090909;border:1px solid #222;border-radius:2px;color:#444;cursor:pointer;font:inherit;letter-spacing:.06em}'+
'#ml-go:hover{border-color:#4ade80;color:#4ade80}'+
'</style>'+
'<div id="ml-b">'+
'<div id="ml-dz">drop .rsdk .zip or Data/</div>'+
'<a id="ml-dir">pick folder</a>'+
'<div id="ml-ls"></div>'+
'<button id="ml-go">launch da game yo</button>'+
'</div>';
document.body.appendChild(el);

var ls=el.querySelector('#ml-ls'),dz=el.querySelector('#ml-dz');
var fIn=document.createElement('input');
fIn.type='file';fIn.accept='.rsdk,.zip';fIn.multiple=true;fIn.style.display='none';
document.body.appendChild(fIn);
var dIn=document.createElement('input');
dIn.type='file';dIn.webkitdirectory=true;dIn.style.display='none';
document.body.appendChild(dIn);

function render(){
  ls.innerHTML='';
  for(var i=0;i<mods.length;i++){
    var r=document.createElement('div');r.className='mr';
    r.innerHTML='<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">'+
      mods[i]._l+'</span><span class="mx" data-i="'+i+'">\u00d7</span>';
    ls.appendChild(r);
  }
}
function go(){pending=false;el.classList.add('off');if(_rel){_rel();_rel=null;}}

el.querySelector('#ml-go').onclick=go;
dz.onclick=function(){fIn.click();};
el.querySelector('#ml-dir').onclick=function(e){e.preventDefault();e.stopPropagation();dIn.click();};
fIn.onchange=function(){if(fIn.files.length)handleFileList(fIn.files);fIn.value='';};
dIn.onchange=function(){
  if(!dIn.files.length)return;
  var label=dIn.files[0].webkitRelativePath.split('/')[0];
  handleFolder(dIn.files,label);dIn.value='';
};
ls.onclick=function(e){if(e.target.classList.contains('mx')){mods.splice(+e.target.dataset.i,1);render();}};
dz.ondragover=function(e){e.preventDefault();dz.classList.add('ov');};
dz.ondragleave=function(){dz.classList.remove('ov');};
el.ondragover=function(e){e.preventDefault();};

el.ondrop=async function(e){
  e.preventDefault();dz.classList.remove('ov');
  var items=e.dataTransfer.items;
  if(!items||!items.length)return;
  for(var i=0;i<items.length;i++){
    var en=items[i].webkitGetAsEntry?items[i].webkitGetAsEntry():null;
    if(!en){var f=items[i].getAsFile();if(f)await addFile(f);continue;}
    if(en.isFile){var fi=await entryFile(en);await addFile(fi);}
    else if(en.isDirectory){
      var collected=[];await walkEntry(en,'',collected);
      await addFolder(collected,collected[0]?collected[0].path.split('/')[0]:'mod');
    }
  }
  render();
};

// ── Handlers ─────────────────────────────────────────────────────
async function addFile(f){
  var name=f.name.toLowerCase();
  try{
    if(name.endsWith('.rsdk')){
      var buf=await f.arrayBuffer();
      var r=RSDK.parse(new Uint8Array(buf));buf=null;
      r._l=f.name.replace(/\.rsdk$/i,'');
      mods.push(r);
    }else if(name.endsWith('.zip')){
      var _ff=await ff();
      var zb=await f.arrayBuffer();
      var uz=_ff.unzipSync(new Uint8Array(zb));zb=null;
      var raw=[];
      for(var k in uz){
        if(k.endsWith('/')||k.indexOf('__macosx')!==-1)continue;
        raw.push({path:k,data:uz[k]});
      }
      var ent=resolvePaths(raw);
      var r=RSDK.build(ent);
      r._l=f.name.replace(/\.zip$/i,'');
      mods.push(r);
    }else{
      throw new Error('Unsupported file.\nUse .rsdk, .zip, or the Data/ folder.');
    }
  }catch(err){alert(f.name+'\n'+err.message);}
}

async function addFolder(fileList,label){
  try{
    var bufs=await Promise.all(fileList.map(function(f){
      return f.file.arrayBuffer().then(function(b){
        return{path:f.path,data:new Uint8Array(b)};
      });
    }));
    var ent=resolvePaths(bufs);
    var r=RSDK.build(ent);
    r._l=label||'mod';
    mods.push(r);
  }catch(err){alert(err.message);}
  render();
}

function handleFileList(list){
  var chain=Promise.resolve();
  for(var i=0;i<list.length;i++)chain=chain.then(function(f){return addFile(f);}.bind(null,list[i]));
  chain.then(render);
}

})();