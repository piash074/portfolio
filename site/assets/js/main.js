(function(){
var d=document,root=d.documentElement,fine=matchMedia('(hover:hover) and (pointer:fine)').matches,reduce=matchMedia('(prefers-reduced-motion:reduce)').matches,timers=[],bound=false;
function $(s,c){return(c||d).querySelector(s)}function $$(s,c){return[].slice.call((c||d).querySelectorAll(s))}
function reveal(){var els=$$('.rv');if(window.gsap&&window.ScrollTrigger&&!reduce){gsap.registerPlugin(ScrollTrigger);ScrollTrigger.getAll().forEach(function(t){t.kill()});gsap.set(els,{opacity:0,y:34});ScrollTrigger.batch(els,{start:'top 90%',once:true,onEnter:function(b){gsap.to(b,{opacity:1,y:0,duration:.9,stagger:.1,ease:'power3.out',overwrite:true});b.forEach(count)}});return}
if(!('IntersectionObserver' in window)){els.forEach(function(e){e.style.opacity=1;e.style.transform='none';count(e)});return}
var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){var e=x.target;e.style.transition='opacity .9s,transform .9s';e.style.opacity=1;e.style.transform='none';count(e);io.unobserve(e)}})},{threshold:.12});els.forEach(function(e){io.observe(e)})}
function count(c){$$('[data-count]',c).forEach(function(b){if(b._d)return;b._d=1;var n=+b.dataset.count,p=b.dataset.pre,s=b.dataset.suf,t0=performance.now();if(reduce)return;(function f(t){var k=Math.min(1,(t-t0)/1800),e=1-Math.pow(1-k,3);b.textContent=p+Math.round(n*e)+s;if(k<1)requestAnimationFrame(f)})(t0)})}
function roles(){var el=$('#role');if(!el)return;var a=[];try{a=JSON.parse(el.dataset.roles)}catch(e){}if(a.length<2)return;var i=0;timers.push(setInterval(function(){el.classList.add('out');setTimeout(function(){i=(i+1)%a.length;el.textContent=a[i];el.classList.remove('out')},350)},2400))}
function slider(){var s=$('#slider');if(!s)return;var tr=$('.strack',s),n=tr.children.length,dots=$$('.dots button',s),i=0,tm;function go(k){i=(k+n)%n;tr.style.transform='translateX(-'+i*100+'%)';dots.forEach(function(x,j){x.classList.toggle('on',j===i)})}
function auto(){clearInterval(tm);if(!reduce)tm=setInterval(function(){go(i+1)},6000);timers.push(tm)}
$('#prev').onclick=function(){go(i-1);auto()};$('#next').onclick=function(){go(i+1);auto()};dots.forEach(function(x,j){x.onclick=function(){go(j);auto()}});var x0=null;s.addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});s.addEventListener('touchend',function(e){if(x0==null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40){go(i+(dx<0?1:-1));auto()}x0=null});s.addEventListener('mouseenter',function(){clearInterval(tm)});s.addEventListener('mouseleave',auto);go(0);auto()}
function chrome(){var h=$('#hdr'),b=$('#burger'),nav=$('#nav');function sc(){h.classList.toggle('sc',scrollY>30)}
if(!window._sc){window._sc=1;addEventListener('scroll',function(){var h=$('#hdr');if(h)h.classList.toggle('sc',scrollY>30)},{passive:true})}sc();
b.onclick=function(){var o=nav.classList.toggle('open');d.body.classList.toggle('open-m',o);b.setAttribute('aria-expanded',o)};$$('a',nav).forEach(function(a){a.onclick=function(){nav.classList.remove('open');d.body.classList.remove('open-m')}})}
function globals(){if(bound)return;bound=true;if(!fine)return;root.classList.add('has-cur');var dot=$('#dot'),ring=$('#ring'),x=0,y=0,rx=0,ry=0;
d.addEventListener('mousemove',function(e){x=e.clientX;y=e.clientY;dot.style.transform='translate('+x+'px,'+y+'px)';var t=e.target.closest&&e.target.closest('a,button,[role=button],input,select,textarea,label,[data-mag]');ring.classList.toggle('big',!!t);
var c=e.target.closest&&e.target.closest('[data-spot]');if(c){var r=c.getBoundingClientRect();c.style.setProperty('--mx',e.clientX-r.left+'px');c.style.setProperty('--my',e.clientY-r.top+'px')}
var m=e.target.closest&&e.target.closest('[data-mag]');$$('[data-mag]').forEach(function(b){if(b!==m)b.style.transform=''});if(m&&!reduce){var q=m.getBoundingClientRect();m.style.transform='translate('+(e.clientX-q.left-q.width/2)*.25+'px,'+(e.clientY-q.top-q.height/2)*.35+'px)'}
var tl=$('#tilt');if(tl){var u=tl.getBoundingClientRect();if(e.clientX>u.left-80&&e.clientX<u.right+80&&e.clientY>u.top-80&&e.clientY<u.bottom+80&&!reduce){tl.style.transform='rotateY('+((e.clientX-u.left)/u.width-.5)*16+'deg) rotateX('+(-((e.clientY-u.top)/u.height-.5))*14+'deg)'}else tl.style.transform=''}});
(function f(){rx+=(x-rx)*.15;ry+=(y-ry)*.15;ring.style.transform='translate('+rx+'px,'+ry+'px)';requestAnimationFrame(f)})()}
var vbound=false;
function viewer(){var v=$('#vw');if(!v||vbound)return;vbound=true;var app=$('#app'),x=$('.vwx',v),last=null;
function open(c){var im=$('img',c);last=c;var vi=$('#vwi');vi.src=im?im.currentSrc||im.src:'';vi.alt=($('h3',c)||{}).textContent||'';$('#vwt').textContent=vi.alt;$('#vwd').textContent=($('p',c)||{}).textContent||'';
var sb=innerWidth-root.clientWidth;root.style.setProperty('--sbw',sb+'px');d.body.style.paddingRight=sb+'px';root.classList.add('lock');if(app)app.inert=true;v.classList.add('open');v.setAttribute('aria-hidden','false');x.focus();setTimeout(function(){if(v.classList.contains('open'))x.focus()},60)}
function close(){if(!v.classList.contains('open'))return;v.classList.remove('open');v.setAttribute('aria-hidden','true');root.classList.remove('lock');d.body.style.paddingRight='';if(app)app.inert=false;if(last&&last.focus)last.focus({preventScroll:true})}
d.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('.wcard');if(c&&!v.contains(e.target)){open(c);return}if(v.classList.contains('open')&&(e.target===v||e.target.closest('[data-vw-close]')))close()});
d.addEventListener('keydown',function(e){var o=v.classList.contains('open');if(o){if(e.key==='Escape'){e.preventDefault();close()}else if(e.key==='Tab'){e.preventDefault();x.focus()}return}
if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('wcard')){e.preventDefault();open(e.target)}})}
/* The backend confirms success only after the message has been stored. */
function sendMessage(data,endpoint){if(!endpoint)return Promise.reject({code:'no-endpoint'});
return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data)}).then(function(r){return r.json().catch(function(){return null}).then(function(j){if(r.ok&&j&&j.ok===true)return j;throw{code:'server',status:r.status,error:j&&j.error,details:j&&j.details}})},function(){throw{code:'network'}})}
window.sendMessage=window.sendMessage||sendMessage;
var cbound=false;
function contact(){var f=$('#cform');if(!f||cbound)return;cbound=true;var busy=false,fm=$('#fmsg'),ok=$('#fok'),hd=$('#fhead');
var rules={name:function(v){return v.length<2?'Please enter at least 2 characters.':v.length>100?'Please use 100 characters or fewer.':''},
email:function(v){return!v?'Please enter your email address.':v.length>254?'Email addresses must be 254 characters or fewer.':!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)?'Please enter a valid email address.':''},
phone:function(v){if(!v)return'';var n=v.replace(/\D/g,'');return v.length>30||!/^[+\d][\d\s().+\-]*$/.test(v)||n.length<7||n.length>15?'Please enter a valid phone number, or leave this blank.':''},
service:function(v){return!v?'Please choose a service.':v.length>120?'Please choose a valid service.':''},
message:function(v){return!v?'Please write a message.':v.length<10?'Please write at least 10 characters.':v.length>5000?'Please use 5000 characters or fewer.':''}};
function check(el){var m=rules[el.name](el.value.trim()),w=el.closest('.fld');w.classList.toggle('bad',!!m);el.setAttribute('aria-invalid',!!m);$('.err',w).textContent=m;return!m}
function fields(){return $$('input[name],select,textarea',f).filter(function(e){return rules[e.name]})}
f.addEventListener('focusout',function(e){if(rules[e.target.name])check(e.target)});
f.addEventListener('change',function(e){if(rules[e.target.name])check(e.target)});
f.addEventListener('input',function(e){var t=e.target;if(rules[t.name]&&t.closest('.fld').classList.contains('bad'))check(t)});
function note(error){var em=f.dataset.email,code=error&&error.code,first=null;
if(code==='server'&&error.error==='validation_failed'&&error.details){var serverMessages={name:'Please enter a name between 2 and 100 characters.',email:'Please enter a valid email address of 254 characters or fewer.',phone:'Please enter a valid phone number, or leave this blank.',service:'Please choose a service.',message:'Please write between 10 and 5000 characters.'};
fields().forEach(function(el){if(!Object.prototype.hasOwnProperty.call(error.details,el.name))return;var w=el.closest('.fld'),m=serverMessages[el.name]||'Please check this field and try again.';w.classList.add('bad');el.setAttribute('aria-invalid','true');$('.err',w).textContent=m;if(!first)first=el});
if(first){fm.hidden=true;first.scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'});first.focus({preventScroll:true});return}}
var text=code==='no-endpoint'?"This form isn't connected to an inbox yet, so your message has not been sent.":code==='network'?"A connection problem prevented your message from being sent. Please check your connection and try again.":code==='server'&&error.status===429?"Too many messages were submitted recently. Please wait a little and try again.":code==='server'&&error.status===503?"Your message couldn't be saved right now. Please try again later.":"Your message couldn't be submitted. Please try again.";
fm.textContent='';fm.appendChild(d.createTextNode(text));
if(em){fm.appendChild(d.createTextNode(' You can email me directly at '));var a=d.createElement('a');a.href='mailto:'+em;a.textContent=em;fm.appendChild(a);fm.appendChild(d.createTextNode('.'))}fm.hidden=false}
f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;fm.hidden=true;
var bad=fields().filter(function(el){return!check(el)});if(bad.length){bad[0].scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'});bad[0].focus({preventScroll:true});return}
if(f.elements.website.value)return;
var data={name:f.elements.name.value.trim(),email:f.elements.email.value.trim(),phone:f.elements.phone.value.trim(),service:f.elements.service.value,message:f.elements.message.value.trim(),website:''};
var btn=$('button[type=submit]',f),label=$('span',btn),idleLabel=label.textContent;busy=true;btn.disabled=true;label.textContent='Sending…';f.setAttribute('aria-busy','true');
Promise.resolve().then(function(){return window.sendMessage(data,f.dataset.endpoint)}).then(function(){f.hidden=true;hd.hidden=true;ok.hidden=false;var h=$('h2',ok);h.focus({preventScroll:true});ok.scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'})},function(err){note(err);if(!fm.hidden)fm.scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'})}).then(function(){busy=false;btn.disabled=false;label.textContent=idleLabel;f.removeAttribute('aria-busy')})});
$('#fagain').onclick=function(){f.reset();fields().forEach(function(el){var w=el.closest('.fld');w.classList.remove('bad');el.removeAttribute('aria-invalid');$('.err',w).textContent=''});fm.hidden=true;ok.hidden=true;f.hidden=false;hd.hidden=false;f.elements.name.focus()}}
var rbound=false;
function reviews(){var f=$('#feat');if(!f||rbound)return;rbound=true;
function pick(c){$$('.rcard').forEach(function(x){var on=x===c;x.classList.toggle('on',on);x.setAttribute('aria-pressed',on)});var fin=$('.fin',f);
function fill(){var tg=$('.stag',c),ft=$('.ftag',f);ft.textContent=tg?tg.textContent:'';ft.hidden=!tg;$('.fq',f).textContent=$('.rq',c).textContent;$('.fn',f).textContent=$('.rn',c).textContent;$('.fr',f).textContent=$('.rr',c).textContent;var a=$('.av',c),fa=$('.av',f);fa.textContent=a.textContent;fa.style.setProperty('--hr',a.style.getPropertyValue('--hr'));var cs=$('.stars',c),fs=$('.stars',f);fs.innerHTML=cs.innerHTML;fs.setAttribute('aria-label',cs.getAttribute('aria-label'));fin.classList.remove('fx')}
fin.classList.add('fx');setTimeout(fill,reduce?0:250);f.scrollIntoView({behavior:reduce?'auto':'smooth',block:'start'})}
d.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('.rcard');if(c)pick(c)});
d.addEventListener('keydown',function(e){if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('rcard')){e.preventDefault();pick(e.target)}})}
function init(){timers.forEach(clearInterval);timers=[];chrome();roles();slider();reveal();globals();viewer();reviews();contact()}
function start(){init();var done=function(){root.classList.add('ready');d.body.classList.add('done')};setTimeout(done,reduce?0:1000)}
d.readyState==='loading'?addEventListener('DOMContentLoaded',start):start();
window.SiteInit=init;
})();
