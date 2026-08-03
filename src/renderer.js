const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function lerp(a,b,t){ return a+(b-a)*t; }
function mixColor(stops, value) {
  const v=clamp(value,0,1);
  const scaled=v*(stops.length-1);
  const i=Math.min(stops.length-2,Math.floor(scaled));
  const t=scaled-i;
  const a=stops[i], b=stops[i+1];
  return [Math.round(lerp(a[0],b[0],t)),Math.round(lerp(a[1],b[1],t)),Math.round(lerp(a[2],b[2],t)),Math.round(lerp(a[3],b[3],t))];
}

const palettes={
  oxygen:[[9,10,25,225],[47,29,91,220],[31,99,145,220],[30,184,191,215],[126,242,217,205]],
  drug:[[5,9,16,215],[46,20,76,215],[119,58,173,220],[212,111,255,220],[255,209,249,210]],
  matrix:[[8,14,17,205],[50,48,42,205],[110,88,62,215],[196,153,102,218],[255,222,172,220]],
  suppression:[[7,11,16,210],[61,22,28,215],[128,45,42,220],[218,83,57,218],[255,178,100,210]],
  inflammation:[[7,12,18,210],[28,47,68,215],[37,112,137,220],[88,203,188,220],[207,255,220,210]],
  angiogenic:[[6,10,18,210],[32,28,74,215],[69,59,146,220],[115,105,220,220],[203,195,255,210]],
};

export class AquariumRenderer {
  constructor(canvas) {
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d',{alpha:false});
    this.fieldCanvas=document.createElement('canvas');
    this.fieldCtx=this.fieldCanvas.getContext('2d');
    this.snapshot=null;
    this.layer='cells';
    this.scale=1;
    this.baseScale=1;
    this.offsetX=0;
    this.offsetY=0;
    this.panX=0;
    this.panY=0;
    this.dpr=Math.min(2,window.devicePixelRatio||1);
    this.hover=null;
    this.selectedId=null;
    this.resize();
  }

  resize() {
    const rect=this.canvas.getBoundingClientRect();
    this.dpr=Math.min(2,window.devicePixelRatio||1);
    this.canvas.width=Math.max(1,Math.round(rect.width*this.dpr));
    this.canvas.height=Math.max(1,Math.round(rect.height*this.dpr));
    this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    this.fit();
  }

  setSnapshot(snapshot){
    this.snapshot=snapshot;
    if(this.fieldCanvas.width!==snapshot.width){
      this.fieldCanvas.width=snapshot.width;
      this.fieldCanvas.height=snapshot.height;
      this.fit();
    }
  }
  setLayer(layer){ this.layer=layer; }
  fit(){
    if(!this.snapshot) return;
    const rect=this.canvas.getBoundingClientRect();
    this.baseScale=Math.min(rect.width/this.snapshot.width,rect.height/this.snapshot.height)*0.94;
    this.scale=this.baseScale;
    this.panX=0; this.panY=0;
    this.computeOffset();
  }
  computeOffset(){
    if(!this.snapshot) return;
    const rect=this.canvas.getBoundingClientRect();
    this.offsetX=(rect.width-this.snapshot.width*this.scale)/2+this.panX;
    this.offsetY=(rect.height-this.snapshot.height*this.scale)/2+this.panY;
  }
  zoomAt(factor,screenX,screenY){
    if(!this.snapshot) return;
    const world=this.screenToWorld(screenX,screenY);
    this.scale=clamp(this.scale*factor,this.baseScale*0.72,this.baseScale*4.5);
    this.offsetX=screenX-world.x*this.scale;
    this.offsetY=screenY-world.y*this.scale;
    const rect=this.canvas.getBoundingClientRect();
    this.panX=this.offsetX-(rect.width-this.snapshot.width*this.scale)/2;
    this.panY=this.offsetY-(rect.height-this.snapshot.height*this.scale)/2;
  }
  pan(dx,dy){ this.panX+=dx; this.panY+=dy; this.computeOffset(); }
  screenToWorld(x,y){ return {x:(x-this.offsetX)/this.scale,y:(y-this.offsetY)/this.scale}; }

  hitTest(screenX,screenY){
    if(!this.snapshot) return null;
    const p=this.screenToWorld(screenX,screenY);
    let best=null; let bestD=(8/this.scale)**2+0.6;
    const entities=[...this.snapshot.tCells,...this.snapshot.macrophages,...this.snapshot.fibroblasts,...this.snapshot.cancer];
    for(const cell of entities){
      const dx=cell.x-p.x,dy=cell.y-p.y,d=dx*dx+dy*dy;
      if(d<bestD){ bestD=d; best=cell; }
    }
    return best;
  }

