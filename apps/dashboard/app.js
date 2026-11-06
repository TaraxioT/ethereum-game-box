(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const games = {
    stockduel: { name:'Stock Duel', type:'Strategy duel', description:'Read the market and your opponent. Make your calls, hold your nerve, and see whose instinct wins the duel.', length:'~3 min', accent:'orange' },
    quickdraw: { name:'Quick Draw', type:'Reaction duel', description:'Two players. One signal. The fastest clean reaction wins. Anticipation is your enemy; patience is your edge.', length:'~30 sec', accent:'cyan' }
  };
  const players = [
    { id:'nova', glyph:'N', tagline:'Fast hands. Quiet confidence.', reaction:186 },
    { id:'echo', glyph:'E', tagline:'One more round is always the plan.', reaction:204 },
    { id:'iris', glyph:'I', tagline:'Reads the room. Then the market.', reaction:211 },
    { id:'flux', glyph:'F', tagline:'Here for the perfect run.', reaction:197 },
    { id:'rhea', glyph:'R', tagline:'A new rival, every night.', reaction:227 },
    { id:'kai', glyph:'K', tagline:'The next move is already made.', reaction:219 }
  ];
  const boxes = [
    { id:'mumbai-01', name:'Main stage', place:'Mumbai', detail:'ETHGlobal Mumbai · Main stage', state:'2 seats ready', mode:'Physical box' },
    { id:'mumbai-02', name:'The lounge', place:'Mumbai', detail:'ETHGlobal Mumbai · Community lounge', state:'Next table ready', mode:'Physical box' },
    { id:'demo-01', name:'Practice box', place:'Online', detail:'An online practice box, wherever you are.', state:'Practice anytime', mode:'Online practice' }
  ];
  // Fixed fictional history. Totals, profiles, game rankings and box views all
  // derive from these same records; refreshing never invents live chain activity.
  const base = Date.now();
  const matches = Array.from({ length:84 }, (_, i) => {
    const game = i % 5 < 3 ? 'quickdraw' : 'stockduel';
    const order = game === 'quickdraw' ? [0,0,1,0,3,2,1,4,5,0,2,3] : [2,1,2,3,0,2,5,4,1,2,3,0];
    const winner = players[order[i % order.length]].id;
    const loser = players[(order[i % order.length] + 1 + i % 4) % players.length].id;
    return { id:`round-${1048-i}`, game, winner, loser, box:boxes[i % 3].id, at:base - (i * 4 + 2) * 60000 };
  });
  const state = { game:'stockduel', box:'all', stack:[], entity:null, motion:true, identity:null, reactionTimer:0, reactionStart:0, practice:'idle', refreshTimer:0 };
  const dialog = $('#detail-dialog'), search = $('#search-dialog');
  const motion = window.GameboxMotion;
  let pendingTrigger = null;
  let detailTrigger = null;
  let detailTransition = null;
  let searchTransition = null;
  let detailClosing = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  try { state.identity = localStorage.getItem('gamebox-concept-identity'); } catch {}
  if (reduced.matches) state.motion = false;
  function animate(target) { return motion?.reveal(target); }
  const name = id => `${id}.gamebox.eth`;
  const avatar = id => `<span class="avatar avatar-${esc(id)}" aria-hidden="true">${esc((players.find(p => p.id === id)?.glyph || id[0]).toUpperCase())}</span>`;
  const filtered = game => matches.filter(m => (!game || m.game === game) && (state.box === 'all' || m.box === state.box));
  const stats = (id, game, scope = true) => {
    const list = (scope ? filtered(game) : matches.filter(m => !game || m.game === game)).filter(m => m.winner === id || m.loser === id);
    const wins = list.filter(m => m.winner === id).length;
    return { wins, losses:list.length-wins, played:list.length, rate:list.length ? Math.round(wins/list.length*100) : 0 };
  };
  const ranked = () => players.map(p => ({ ...p, ...stats(p.id,state.game) })).filter(p => p.played).sort((a,b) => b.wins-a.wins || b.rate-a.rate || a.id.localeCompare(b.id));
  function rankMarkup(limit = 4) {
    return ranked().slice(0,limit).map((p,i) => `<button class="rank-row" data-entity="player/${p.id}" aria-label="${esc(name(p.id))}, ${p.wins} wins"><span class="rank-no">${String(i+1).padStart(2,'0')}</span>${avatar(p.id)}<span><strong class="player-name">${name(p.id)}</strong><span class="player-sub">${p.rate}% win rate · ${p.played} rounds</span></span><span class="rank-wins">${p.wins}<small>WINS</small></span></button>`).join('') || '<p class="empty-state">No completed rounds at this box yet.</p>';
  }
  function renderRank() { $('#rank-list').innerHTML = rankMarkup(3); animate('#rank-list .rank-row',{ stagger:.05 }); }
  function renderBoxes() {
    $('#box-list').innerHTML = boxes.filter(b => state.box === 'all' || b.id === state.box).map(b => `<button class="box-card" data-entity="box/${b.id}"><span class="overline">${b.place.toUpperCase()}</span><i class="box-icon" aria-hidden="true"></i><b>${b.name}</b><small>${b.id}.gamebox.eth</small><span class="box-available"><i class="status-dot"></i>${b.state.toUpperCase()}</span><span aria-hidden="true">↗</span></button>`).join('');
    $('#box-list').style.gridTemplateColumns = state.box === 'all' ? '' : '1fr';
    $('#ready-count').textContent = state.box === 'all' ? '3 BOXES' : 'THIS BOX';
    const history = filtered();
    $('#network-rounds').textContent = history.length;
    $('#network-players').textContent = String(new Set(history.flatMap(m => [m.winner,m.loser])).size).padStart(2,'0');
    $('#boxes .tag').textContent = state.box === 'all' ? '3 AVAILABLE' : '1 AVAILABLE';
  }
  function matchMarkup(m) {
    return `<div class="result-row"><span class="result-symbol" aria-hidden="true">${m.game === 'quickdraw' ? 'ϟ' : '⌁'}</span><div><p><button class="text-button" data-entity="player/${m.winner}">${m.winner}</button> outplayed <button class="text-button" data-entity="player/${m.loser}">${m.loser}</button></p><small><button class="text-button" data-entity="game/${m.game}">${games[m.game].name}</button> · <button class="text-button" data-entity="box/${m.box}">${m.box}</button></small></div><time>${Math.max(1,Math.round((base-m.at)/60000))}m ago</time></div>`;
  }
  function renderResults() { $('#result-list').innerHTML = filtered().slice(0,3).map(matchMarkup).join(''); }
  function toast(message) { const el=$('#toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),3500); }
  function applyMotion() {
    state.motion = !reduced.matches;
    document.documentElement.dataset.motion = state.motion ? 'on' : 'off';
    motion?.setEnabled(state.motion);
    if(!state.motion&&window.gsap){
      const art=$$('.stage canvas,.stage .identity-badge,.stage .avatar-stack');
      gsap.killTweensOf(art);gsap.set(art,{scale:1});
    }
  }
  function setIdentity() { $('#identity-label').textContent=state.identity || 'Your player'; $('.mini-avatar').textContent=(state.identity || 'Y')[0].toUpperCase(); }
  function goTo(id) {
    const target=id==='arcade'?$('#main'):document.getElementById(id); if (!target) return;
    target.scrollIntoView({behavior:state.motion?'smooth':'instant',block:'start'});
    $$('.header nav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===id));
    if(id!=='arcade') { target.classList.remove('attention'); void target.offsetWidth; target.classList.add('attention'); }
  }
  function showDialog() { if (!dialog.open) dialog.showModal(); document.body.classList.add('modal-open'); }
  function clearPractice() { clearTimeout(state.reactionTimer); state.practice='idle'; }
  function detail(entity, push = true) {
    clearPractice();
    if(push && state.entity && state.entity!==entity) state.stack.push(state.entity);
    state.entity=entity;
    const fromSearch=search.open;
    if(fromSearch){searchTransition?.cancel();search.close();}
    detailClosing=false;
    const [kind,id]=entity.split('/');
    $('#detail-kind').textContent=({game:'THE GAME',player:'THE PLAYER',box:'THE PLACE',boxes:'THE PLACES',cup:'THE COMPETITION',rankings:'THE RANKINGS',results:'THE RESULTS',identity:'YOUR PLAYER',catalog:'THE GAMES',about:'THE IDEA'})[kind] || 'THE GRID';
    $('#detail-back').hidden=state.stack.length===0;
    let html='';
    if(kind==='game' && games[id]) {
      const g=games[id], list=filtered(id), participants=new Set(list.flatMap(m=>[m.winner,m.loser]));
      html=`<span class="detail-label">${g.type.toUpperCase()} · 1 VS 1</span><h2 class="detail-title" id="detail-title">${g.name.toUpperCase()}<span style="color:var(--${g.accent})">.</span></h2><p class="detail-lead">${g.description}</p><div class="detail-stats"><div><strong>${g.length}</strong><span>per round</span></div><div><strong>${list.length}</strong><span>sample rounds</span></div><div><strong>${participants.size}</strong><span>sample players</span></div></div>${id==='quickdraw'?`<section class="detail-section"><h3>Get a feel for it.</h3><p>Try a reaction round right here. Wait for cyan, then click, tap, or press Space. This is a local practice interaction.</p><button class="practice-pad" id="practice-pad" data-phase="idle" data-action="practice"><span>Ready when you are.</span><small>CLICK TO START A PRACTICE ROUND</small></button><div class="practice-actions"><button class="text-button" data-action="practice-reset">Reset practice ↻</button></div></section>`:`<section class="detail-section"><h3>Bring your best instinct.</h3><p>Play Stock Duel at a Gamebox. The sample lets you explore players and results; it does not reproduce the full game rules.</p></section>`}<section class="detail-section"><h3>Find your table</h3>${boxes.filter(b=>state.box==='all'||b.id===state.box).map(b=>entityLink(`box/${b.id}`,b.name,`${b.place} · ${b.state}`)).join('')}</section><section class="detail-section"><h3>Last round</h3>${list.slice(0,2).map(matchMarkup).join('')}</section><button class="button secondary" data-action="game-ranks" data-value="${id}">See this game's rankings <span>↗</span></button>`;
    } else if(kind==='player' && players.some(p=>p.id===id)) {
      const p=players.find(p=>p.id===id), s=stats(id,null,false);
      html=`<div class="profile-head">${avatar(id)}<div><h2 id="detail-title">${id}<span style="color:var(--cyan)">.</span></h2><span class="detail-name">${name(id)}</span></div></div><p class="detail-lead">${p.tagline}</p><div class="detail-stats"><div><strong>${s.wins}</strong><span>wins</span></div><div><strong>${s.losses}</strong><span>losses</span></div><div><strong>${s.rate}%</strong><span>win rate</span></div></div><section class="detail-section"><h3>A different kind of signature.</h3><p>Personal best in Quick Draw: <strong>${p.reaction} ms</strong>. Fictional profile for this concept.</p></section><section class="detail-section"><h3>Games played</h3>${Object.entries(games).map(([key,g])=>entityLink(`game/${key}`,g.name,`${stats(id,key,false).played} sample rounds`)).join('')}</section><section class="detail-section"><h3>Recent rounds</h3>${matches.filter(m=>m.winner===id||m.loser===id).slice(0,4).map(matchMarkup).join('')}</section>`;
    } else if(kind==='box' && boxes.some(b=>b.id===id)) {
      const b=boxes.find(b=>b.id===id), list=matches.filter(m=>m.box===id);
      html=`<span class="detail-label">${b.mode.toUpperCase()} · ${b.place.toUpperCase()}</span><h2 class="detail-title" id="detail-title">${b.name.toUpperCase()}<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">${b.detail}</p><p class="detail-name">${id}.gamebox.eth</p><div class="detail-stats"><div><strong>02</strong><span>player seats</span></div><div><strong>02</strong><span>games available</span></div><div><strong>${list.length}</strong><span>sample rounds</span></div></div><p class="detail-note">${b.state}. Availability is fictional in this concept.</p><section class="detail-section"><h3>Pick your game</h3>${Object.entries(games).map(([key,g])=>entityLink(`game/${key}`,g.name,g.type)).join('')}</section><section class="detail-section"><h3>What to expect</h3><ol><li>Find a rival and choose your game.</li><li>Tap your badge at the box.</li><li>Play. The box records the result.</li></ol></section><section class="detail-section"><h3>Names made at this box</h3>${[...new Set(list.map(m=>m.winner))].slice(0,3).map(p=>entityLink(`player/${p}`,name(p),'View player')).join('')}</section>`;
    } else if(kind==='boxes') {
      const list=boxes.filter(b=>state.box==='all'||b.id===state.box);
      html=`<span class="detail-label">${state.box==='all'?'ALL BOXES':state.box.toUpperCase()}</span><h2 class="detail-title" id="detail-title">FIND YOUR BOX<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">Choose a place to meet your next rival.</p>${list.map(b=>entityLink(`box/${b.id}`,b.name,`${b.place} · ${b.state}`)).join('')}`;
    } else if(kind==='cup') {
      html=`<span class="detail-label">QUICK DRAW · MUMBAI</span><h2 class="detail-title" id="detail-title">THE MIDNIGHT CIRCUIT<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">A place on the grid is earned one round at a time. Follow the chase and meet the players making their mark.</p><p class="detail-note">Sample cup. The displayed remaining time is illustrative. No competition is entered from this prototype.</p><section class="detail-section"><h3>Leading the chase</h3>${entityLink('player/nova','nova.gamebox.eth','View the sample cup leader')}</section><section class="detail-section"><h3>Explore the competition</h3>${entityLink('game/quickdraw','Quick Draw','The game behind the cup')}${entityLink('box/mumbai-01','Main stage','The sample host box')}</section><p class="detail-note">Cup standings and all-time game rankings are separate views. Final scoring and title-transfer rules must come from the contracts.</p>`;
    } else if(kind==='rankings') {
      html=`<span class="detail-label">${games[state.game].name.toUpperCase()} · ${state.box==='all'?'ALL BOXES':state.box.toUpperCase()}</span><h2 class="detail-title" id="detail-title">THE ONES TO BEAT<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">Ranked by wins, then win rate. Draws and rating systems can be added when the production rules are agreed.</p><div class="rank-list">${rankMarkup(6)}</div><p class="detail-note">Fictional results from one shared sample history.</p>`;
    } else if(kind==='results') {
      html=`<span class="detail-label">${state.box==='all'?'ALL BOXES':state.box.toUpperCase()}</span><h2 class="detail-title" id="detail-title">ROUND BY ROUND<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">A result is a way into a game, a player, or a place. Follow any name.</p>${filtered().slice(0,12).map(matchMarkup).join('')}`;
    } else if(kind==='identity') {
      html=`<span class="detail-label">THE ARCADE REMEMBERS</span><h2 class="detail-title" id="detail-title">MAKE A NAME<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">One identity across your games, rivals and results.</p><form class="identity-form" id="identity-form"><label for="player-name">Try a demo player name</label><div class="identity-field"><input id="player-name" name="player" value="${esc(state.identity||'')}" placeholder="your-name" maxlength="24" autocomplete="off" spellcheck="false" aria-describedby="name-error"><span>.gamebox.eth</span></div><div id="name-error" class="form-error" aria-live="polite"></div><button class="button primary" type="submit">Use demo name <span>→</span></button></form><p class="detail-note">Saved only in this browser. This does not claim an ENS name, connect a wallet, or write a transaction.</p>${entityLink('player/nova','Explore a complete player profile','See sample stats and game history')}`;
    } else if(kind==='catalog') {
      html=`<span class="detail-label">PICK YOUR RIVAL. PICK YOUR GAME.</span><h2 class="detail-title" id="detail-title">THE GAME RACK<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">A quick test of reflexes or a duel of instincts.</p>${Object.entries(games).map(([key,g])=>entityLink(`game/${key}`,g.name,`${g.type} · ${g.length}`)).join('')}`;
    } else {
      html=`<span class="detail-label">PLAY COMES FIRST</span><h2 class="detail-title" id="detail-title">AN ARCADE.<br>OUT IN THE OPEN<span style="color:var(--cyan)">.</span></h2><p class="detail-lead">Gamebox is a console you play by tapping a badge. Meet at a box, choose a game, and let the result speak for itself.</p><section class="detail-section"><h3>Start with a game.</h3><p>Explore a game, see who is winning, then find a box. Player names, match history and cups link everything together.</p></section>${entityLink('catalog','Find your game','Quick Draw and Stock Duel')}${entityLink('box/mumbai-01','Find a box','Meet at the main stage')}<p class="detail-note">Interactive design concept. All identities, results and cup timing are fictional. No funds move.</p>`;
    }
    const wasOpen=dialog.open;
    if(!wasOpen) detailTrigger=fromSearch?$('.search-trigger'):(pendingTrigger || document.activeElement);
    const focusHeading=()=>{const heading=$('#detail-title');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}};
    const renderContent=()=>{clearPractice();$('#detail-content').innerHTML=html;$('#detail-content').inert=false;dialog.scrollTop=0;};
    document.body.classList.add('modal-open');
    if(wasOpen && motion) {$('#detail-content').inert=true;detailTransition=motion.swap(dialog,renderContent,focusHeading);}
    else {
      renderContent();showDialog();
      if(motion)detailTransition=motion.open(dialog,{trigger:detailTrigger,focus:focusHeading});
      else focusHeading();
    }
    const hash=`#${entity}`; if(location.hash!==hash) history.pushState({entity},'',hash);
  }
  function entityLink(entity,title,subtitle) { return `<button class="detail-link" data-entity="${esc(entity)}"><span>${esc(title)}${subtitle?`<small>${esc(subtitle)}</small>`:''}</span><span aria-hidden="true">↗</span></button>`; }
  function closeDetails(updateUrl = true, immediate = false) {
    clearPractice();detailClosing=true;$('#detail-content').inert=true;
    const finish=()=>{
      clearPractice();detailClosing=false;$('#detail-content').inert=false;
      if(dialog.open)dialog.close();state.stack=[];state.entity=null;
      if(!search.open)document.body.classList.remove('modal-open');
      if(updateUrl)history.replaceState(null,'','#arcade');
      const focus=detailTrigger?.isConnected&&!detailTrigger.closest('dialog:not([open])')?detailTrigger:$('.profile-trigger');
      focus?.focus({preventScroll:true});
    };
    if(motion&&!immediate)detailTransition=motion.close(dialog,finish);else{detailTransition?.cancel();finish();}
  }
  function searchItems() {
    return [...Object.entries(games).map(([id,g])=>({entity:`game/${id}`,title:g.name,sub:`Game · ${g.type}`,glyph:g.name[0]})),...players.map(p=>({entity:`player/${p.id}`,title:name(p.id),sub:'Player · profile and results',glyph:p.glyph})),...boxes.map(b=>({entity:`box/${b.id}`,title:b.name,sub:`${b.id}.gamebox.eth · ${b.place}`,glyph:'B'}))];
  }
  function renderSearch() {
    const q=$('#search-input').value.trim().toLowerCase();
    const found=searchItems().filter(x=>`${x.title} ${x.sub}`.toLowerCase().includes(q));
    $('#search-results').innerHTML=found.map(x=>`<button class="search-item" data-entity="${x.entity}"><span class="avatar" aria-hidden="true">${x.glyph}</span><span><strong>${esc(x.title)}</strong><small>${esc(x.sub)}</small></span><span aria-hidden="true">↗</span></button>`).join('') || '<p class="empty-state">No matches. Try “Quick Draw”, “nova” or “Mumbai”.</p>';
  }
  function openSearch() { searchTransition?.cancel();if(dialog.open)closeDetails(true,true);if(!search.open)search.showModal();$('#search-results').inert=false;document.body.classList.add('modal-open');$('#search-input').value='';renderSearch();if(motion)searchTransition=motion.open(search,{trigger:pendingTrigger,focus:()=>$('#search-input').focus()});else $('#search-input').focus(); }
  function closeSearch() {
    $('#search-results').inert=true;
    const finish=()=>{search.close();$('#search-results').inert=false;if(!dialog.open)document.body.classList.remove('modal-open');};
    if(motion)searchTransition=motion.close(search,finish);else finish();
  }
  function practice() {
    const pad=$('#practice-pad'); if(!pad||detailClosing||state.entity!=='game/quickdraw'||$('#detail-content').inert)return;
    if(state.practice==='wait') {clearTimeout(state.reactionTimer);state.practice='result';pad.dataset.phase='result';pad.innerHTML='<span>A little too eager.</span><small>WAIT FOR CYAN. CLICK TO TRY AGAIN.</small>';return;}
    if(state.practice==='go') {const ms=Math.round(performance.now()-state.reactionStart);state.practice='result';pad.dataset.phase='result';pad.innerHTML=`<span>${ms} ms</span><small>${ms<200?'THAT WAS SHARP.':ms<300?'CLEAN REACTION.':'A GOOD START. GO AGAIN.'} CLICK TO RETRY.</small>`;return;}
    state.practice='wait';pad.dataset.phase='wait';pad.innerHTML='<span>Hold your nerve.</span><small>WAIT FOR CYAN…</small>';
    state.reactionTimer=setTimeout(()=>{if(!dialog.open||!$('#practice-pad'))return;state.practice='go';state.reactionStart=performance.now();pad.dataset.phase='go';pad.innerHTML='<span>DRAW.</span><small>CLICK, TAP OR PRESS SPACE</small>';},1400+Math.random()*2100);
  }
  document.addEventListener('click', e => {
    if(e.target.closest('#detail-content')?.inert||e.target.closest('#search-results')?.inert)return;
    // Use a real primary control for card surfaces, preserving native keyboard
    // behavior, dialog focus restoration and all independent controls inside.
    const card=e.target.closest('[data-card]');
    const control=e.target.closest('button,a,input,select,textarea,label,summary,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"])');
    if(card&&!control){
      if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||window.getSelection()?.isCollapsed===false)return;
      const primary=card.querySelector('[data-card-primary]');
      if(primary&&!primary.disabled){primary.focus({preventScroll:true});primary.click();}
      return;
    }
    pendingTrigger=e.target.closest('button,a');
    const entity=e.target.closest('[data-entity]'); if(entity){detail(entity.dataset.entity);return;}
    const game=e.target.closest('[data-game]');if(game){state.game=game.dataset.game;$$('[data-game]').forEach(b=>b.setAttribute('aria-pressed',String(b===game)));renderRank();return;}
    const nav=e.target.closest('[data-nav]');if(nav){e.preventDefault();if(dialog.open)closeDetails(false,true);history.pushState(null,'',nav.hash);goTo(nav.dataset.nav);return;}
    const trigger=e.target.closest('[data-action]');if(!trigger)return;
    const action=trigger.dataset.action;
    if(action==='close'){closeDetails();return;}
    if(action==='search'){openSearch();return;}
    if(action==='close-search'){closeSearch();return;}
    if(action==='identity'||action==='catalog'||action==='about'){detail(action);return;}
    if(action==='all-ranks'){detail('rankings/all');return;}
    if(action==='all-results'){detail('results/all');return;}
    if(action==='game-ranks'){state.game=trigger.dataset.value;$$('[data-game]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.game===state.game)));renderRank();detail('rankings/all');return;}
    if(action==='practice'){practice();return;}
    if(action==='practice-reset'){clearPractice();const pad=$('#practice-pad');pad.dataset.phase='idle';pad.innerHTML='<span>Ready when you are.</span><small>CLICK TO START A PRACTICE ROUND</small>';pad.focus();return;}
    if(action==='refresh'){
      if(state.refreshTimer)return;document.body.classList.add('refreshing');$('.bento').setAttribute('aria-busy','true');trigger.disabled=true;
      state.refreshTimer=setTimeout(()=>{renderRank();renderResults();document.body.classList.remove('refreshing');$('.bento').removeAttribute('aria-busy');trigger.disabled=false;state.refreshTimer=0;$('#snapshot-label').textContent='Sample snapshot · just refreshed';toast('Sample snapshot refreshed. All figures remain illustrative.');},650);
    }
  });
  $('#detail-back').addEventListener('click',()=>{const previous=state.stack.pop();if(previous)detail(previous,false);});
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeDetails();});
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDetails();}});
  search.addEventListener('cancel',e=>{e.preventDefault();closeSearch();});
  search.addEventListener('close',()=>{if(!dialog.open)document.body.classList.remove('modal-open');});
  search.addEventListener('click',e=>{if(e.target===search){const r=search.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeSearch();}});
  $('#search-input').addEventListener('input',renderSearch);
  $('#box-scope').addEventListener('change',e=>{state.box=e.target.value;renderRank();renderBoxes();renderResults();$('#snapshot-label').textContent=state.box==='all'?'Sample snapshot · all boxes':`Sample snapshot · ${state.box}`;});
  reduced.addEventListener('change',applyMotion);
  document.addEventListener('submit',e=>{
    if(e.target.id!=='identity-form')return;e.preventDefault();const input=$('#player-name'),value=input.value.trim().toLowerCase();
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)||value.length>24){$('#name-error').textContent='Use 1–24 letters or numbers, with hyphens between words.';input.setAttribute('aria-invalid','true');input.focus();return;}
    state.identity=value;try{localStorage.setItem('gamebox-concept-identity',value);}catch{}setIdentity();closeDetails();toast(`Demo identity set to ${value}.gamebox.eth. No ENS name was claimed.`);
  });
  document.addEventListener('keydown',e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}
    if(e.code==='Space'&&dialog.open&&$('#practice-pad')&&(state.practice==='wait'||state.practice==='go')&&e.target.closest('#practice-pad')){e.preventDefault();practice();}
    if(e.key==='Enter'&&e.target===$('#search-input')){e.preventDefault();$('#search-results .search-item')?.click();}
  });
  window.addEventListener('popstate',()=>{
    const route=location.hash.slice(1);
    if(route.includes('/')||['identity','catalog','about'].includes(route)){state.stack=[];detail(route,false);}else{closeDetails(false,true);goTo(route||'arcade');}
  });
  // Motion is always enabled unless the device requests reduced motion.
  renderRank();renderBoxes();renderResults();setIdentity();applyMotion();
  const supportObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){motion?.reveal(entry.target);supportObserver.unobserve(entry.target);}},{threshold:.12});
  $$('.support-grid>.tile,.closing').forEach(el=>supportObserver.observe(el));
  motion?.intro();
  // Each card has a quiet artwork response; entrances and modal transforms stay independent.
  if(window.gsap && matchMedia('(hover:hover) and (pointer:fine)').matches) {
    $$('.stage > .tile').forEach(tile=>{
      const art=tile.querySelector('canvas,.identity-badge,.avatar-stack');
      if(!art)return;
      tile.addEventListener('pointerenter',()=>{if(state.motion)gsap.to(art,{scale:1.035,duration:.4,ease:'power2.out',overwrite:'auto'});});
      tile.addEventListener('pointerleave',()=>gsap.to(art,{scale:1,duration:state.motion?.35:0,ease:'power2.out',overwrite:'auto'}));
    });
  }
  const initial=location.hash.slice(1);
  if(initial&&initial.includes('/'))detail(initial,false);
  else if(['identity','catalog','about','results'].includes(initial))detail(initial,false);
  // Cup timing is an explicitly illustrative countdown, not a real chain expiry.
  const cupEnd=Date.now()+(2*3600+14*60+38)*1000;
  setInterval(()=>{const left=Math.max(0,Math.floor((cupEnd-Date.now())/1000));$('#cup-countdown').textContent=[Math.floor(left/3600),Math.floor(left/60)%60,left%60].map(n=>String(n).padStart(2,'0')).join(':');},1000);
})();
