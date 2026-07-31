// Simple Accountability App (localStorage-backed)
(function(){
  const DEFAULT_USERS = [
    { id: 'anna', name: 'Anna' },
    { id: 'jordan', name: 'Jordan' }
  ];

  const STORAGE_KEY = 'accountability:data:v1';

  function load(){
    try{
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { users: DEFAULT_USERS, commitments: [] };
    }catch(e){
      return { users: DEFAULT_USERS, commitments: [] };
    }
  }

  function save(state){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid(){return Math.random().toString(36).slice(2,9)}

  // App state
  let state = load();
  let currentUser = state.users[0].id || 'anna';

  // DOM refs
  const userSelect = document.getElementById('userSelect');
  const commitFor = document.getElementById('commitFor');
  const addForm = document.getElementById('addForm');
  const commitText = document.getElementById('commitText');
  const commitEnabled = document.getElementById('commitEnabled');
  const commitSchedule = document.getElementById('commitSchedule');
  const commitList = document.getElementById('commitList');
  const commitLabel = document.getElementById('commitLabel');
  const commitTarget = document.getElementById('commitTarget');
  const commitReminderEnabled = document.getElementById('commitReminderEnabled');
  const commitReminderTime = document.getElementById('commitReminderTime');
  const apiBaseInput = document.getElementById('apiBase');
  const customDays = document.getElementById('customDays');
  const authName = document.getElementById('authName');
  const authPass = document.getElementById('authPass');
  const btnRegister = document.getElementById('btnRegister');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const btnSync = document.getElementById('btnSync');

  let authToken = localStorage.getItem('accountability:token') || null;
  if(authToken) apiBaseInput.value = localStorage.getItem('accountability:api') || 'http://localhost:3000';

  // Notification controls
  const btnEnableNotify = document.getElementById('btnEnableNotify');
  const notifyStatus = document.getElementById('notifyStatus');
  let notifyTimers = new Map();
  function updateNotifyStatus(){ notifyStatus.textContent = 'Permission: ' + (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'); }
  updateNotifyStatus();
  btnEnableNotify.addEventListener('click', async ()=>{
    if(typeof Notification === 'undefined') return alert('Notifications not supported in this browser.');
    const p = await Notification.requestPermission(); updateNotifyStatus();
    if(p==='granted'){
      // register service worker and subscribe for push
      try{
        const reg = await navigator.serviceWorker.register('/service-worker.js');
        const vap = await fetch(apiBase() + '/api/vapidPublicKey');
        const j = await vap.json();
        const key = j.publicKey;
        const applicationServerKey = urlBase64ToUint8Array(key);
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        // send to server
        await fetch(apiBase() + '/api/subscribe', { method: 'POST', headers: { 'content-type':'application/json', 'authorization':'Bearer '+authToken }, body: JSON.stringify(sub) });
      }catch(e){ console.error('push subscribe failed', e); }
      scheduleAllReminders();
    }
  });

  // show/hide custom days when schedule selector changes
  commitSchedule.addEventListener('change', ()=>{
    if(commitSchedule.value === 'custom') customDays.style.display = 'block'; else customDays.style.display = 'none';
  });

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
  }

  function showToast(title, body){
    const t = document.createElement('div'); t.className='toast';
    t.innerHTML = `<h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p>`;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),400); },7000);
  }

  function showSystemNotification(title, body){
    if(typeof Notification === 'undefined') return showToast(title, body);
    if(Notification.permission === 'granted'){
      try{ new Notification(title, { body }); }catch(e){ showToast(title, body); }
    } else showToast(title, body);
  }

  function scheduleReminderFor(commit){
    // clear existing
    if(!commit || !commit.for) return;
    const key = commit.id;
    if(notifyTimers.has(key)){ clearTimeout(notifyTimers.get(key)); notifyTimers.delete(key); }
    if(!commit.reminderEnabled) return;
    // parse time
    const t = commit.reminderTime || commit.reminder || commit.reminderTime || null;
    const timeStr = commit.reminderTime || commit.reminder || commit.commitReminderTime || null;
    if(!timeStr) return;
    const [hh,mm] = (timeStr||'00:00').split(':').map(Number);
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if(next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    const id = setTimeout(function tick(){
      showSystemNotification('Reminder: ' + commit.text, 'Time for: ' + commit.text);
      // reschedule next day
      const n = new Date(); n.setDate(n.getDate()+1); n.setHours(hh,mm,0,0);
      const d = n.getTime() - Date.now();
      const tid = setTimeout(tick, d);
      notifyTimers.set(key, tid);
    }, delay);
    notifyTimers.set(key, id);
  }

  // Weekly scheduling helpers for N-times-per-week commitments
  function weekStartDate(d){
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = date.getDay(); // 0 (Sun) - 6
    const diff = (day + 6) % 7; // days since Monday
    date.setDate(date.getDate() - diff);
    date.setHours(0,0,0,0);
    return date;
  }

  function countCompletionsThisWeek(commit, refDate){
    if(!commit || !commit.history) return 0;
    const start = weekStartDate(refDate).toISOString().slice(0,10);
    const end = new Date(weekStartDate(refDate)); end.setDate(end.getDate()+7);
    const endStr = end.toISOString().slice(0,10);
    return (commit.history||[]).filter(d => d >= start && d < endStr).length;
  }

  function findNextReminderDateForWeekly(commit, nowDate){
    const weeklyTarget = commit.weeklyTarget || null;
    if(!weeklyTarget) return null;
    const start = weekStartDate(nowDate);
    const completed = countCompletionsThisWeek(commit, nowDate);
    const remaining = Math.max(0, weeklyTarget - completed);
    // if already satisfied this week, schedule for next week's start
    if(remaining === 0){ const next = new Date(start); next.setDate(start.getDate()+7); return next; }
    // pick earliest day from today..endOfWeek
    const todayStr = nowDate.toISOString().slice(0,10);
    for(let i=0;i<7;i++){
      const day = new Date(start); day.setDate(start.getDate()+i);
      const dstr = day.toISOString().slice(0,10);
      if(dstr < todayStr) continue;
      return day;
    }
    // fallback to next week start
    const next = new Date(start); next.setDate(start.getDate()+7); return next;
  }

  function scheduleReminderFor(commit){
    // enhanced scheduler that supports weekly N-times targets
    if(!commit || !commit.for) return;
    const key = commit.id;
    if(notifyTimers.has(key)){ clearTimeout(notifyTimers.get(key)); notifyTimers.delete(key); }
    if(!commit.reminderEnabled) return;
    const timeStr = commit.reminderTime || null;
    if(!timeStr) return;
    const [hh,mm] = timeStr.split(':').map(Number);
    const now = new Date();
    let nextDate = null;
    if(commit.weeklyTarget){
      // choose next date that helps satisfy weekly target
      nextDate = findNextReminderDateForWeekly(commit, now);
    } else {
      // default: next occurrence (today if later else tomorrow)
      nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      if(nextDate <= now) nextDate.setDate(nextDate.getDate()+1);
    }
    if(!nextDate) return;
    // set to the configured time
    nextDate.setHours(hh, mm, 0, 0);
    const delay = nextDate.getTime() - now.getTime();
    const id = setTimeout(function tick(){
      showSystemNotification('Reminder: ' + commit.text, 'Time for: ' + commit.text);
      // after firing, reschedule based on same rules
      scheduleReminderFor(commit);
    }, Math.max(0, delay));
    notifyTimers.set(key, id);
  }

  function scheduleAllReminders(){
    for(const c of state.commitments.filter(x=>x.for===currentUser)) scheduleReminderFor(c);
  }


  function renderUsers(){
    userSelect.innerHTML = '';
    commitFor.innerHTML = '';
    state.users.forEach(u => {
      const opt = document.createElement('option'); opt.value = u.id; opt.textContent = u.name;
      userSelect.appendChild(opt);
      const opt2 = opt.cloneNode(true);
      commitFor.appendChild(opt2);
    });
    userSelect.value = currentUser;
  }

  function renderList(){
    commitList.innerHTML = '';
    const visible = state.commitments.filter(c => c.for === currentUser);
    if(visible.length === 0){
      commitList.innerHTML = '<li class="small muted">No commitments yet for this user.</li>';
      return;
    }
    visible.forEach(c => {
      c.history = c.history || [];
      const li = document.createElement('li');
      const meta = document.createElement('div'); meta.className='card-main';
      const titleRow = document.createElement('div'); titleRow.className='card-title';
      const icon = document.createElement('div'); icon.className='card-icon';
      icon.textContent = c.achieved ? '🏆' : c.doneToday ? '✅' : '📌';
      const textWrapper = document.createElement('div'); textWrapper.className='card-text';
      const labelHtml = c.label ? `<span class="label-badge">${escapeHtml(c.label)}</span> ` : '';
      const achievedHtml = c.achieved ? `<span class="achieved-badge">Achieved</span> ` : '';
      let sched = 'Daily';
      if(c.schedule === 'weekdays') sched = 'Weekdays (Mon–Fri)';
      else if(c.schedule === 'twice') sched = 'Twice a week';
      else if(c.schedule === 'three') sched = 'Three times a week';
      else if(c.schedule === 'four') sched = 'Four times a week';
      else if(c.schedule === 'custom' && Array.isArray(c.scheduleDays)) sched = `Custom: ${c.scheduleDays.join(', ')}`;
      const targetHtml = c.target ? ` · Streak: ${c.streak||0} / ${c.target}` : ` · Streak: ${c.streak||0}`;
      textWrapper.innerHTML = `${labelHtml}${achievedHtml}<strong>${escapeHtml(c.text)}</strong><div class="card-meta">${c.enabled ? 'Enabled' : 'Disabled'} · ${sched}${targetHtml}</div>`;
      titleRow.appendChild(icon);
      titleRow.appendChild(textWrapper);
      meta.appendChild(titleRow);
      if(c.target){
        const progress = document.createElement('div'); progress.className = 'card-progress';
        const percent = Math.min(100, Math.round(((c.streak||0) / c.target) * 100));
        progress.innerHTML = `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-text">${c.streak||0} / ${c.target} days streak (${percent}%)</div>`;
        meta.appendChild(progress);
      }
      // weekly progress for N-times-per-week schedules
      if(c.weeklyTarget){
        const weeklyCount = countCompletionsThisWeek(c, new Date());
        const wPercent = Math.min(100, Math.round((weeklyCount / c.weeklyTarget) * 100));
        const wp = document.createElement('div'); wp.className='weekly-progress';
        wp.innerHTML = `<div class="weekly-meta">This week: <strong>${weeklyCount}</strong> / ${c.weeklyTarget}</div><div class="weekly-bar"><div class="weekly-fill" style="width:${wPercent}%"></div></div>`;
        meta.appendChild(wp);
      }

      const controls = document.createElement('div'); controls.className='card-actions';

      const done = document.createElement('label');
      done.className = 'toggle-switch';
      done.innerHTML = `<input type="checkbox" ${c.doneToday? 'checked':''}/><span class="toggle-slider"></span><span class="toggle-label">Done</span>`;
      const doneCheckbox = done.querySelector('input');
      doneCheckbox.title = 'Mark done for today';
      doneCheckbox.addEventListener('change', ()=>{
        // update streak/lastDone locally
        const today = new Date().toISOString().slice(0,10);
        const yesterday = new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,10);
        if(doneCheckbox.checked){
          if(c.lastDone === yesterday) c.streak = (c.streak||0) + 1; else c.streak = 1;
          c.lastDone = today;
          c.doneToday = true;
        } else {
          c.doneToday = false;
        }
        // maintain local history
        c.history = c.history || [];
        if(doneCheckbox.checked){ if(!c.history.includes(today)) c.history.push(today);
          // check target locally and mark achieved
          if(c.target && c.streak >= c.target && !c.achieved){ c.achieved = true; c.achievedAt = today; }
        }
        else { const idx = c.history.indexOf(today); if(idx>=0) c.history.splice(idx,1); }
        save(state);
        renderList();
        // reschedule reminders after status change
        scheduleReminderFor(c);
        // update remote if available
        if(authToken && c.remoteId){
          fetch(apiBase() + '/api/commitments/' + c.remoteId, { method: 'PUT', headers: { 'content-type':'application/json', 'authorization':'Bearer '+authToken }, body: JSON.stringify({ text: c.text, enabled: c.enabled, doneToday: c.doneToday, schedule: c.schedule, label: c.label, target: c.target, achieved: c.achieved, achievedAt: c.achievedAt }) }).then(r=>r.json()).then(j=>{
            if(j && j.streak!==undefined) { c.streak = j.streak; c.lastDone = j.lastDone; c.achieved = j.achieved||c.achieved; c.achievedAt = j.achievedAt||c.achievedAt; save(state); renderList(); }
          }).catch(()=>{});
        }
      });

      const enabled = document.createElement('label');
      enabled.className = 'toggle-switch';
      enabled.innerHTML = `<input type="checkbox" ${c.enabled? 'checked':''}/><span class="toggle-slider"></span><span class="toggle-label">Enabled</span>`;
      const enabledCheckbox = enabled.querySelector('input');
      enabledCheckbox.title = 'Enabled for this user';
      enabledCheckbox.addEventListener('change', ()=>{
        c.enabled = enabledCheckbox.checked;
        save(state);
        renderList();
      });

      const commentPreview = document.createElement('div');
      commentPreview.className = 'comment-preview';
      commentPreview.textContent = c.comments && c.comments.length ? `Latest meow: ${c.comments[c.comments.length-1]}` : 'No meows yet.';
      meta.appendChild(commentPreview);

      const pawsBtn = document.createElement('button');
      pawsBtn.className = 'paw-button';
      pawsBtn.textContent = `🐾 Paw ${c.paws ? `(${c.paws})` : ''}`;
      pawsBtn.addEventListener('click', ()=>{
        c.paws = (c.paws || 0) + 1;
        save(state);
        renderList();
        showToast('Paw sent!', `You cheered on “${c.text}”.`);
      });

      const commentBtn = document.createElement('button');
      commentBtn.textContent = 'Leave a Meow';
      commentBtn.addEventListener('click', ()=>{
        const message = prompt('Send a cat encouragement note:', 'Keep going, fur friend!');
        if(!message) return;
        c.comments = c.comments || [];
        c.comments.push(message.trim());
        save(state);
        renderList();
        showToast('Meow added!', 'Your encouragement is now part of this commitment.');
      });

      const histBtn = document.createElement('button'); histBtn.textContent='History';
      histBtn.addEventListener('click', ()=>{ showHistory(c); });

      const remindToggle = document.createElement('label');
      remindToggle.className = 'toggle-switch';
      remindToggle.innerHTML = `<input type="checkbox" ${c.reminderEnabled? 'checked':''}/><span class="toggle-slider"></span><span class="toggle-label">Reminder</span>`;
      const remindCheckbox = remindToggle.querySelector('input');
      remindCheckbox.addEventListener('change', ()=>{ c.reminderEnabled = remindCheckbox.checked; save(state); if(c.reminderEnabled) scheduleReminderFor(c); else { if(notifyTimers.has(c.id)){ clearTimeout(notifyTimers.get(c.id)); notifyTimers.delete(c.id); } } renderList(); });

      const remindTimeInput = document.createElement('input'); remindTimeInput.type='time'; remindTimeInput.value = c.reminderTime || '';
      remindTimeInput.addEventListener('change', ()=>{ c.reminderTime = remindTimeInput.value; save(state); if(c.reminderEnabled) scheduleReminderFor(c); });

      const del = document.createElement('button'); del.textContent='Delete';
      del.addEventListener('click', ()=>{
        state.commitments = state.commitments.filter(x=>x.id!==c.id);
        save(state);
        renderList();
      });

      controls.appendChild(done);
      controls.appendChild(enabled);
      controls.appendChild(pawsBtn);
      controls.appendChild(commentBtn);
      controls.appendChild(remindToggle);
      controls.appendChild(remindTimeInput);
      controls.appendChild(histBtn);
      controls.appendChild(del);

      li.appendChild(meta);
      li.appendChild(controls);
      commitList.appendChild(li);
    });
  }

  // Remote sync helpers
  function apiBase(){
    return apiBaseInput.value || 'http://localhost:3000';
  }

  async function register(){
    const name = authName.value.trim();
    const password = authPass.value;
    if(!name||!password) return alert('enter name+password');
    const res = await fetch(apiBase() + '/api/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, password }) });
    const j = await res.json();
    if(res.ok){ setToken(j.token); alert('registered'); } else alert(j.error||JSON.stringify(j));
  }

  async function login(){
    const name = authName.value.trim();
    const password = authPass.value;
    if(!name||!password) return alert('enter name+password');
    const res = await fetch(apiBase() + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, password }) });
    const j = await res.json();
    if(res.ok){ setToken(j.token); alert('logged in'); } else alert(j.error||JSON.stringify(j));
  }

  function setToken(t){
    authToken = t; if(t){ localStorage.setItem('accountability:token', t); localStorage.setItem('accountability:api', apiBase()); btnLogout.style.display='inline'; } else { localStorage.removeItem('accountability:token'); btnLogout.style.display='none'; }
  }

  btnRegister.addEventListener('click', register);
  btnLogin.addEventListener('click', login);
  btnLogout.addEventListener('click', ()=>{ setToken(null); alert('logged out'); });

  // Push local commitments to remote for current logged-in user (create/replace)
  async function syncPush(){
    if(!authToken) return alert('login first');
    // push local commitments for currentUser
    const toPush = state.commitments.filter(c=>c.for===currentUser);
    for(const c of toPush){
      // create remote commitment
      try{
        const res = await fetch(apiBase() + '/api/commitments', { method: 'POST', headers: { 'content-type':'application/json', 'authorization': 'Bearer '+authToken }, body: JSON.stringify({ text: c.text, enabled: c.enabled, schedule: c.schedule, label: c.label, target: c.target, achieved: c.achieved, achievedAt: c.achievedAt }) });
        if(res.ok){ const j = await res.json(); c.remoteId = j.id; c.streak = j.streak||0; c.lastDone = j.lastDone||null; c.achieved = j.achieved||c.achieved; c.achievedAt = j.achievedAt||c.achievedAt; save(state); }
      }catch(e){ /* ignore per-item errors */ }
    }
    alert('push complete');
  }

  async function syncPull(){
    if(!authToken) return alert('login first');
    const res = await fetch(apiBase() + '/api/commitments', { headers: { 'authorization': 'Bearer '+authToken } });
    if(!res.ok) return alert('pull failed');
    const list = await res.json();
    // replace local commitments for currentUser with pulled ones
    state.commitments = state.commitments.filter(c=>c.for!==currentUser);
    for(const r of list){ state.commitments.push({ id: 'r'+r.id, text: r.text, for: currentUser, enabled: !!r.enabled, doneToday: !!r.doneToday, schedule: r.schedule||'daily', streak: r.streak||0, lastDone: r.lastDone||null, remoteId: r.id }); }
    for(const r of list){ state.commitments.push({ id: 'r'+r.id, text: r.text, for: currentUser, enabled: !!r.enabled, doneToday: !!r.doneToday, schedule: r.schedule||'daily', streak: r.streak||0, lastDone: r.lastDone||null, remoteId: r.id, label: r.label||null, target: r.target||null, achieved: !!r.achieved, achievedAt: r.achievedAt||null, history: [] }); }
    save(state);
    renderList();
    alert('pull complete');
  }

  btnSync.addEventListener('click', async ()=>{
    const ok = confirm('Sync: push local -> remote? (OK) Pull remote -> local? (Cancel)');
    if(ok) await syncPush(); else await syncPull();
  });

  // show logout button if token exists
  if(authToken) btnLogout.style.display='inline';

  // History modal elements
  const histModal = document.getElementById('historyModal');
  const histClose = document.getElementById('histClose');
  const histTitle = document.getElementById('histTitle');
  const histHeatmap = document.getElementById('histHeatmap');
  histClose.addEventListener('click', ()=>{ histModal.style.display='none'; histHeatmap.innerHTML=''; });

  function getLastNDates(n){
    const out = [];
    for(let i = n-1;i>=0;i--){
      const d = new Date(Date.now() - i*24*60*60*1000).toISOString().slice(0,10);
      out.push(d);
    }
    return out;
  }

  function renderHeatmap(entries, days){
    // entries: array of YYYY-MM-DD strings OR objects {date, count}
    const all = getLastNDates(days || 30);
    histHeatmap.innerHTML = '';
    const map = new Map();
    if(Array.isArray(entries)){
      entries.forEach(e=>{
        if(!e) return;
        if(typeof e === 'string') map.set(e, Math.max(1, (map.get(e)||0)));
        else if(e.date) map.set(e.date, Math.max(e.count||1, (map.get(e.date)||0)));
      });
    }
    // compute max for scaling
    let maxCount = 0; for(const v of map.values()) if(v>maxCount) maxCount = v;
    all.forEach(day => {
      const el = document.createElement('div'); el.className='day';
      const count = map.get(day) || 0;
      let level = 0;
      if(count>0){
        if(maxCount <= 1) level = 1; else level = Math.ceil((count / maxCount) * 3);
      }
      el.classList.add('level-' + level);
      el.title = day + (count? ` — done x${count}` : '');
      histHeatmap.appendChild(el);
    });
  }

  async function showHistory(commit){
    histModal.style.display='flex';
    histTitle.textContent = commit.text + ' — history';
    const zoomSelect = document.getElementById('histZoom');
    function renderForZoom(){
      const days = parseInt(zoomSelect.value,10) || 30;
      // prefer remote history if available
      if(authToken && commit.remoteId){
        fetch(apiBase() + '/api/commitments/' + commit.remoteId + '/history', { headers: { 'authorization': 'Bearer '+authToken } }).then(r=>r.ok? r.json() : Promise.resolve(null)).then(dates=>{
          if(dates) renderHeatmap(dates, days); else renderHeatmap(commit.history||[], days);
        }).catch(()=>{ renderHeatmap(commit.history||[], days); });
      } else {
        renderHeatmap(commit.history||[], days);
      }
    }
    zoomSelect.removeEventListener('change', renderForZoom);
    zoomSelect.addEventListener('change', renderForZoom);
    renderForZoom();
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>\"]/g, ch=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
    }[ch]));
  }

  // Handlers
  userSelect.addEventListener('change', (e)=>{
    currentUser = e.target.value;
    renderList();
  });

  addForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const text = commitText.value.trim();
    if(!text) return;
    const forUser = commitFor.value;
    const enabled = commitEnabled.checked;
    const schedule = (typeof commitSchedule !== 'undefined' && commitSchedule.value) ? commitSchedule.value : 'daily';
    let scheduleDays = null;
    if(schedule === 'custom'){
      scheduleDays = Array.from(document.querySelectorAll('#customDays input[name="commitDay"]:checked')).map(i=>i.value);
      if(scheduleDays.length === 0){ alert('Select at least one day for a custom schedule'); return; }
    }
    const label = commitLabel ? (commitLabel.value.trim() || null) : null;
    const target = commitTarget ? (commitTarget.value ? parseInt(commitTarget.value,10) : null) : null;
    const reminderEnabled = commitReminderEnabled ? !!commitReminderEnabled.checked : false;
    const reminderTime = commitReminderTime ? (commitReminderTime.value || null) : null;
    const weeklyTarget = schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null));
    const newCommit = { id: uid(), text, for: forUser, enabled, doneToday:false, schedule, scheduleDays, streak:0, lastDone:null, remoteId:null, history: [], label, target, reminderEnabled, reminderTime, paws:0, comments: [], weeklyTarget };
    state.commitments.push(newCommit);
    save(state);
    commitText.value='';
    if(commitLabel) commitLabel.value='';
    if(commitTarget) commitTarget.value='';
    if(commitReminderEnabled) commitReminderEnabled.checked = false;
    if(commitReminderTime) commitReminderTime.value = '';
    renderList();
    // schedule reminder for this new commit
    scheduleReminderFor(newCommit);
  });

  // Initial render
  renderUsers();
  renderList();
  // schedule reminders for current user
  scheduleAllReminders();

  // Expose for debugging
  window._accountability = { state, save };
})();
