export function drawBurdenChart(canvas, history=[]) {
  const dpr=Math.min(2,window.devicePixelRatio||1);
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.max(1,Math.round(rect.width*dpr));
  canvas.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=rect.width,h=rect.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='rgba(151,215,211,.09)';ctx.lineWidth=1;
  for(let i=1;i<4;i+=1){const y=(h-20)*i/4+4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(history.length<2) return;
  const values=history.map(x=>x.cancerCount);
  const min=Math.min(...values)*.88,max=Math.max(...values)*1.08+1;
  const points=history.map((m,i)=>({x:i/(history.length-1)*(w-4)+2,y:h-9-(m.cancerCount-min)/(max-min)*(h-18)}));
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'rgba(91,224,206,.28)');grad.addColorStop(1,'rgba(91,224,206,0)');
  ctx.beginPath();ctx.moveTo(points[0].x,h-7);for(const p of points)ctx.lineTo(p.x,p.y);ctx.lineTo(points.at(-1).x,h-7);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#69e5d2';ctx.lineWidth=1.5;ctx.stroke();
  const p=points.at(-1);ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fillStyle='#d7fff7';ctx.fill();
  ctx.fillStyle='rgba(141,169,167,.75)';ctx.font='11px system-ui';ctx.textAlign='left';ctx.fillText(`${Math.round(history[0].time)}d`,1,h-1);ctx.textAlign='right';ctx.fillText(`${Math.round(history.at(-1).time)}d`,w-1,h-1);
}

export function drawSparkline(element, history=[]) {
  element.innerHTML='';
  if(history.length<2)return;
  const values=history.slice(-40).map(x=>x.cancerCount);const min=Math.min(...values),max=Math.max(...values)+1;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 75 28');svg.setAttribute('width','75');svg.setAttribute('height','28');
  const poly=document.createElementNS(svg.namespaceURI,'polyline');
  poly.setAttribute('points',values.map((v,i)=>`${i/(values.length-1)*75},${26-(v-min)/(max-min)*22}`).join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke','#68e4d1');poly.setAttribute('stroke-width','1.4');
  svg.appendChild(poly);element.appendChild(svg);
}
