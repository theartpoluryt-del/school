/* Decorative only: no work while the login screen is hidden or motion is disabled. */
(() => {
  const screen=document.getElementById('loginScreen');
  if (!screen) return;
  const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let active=false,frame=0,x=0,y=0,printing=false;
  const draw=()=>{
    frame=0;
    screen.style.setProperty('--ambient-x',`${x}px`);
    screen.style.setProperty('--ambient-y',`${y}px`);
  };
  const schedule=()=>{ if(!frame) frame=requestAnimationFrame(draw); };
  const center=()=>{ x=0;y=0;if(active)schedule(); };
  const move=event=>{
    if(event.pointerType!=='mouse') return;
    x=(event.clientX/Math.max(innerWidth,1)-.5)*160;
    y=(event.clientY/Math.max(innerHeight,1)-.5)*120;
    schedule();
  };
  function update() {
    const enabled=finePointer.matches && !reducedMotion.matches && !document.hidden && !printing && !screen.classList.contains('is-hidden');
    if(active===enabled) return;
    active=enabled;
    screen.dataset.ambientMotion=active?'on':'off';
    if(active) {
      screen.addEventListener('pointermove',move,{passive:true});
      screen.addEventListener('pointerleave',center);
    } else {
      screen.removeEventListener('pointermove',move);
      screen.removeEventListener('pointerleave',center);
      cancelAnimationFrame(frame);frame=0;x=0;y=0;draw();
    }
  }
  new MutationObserver(update).observe(screen,{attributes:true,attributeFilter:['class']});
  finePointer.addEventListener('change',update);
  reducedMotion.addEventListener('change',update);
  document.addEventListener('visibilitychange',update);
  window.addEventListener('blur',center);
  window.addEventListener('resize',center,{passive:true});
  window.addEventListener('beforeprint',()=>{printing=true;update();});
  window.addEventListener('afterprint',()=>{printing=false;update();});
  update();
})();