  draw(){
    const ctx=this.ctx;
    const rect=this.canvas.getBoundingClientRect();
    ctx.save();
    ctx.setTransform(this.dpr,0,0,this.dpr,0,0);
    const bg=ctx.createRadialGradient(rect.width*.48,rect.height*.48,0,rect.width*.48,rect.height*.48,Math.max(rect.width,rect.height)*.72);
    bg.addColorStop(0,'#071a1f'); bg.addColorStop(1,'#02070a');
    ctx.fillStyle=bg; ctx.fillRect(0,0,rect.width,rect.height);
    if(!this.snapshot){ctx.restore();return;}
    this.computeOffset();
    ctx.translate(this.offsetX,this.offsetY);
    ctx.scale(this.scale,this.scale);
    ctx.beginPath(); ctx.rect(0,0,this.snapshot.width,this.snapshot.height); ctx.clip();
    this.drawField(ctx);
    this.drawTissueTexture(ctx);
    this.drawVessels(ctx);
    this.drawDebris(ctx);
    this.drawFibroblasts(ctx);
    this.drawCancer(ctx);
    this.drawMacrophages(ctx);
    this.drawTCells(ctx);
    this.drawBorder(ctx);
    ctx.restore();
  }

  drawField(ctx){
    const s=this.snapshot;
    const layer=this.layer==='cells'||this.layer==='clones'?'oxygen':this.layer;
    const field=s[layer];
    if(!field) return;
    const image=this.fieldCtx.createImageData(s.width,s.height);
    const data=image.data;
    for(let i=0;i<field.length;i+=1){
      let value=field[i];
      if(layer==='oxygen') value=Math.pow(value,0.82);
      if(layer==='matrix'||layer==='suppression') value=Math.pow(value,0.9);
      const rgba=mixColor(palettes[layer],value);
      const opacity=this.layer==='cells'||this.layer==='clones' ? 0.54 : 0.88;
      data[i*4]=rgba[0]; data[i*4+1]=rgba[1]; data[i*4+2]=rgba[2]; data[i*4+3]=Math.round(rgba[3]*opacity);
    }
    this.fieldCtx.putImageData(image,0,0);
    ctx.imageSmoothingEnabled=true;
    ctx.globalAlpha=1;
    ctx.drawImage(this.fieldCanvas,0,0,s.width,s.height);
    ctx.globalAlpha=1;
  }

