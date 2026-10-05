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

  // Forms. Each one posts JSON to the club's form server. window.MCC_FORM_ENDPOINT (set in
  // assets/config.js) is the full address of that server, for example https://forms.example.com/api/submit
  var ENDPOINT=(window.MCC_FORM_ENDPOINT||'/api/submit');

  function collect(f){
    var fields={}, seen={};
    [].slice.call(f.elements).forEach(function(el){
      if(!el.name||seen[el.name]||el.type==='submit'||el.type==='button')return;
      seen[el.name]=1;
      if(el.type==='checkbox'){
        fields[el.name]=[].slice.call(f.querySelectorAll('input[name="'+el.name+'"]:checked')).map(function(c){return c.value;});
      }else if(el.type==='radio'){
        var r=f.querySelector('input[name="'+el.name+'"]:checked');
        fields[el.name]=r?r.value:'';
      }else{
        fields[el.name]=(el.value||'').trim();
      }
    });
    return fields;
  }

  [].slice.call(document.querySelectorAll('form[data-form]')).forEach(function(f){
    var btn=f.querySelector('button[type=submit]');
    var status=document.createElement('p');
    status.className='formstatus';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    btn.parentNode.insertBefore(status,btn.nextSibling);
    var sending=false;

    // Waitlist: youth players need an age and a parent or guardian.
    var youth=f.querySelector('.youth');
    function syncGroup(){
      if(!youth)return;
      var g=f.querySelector('input[name="group"]:checked');
      var isYouth=!!g&&g.value==='Youth';
      youth.hidden=!isYouth;
      f.querySelector('[name=age]').required=isYouth;
      f.querySelector('[name=guardian]').required=isYouth;
    }
    if(youth){
      [].slice.call(f.querySelectorAll('input[name="group"]')).forEach(function(r){r.addEventListener('change',syncGroup);});
      f.addEventListener('reset',function(){setTimeout(syncGroup,0);});
      syncGroup();
    }

    function show(kind,msg){status.className='formstatus '+kind;status.textContent=msg;}

    f.addEventListener('submit',function(e){
      e.preventDefault();
      if(sending)return;
      // Browser checks run first so the visitor sees which field needs attention.
      if(f.checkValidity&&!f.checkValidity()){
        if(f.reportValidity)f.reportValidity();
        show('err','Please fill in the highlighted fields.');
        return;
      }
      var body=JSON.stringify({form:f.getAttribute('data-form'),fields:collect(f)});
      sending=true;btn.disabled=true;var old=btn.textContent;btn.textContent='Sending';
      show('','');
      fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:body})
        .then(function(res){
          return res.json().catch(function(){return {};}).then(function(j){return {status:res.status,body:j};});
        })
        .then(function(r){
          if(r.body&&r.body.ok){
            f.reset();
            show('ok',r.body.dryRun
              ?'Test mode: the server received this but did not send an email.'
              :'Thank you! Your message was sent to the club. We will reply by email.');
          }else if(r.body&&r.body.error){
            show('err',r.body.error);
          }else{
            show('err','Sorry, something went wrong on our side and your message was not sent. Please try again in a few minutes.');
          }
        })
        .catch(function(){
          show('err','We could not reach the club’s server, so your message was not sent. Check your connection and try again.');
        })
        .then(function(){sending=false;btn.disabled=false;btn.textContent=old;});
    });
  });
})();
