(function(){
  var menu=document.querySelector('button.menu'), nav=document.getElementById('nav');
  if(menu&&nav){
    menu.addEventListener('click',function(){
      var o=nav.classList.toggle('open');menu.setAttribute('aria-expanded',o?'true':'false');
    });
  }
  var dds=[].slice.call(document.querySelectorAll('.dd'));
  function closeAll(except){dds.forEach(function(d){if(d!==except){d.classList.remove('open');d.firstElementChild.setAttribute('aria-expanded','false');}});}
  dds.forEach(function(d){
    var b=d.firstElementChild;
    b.addEventListener('click',function(e){
      e.stopPropagation();
      var o=d.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false');closeAll(d);
    });
  });
  document.addEventListener('click',function(){closeAll(null);});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeAll(null);}});

  // Gentle reveal on scroll. Content stays visible if the browser lacks IntersectionObserver.
  var rev=[].slice.call(document.querySelectorAll('.reveal'));
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});
    },{rootMargin:'0px 0px -8% 0px',threshold:0.05});
    rev.forEach(function(r){io.observe(r);});
  }else{rev.forEach(function(r){r.classList.add('in');});}

  // Forms. They post to the club's form server (data-endpoint). If the server cannot be
  // reached, they fall back to opening the visitor's email app with the message ready.
  function collect(f){
    var fields={}, lines=[], seen={};
    [].slice.call(f.elements).forEach(function(el){
      if(!el.name||seen[el.name]||el.type==='submit'||el.type==='button')return;
      seen[el.name]=1;
      var label=el.getAttribute('data-label')||el.name, val;
      if(el.type==='checkbox'){
        val=[].slice.call(f.querySelectorAll('input[name="'+el.name+'"]:checked')).map(function(c){return c.value;});
        fields[el.name]=val;
        if(val.length)lines.push(label+': '+val.join(', '));
      }else if(el.type==='radio'){
        var r=f.querySelector('input[name="'+el.name+'"]:checked');
        val=r?r.value:'';fields[el.name]=val;
        if(val)lines.push(label+': '+val);
      }else{
        val=(el.value||'').trim();fields[el.name]=val;
        if(val&&el.name!=='website')lines.push(label+': '+val);
      }
    });
    return {fields:fields,lines:lines};
  }
  [].slice.call(document.querySelectorAll('form[data-mailto]')).forEach(function(f){
    var btn=f.querySelector('button[type=submit]');
    var status=document.createElement('p');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.style.cssText='margin:14px 0 0;font-weight:800';
    btn.parentNode.insertBefore(status,btn.nextSibling);
    var out=f.querySelector('.out');

    function emailFallback(lines){
      var to=f.getAttribute('data-mailto');
      var subject=f.getAttribute('data-subject')||'Message from the website';
      var body=lines.join('\n');
      if(out){out.classList.add('show');out.querySelector('textarea').value='To: '+to+'\nSubject: '+subject+'\n\n'+body;}
      window.location.href='mailto:'+to+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
    }

    f.addEventListener('submit',function(e){
      e.preventDefault();
      var data=collect(f), endpoint=f.getAttribute('data-endpoint'), formKey=f.getAttribute('data-form');
      if(!endpoint||!window.fetch||location.protocol==='file:'){
        status.textContent='Opening your email app. If nothing opens, copy the message below.';
        emailFallback(data.lines);return;
      }
      btn.disabled=true;var old=btn.textContent;btn.textContent='Sending';
      status.style.color='';status.textContent='';
      fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({form:formKey,fields:data.fields})})
        .then(function(res){return res.json().catch(function(){return {ok:false};}).then(function(j){return {status:res.status,body:j};});})
        .then(function(r){
          if(r.body&&r.body.ok){
            status.style.color='var(--teal)';
            status.textContent='Thank you! Your message was sent to the club. We will reply by email.';
            f.reset();if(out)out.classList.remove('show');
          }else if(r.status>=400&&r.status<500&&r.body&&r.body.error){
            // The visitor can fix this (missing field, too many tries).
            status.style.color='var(--primary)';status.textContent=r.body.error;
          }else{
            throw new Error('server');
          }
        })
        .catch(function(){
          status.style.color='var(--primary)';
          status.textContent='We could not reach the club’s server, so your email app is opening instead. If nothing opens, copy the message below.';
          emailFallback(data.lines);
        })
        .then(function(){btn.disabled=false;btn.textContent=old;});
    });

    var copy=f.querySelector('[data-copy]');
    if(copy){
      copy.addEventListener('click',function(){
        var ta=f.querySelector('.out textarea');ta.select();
        try{navigator.clipboard.writeText(ta.value);copy.textContent='Copied';}catch(err){document.execCommand('copy');copy.textContent='Copied';}
      });
    }
  });
})();