  drawTissueTexture(ctx){
    const s=this.snapshot;
    ctx.save();
    ctx.globalAlpha=this.layer==='matrix'?0.32:0.08;
    ctx.lineWidth=0.06;
    ctx.strokeStyle='#d8bc8e';
    for(let y=2;y<s.height;y+=5){
      ctx.beginPath();
      for(let x=0;x<s.width;x+=2){
        const wave=Math.sin(x*.28+y*.53)*.35;
        if(x===0)ctx.moveTo(x,y+wave); else ctx.lineTo(x,y+wave);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  drawVessels(ctx){
    const s=this.snapshot;
    ctx.save();
    ctx.lineCap='round'; ctx.lineJoin='round';
    for(const [vi,vessel] of s.vessels.entries()){
      ctx.beginPath();
      vessel.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.lineWidth=1.2;
      ctx.strokeStyle='rgba(36,74,94,.85)';
      ctx.shadowColor='rgba(89,184,218,.28)'; ctx.shadowBlur=2.2;
      ctx.stroke();
      ctx.shadowBlur=0;
      ctx.lineWidth=.34;
      ctx.strokeStyle='rgba(112,222,239,.42)'; ctx.stroke();
      const p=vessel.points[Math.floor(((s.time*.9+vi*.33)%1)*vessel.points.length)];
      if(p){ctx.beginPath();ctx.arc(p.x,p.y,.35,0,Math.PI*2);ctx.fillStyle='rgba(155,244,255,.85)';ctx.fill();}
    }
    ctx.restore();
  }

  drawDebris(ctx){
    ctx.save();
    for(const d of this.snapshot.debris){
      ctx.globalAlpha=d.alpha*.75;
      ctx.fillStyle=d.cause==='药物损伤'?'#8f557a':'#31333c';
      ctx.beginPath();ctx.arc(d.x,d.y,.37+d.age*.018,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(210,220,220,.12)';ctx.lineWidth=.08;ctx.stroke();
    }
    ctx.restore();
  }

  drawCancer(ctx){
    const s=this.snapshot;
    const cloneView=this.layer==='clones';
    ctx.save();
    for(const c of s.cancer){
      const profile=s.clones[c.cloneId];
      let radius=.43;
      if(c.state==='分裂准备')radius=.49+Math.sin(s.time*8+c.id)*.035;
      const stress=Math.max(c.stress,c.damage);
      ctx.beginPath();
      const wobble=(c.id%5)*.02;
      ctx.ellipse(c.x,c.y,radius+wobble,radius-wobble*.5,(c.id%9)*.31,0,Math.PI*2);
      ctx.fillStyle=cloneView?profile.color:this.cellStateColor(c,profile);
      ctx.globalAlpha=clamp(.46+c.health*.54,.2,1);
      ctx.fill();
      ctx.lineWidth=this.selectedId===c.id?.15:.07;
      ctx.strokeStyle=this.selectedId===c.id?'#ffffff':stress>.58?'rgba(255,220,188,.75)':profile.edge;
      ctx.globalAlpha=this.selectedId===c.id?1:.55;
      ctx.stroke();
      if(c.state==='分裂准备'){
        ctx.beginPath();ctx.arc(c.x-.12,c.y,.1,0,Math.PI*2);ctx.arc(c.x+.12,c.y,.1,0,Math.PI*2);ctx.fillStyle='rgba(255,255,255,.35)';ctx.fill();
      }
    }
    ctx.restore();
  }
  cellStateColor(c,profile){
    if(c.state==='药物应激')return '#b970c7';
    if(c.state==='缺氧应激')return c.cloneId===2?profile.color:'#805275';
    if(c.state==='拥挤静息')return '#745b70';
    return profile.color;
  }

  drawTCells(ctx){
    const s=this.snapshot;
    ctx.save();
    for(const t of s.tCells){
      const faded=1-t.exhaustion*.65;
      ctx.save();ctx.translate(t.x,t.y);ctx.rotate(Math.PI/4+s.time*.4);
      ctx.globalAlpha=clamp(faded,.25,1);
      ctx.fillStyle=t.state==='攻击'?'#d9ffff':'#63dce9';
      ctx.shadowColor='rgba(96,228,239,.7)';ctx.shadowBlur=t.state==='攻击'?1.4:.5;
      ctx.fillRect(-.25,-.25,.5,.5);
      ctx.shadowBlur=0;
      if(this.selectedId===t.id){ctx.strokeStyle='#fff';ctx.lineWidth=.12;ctx.strokeRect(-.34,-.34,.68,.68);}
      ctx.restore();
    }
    ctx.restore();
  }

  drawFibroblasts(ctx){
    const s=this.snapshot;
    ctx.save();
    for(const f of s.fibroblasts){
      const radius=.34+f.activation*.11;
      ctx.save();ctx.translate(f.x,f.y);ctx.rotate((f.id%13)*.23);
      ctx.beginPath();ctx.moveTo(0,-radius*1.25);ctx.lineTo(radius,.75*radius);ctx.lineTo(-radius,.75*radius);ctx.closePath();
      ctx.globalAlpha=clamp(.38+f.activation*.58,.3,.96);
      ctx.fillStyle=f.exclusionActivity>f.matrixActivity?'#f2a96f':'#d7bd8b';
      ctx.fill();
      ctx.strokeStyle=this.selectedId===f.id?'#ffffff':'rgba(255,231,189,.72)';ctx.lineWidth=this.selectedId===f.id?.13:.06;ctx.stroke();
      if(f.activation>.62){ctx.beginPath();ctx.arc(0,0,radius*1.55,0,Math.PI*2);ctx.strokeStyle='rgba(245,190,123,.22)';ctx.lineWidth=.07;ctx.stroke();}
      ctx.restore();
    }
    ctx.restore();
  }

  drawMacrophages(ctx){
    const s=this.snapshot;
    ctx.save();
    for(const m of s.macrophages){
      const suppressive=clamp((m.activation+1)/2,0,1);
      const r=.37+(m.efferocytosisMemory||0)*.08;
      ctx.beginPath();ctx.arc(m.x,m.y,r,0,Math.PI*2);
      const red=Math.round(78+177*suppressive),green=Math.round(202-74*suppressive),blue=Math.round(195-88*suppressive);
      ctx.fillStyle=`rgb(${red} ${green} ${blue})`;ctx.globalAlpha=clamp(.45+m.energy*.5,.3,.98);ctx.fill();
      ctx.strokeStyle=this.selectedId===m.id?'#ffffff':'rgba(225,255,247,.7)';ctx.lineWidth=this.selectedId===m.id?.14:.065;ctx.stroke();
      ctx.beginPath();ctx.arc(m.x-r*.18,m.y-r*.08,r*.2,0,Math.PI*2);ctx.fillStyle='rgba(5,20,24,.52)';ctx.fill();
      if(m.state==='吞噬清除'){ctx.beginPath();ctx.arc(m.x,m.y,r*1.6,0,Math.PI*2);ctx.strokeStyle='rgba(214,255,235,.32)';ctx.lineWidth=.08;ctx.stroke();}
    }
    ctx.restore();
  }

  drawBorder(ctx){
    ctx.save();ctx.lineWidth=.13;ctx.strokeStyle='rgba(117,226,214,.25)';ctx.strokeRect(.08,.08,this.snapshot.width-.16,this.snapshot.height-.16);ctx.restore();
  }
}
