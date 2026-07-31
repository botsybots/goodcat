import { localDateKey, parseLocalDate, nextLocalDate, prevLocalDate, getDayKey, weekStartDate } from './date-utils.js';
import { isScheduledDay, isWeeklyTargetSchedule, getScheduleDescription, countCompletionsThisWeek, computeStreak, computeWeeklyStreak } from './schedule-utils.js';

// Simple Accountability App (localStorage-backed)
(function(){
  const DEFAULT_USERS = [
    { id: 'anna', name: 'Anna' },
    { id: 'jordan', name: 'Jordan' }
  ];

  const STORAGE_KEY = 'accountability:data:v1';
  const DEFAULT_API_BASE = 'https://goodcat-api.onrender.com';
  const LABEL_ICONS = { Health: '🩺', Fitness: '💪', Education: '📚', Cleanliness: '🧹', Relationship: '💞' };

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
  let editingCommitId = null;

  // DOM refs
  const commitFor = document.getElementById('commitFor');
  const activeUserSelect = document.getElementById('activeUserSelect');
  const addForm = document.getElementById('addForm');
  const commitText = document.getElementById('commitText');
  const commitEnabled = document.getElementById('commitEnabled');
  const commitSchedule = document.getElementById('commitSchedule');
  const commitListAnna = document.getElementById('commitList-anna');
  const commitListJordan = document.getElementById('commitList-jordan');
  const commitLabel = document.getElementById('commitLabel');
  const commitTarget = document.getElementById('commitTarget');
  const commitStartDate = document.getElementById('commitStartDate');
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
  const btnEnableNotify = document.getElementById('btnEnableNotify');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');
  const notifyStatus = document.getElementById('notifyStatus');
  const livesAnna = document.getElementById('lives-anna');
  const livesJordan = document.getElementById('lives-jordan');
  const councilAnna = document.getElementById('council-anna');
  const councilJordan = document.getElementById('council-jordan');
  const ackAnna = document.getElementById('ack-anna');
  const ackJordan = document.getElementById('ack-jordan');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsClose = document.getElementById('settingsClose');
  const debugPanel = document.getElementById('debugPanel');
  const btnShowState = document.getElementById('btnShowState');
  const debugState = document.getElementById('debugState');
  const debugCurrentDate = document.getElementById('debugCurrentDate');
  const debugJumpDays = document.getElementById('debugJumpDays');
  const btnDebugJump = document.getElementById('btnDebugJump');
  const btnDebugResetDate = document.getElementById('btnDebugResetDate');
  const btnDebugRunCheck = document.getElementById('btnDebugRunCheck');
  const debugLivesAnna = document.getElementById('debugLivesAnna');
  const debugLivesJordan = document.getElementById('debugLivesJordan');
  const btnDebugSetLives = document.getElementById('btnDebugSetLives');
  const addButton = document.getElementById('addButton');
  const addModal = document.getElementById('addModal');
  const addClose = document.getElementById('addClose');
  const loginStatus = document.getElementById('loginStatus');
  const authGate = document.getElementById('authGate');
  const authGateStatus = document.getElementById('authGateStatus');
  const START_LIVES = 9;
  const MAX_LIVES = 9;
  const RESET_LIVES_AFTER_COUNCIL = 3;

  function decodeJwtPayload(token){
    try{
      const base64 = token.split('.')[1];
      const json = decodeURIComponent(atob(base64.replace(/-/g,'+').replace(/_/g,'/')).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    }catch(e){ return null; }
  }

  // iOS in particular doesn't reliably guarantee that a home-screen-installed
  // web app's localStorage survives the way a regular Safari tab's does --
  // it can get evicted under storage pressure, silently logging you back out
  // and re-showing the login gate. Asking for persistent storage tells the
  // browser not to do that. Not all browsers support/grant this, but it's
  // harmless where it isn't.
  if(navigator.storage && navigator.storage.persist){
    navigator.storage.persist().catch(()=>{});
  }

  let authToken = localStorage.getItem('accountability:token') || null;
  let syncIntervalId = null;
  apiBaseInput.value = localStorage.getItem('accountability:api') || DEFAULT_API_BASE;
  if(authToken){
    const payload = decodeJwtPayload(authToken);
    if(payload) adoptIdentityFromLogin(payload);
    setToken(authToken);
  } else {
    setLoginStatus('Logged out');
    if(authGate) authGate.classList.remove('hidden');
  }

  // Notification controls
  let notifyTimers = new Map();
  function updateNotifyStatus(){ notifyStatus.textContent = 'Permission: ' + (typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'); }
  updateNotifyStatus();
  btnEnableNotify.addEventListener('click', async ()=>{
    if(typeof Notification === 'undefined') return alert('Notifications not supported in this browser.');
    const p = await Notification.requestPermission(); updateNotifyStatus();
    if(p==='granted'){
      // register service worker and subscribe for push
      try{
        const reg = await navigator.serviceWorker.register('service-worker.js');
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

  function userName(id){
    const user = state.users.find(u => u.id === id);
    return user ? user.name : id;
  }

  // Once logged in, each phone belongs to one person -- their identity comes
  // from login, not the "You are" dropdown, and they can only edit their own
  // habits. Logged out (or never logged in), the app behaves exactly as
  // before: one shared device, either column editable, no server involved.
  function isRemoteMode(){
    return !!authToken;
  }

  function canEditCommit(c){
    return !isRemoteMode() || c.for === currentUser;
  }

  function lockIdentityControls(locked){
    if(activeUserSelect) activeUserSelect.disabled = locked;
    if(commitFor) commitFor.disabled = locked;
  }

  // The app's "now" — real wall-clock time, shifted forward by any debug day
  // offset set via the debug tools panel. Everything that decides what
  // counts as "today" for habits/streaks/lives goes through this, so jumping
  // the date forward for testing behaves consistently everywhere. Real-time
  // browser reminders (scheduleReminderFor) deliberately do NOT use this —
  // they stay tied to actual wall-clock time.
  function getEffectiveNow(){
    const d = new Date();
    d.setDate(d.getDate() + (state.debugDayOffset || 0));
    d.setHours(0,0,0,0);
    return d;
  }

  function appToday(){
    return localDateKey(getEffectiveNow());
  }

  function getCommitCreatedDate(commit){
    return commit.createdAt ? commit.createdAt : appToday();
  }

  // Reuse schedule helpers from schedule-utils.js

  function rebuildStreak(commit){
    if(!commit || !commit.history) return 0;
    if(isWeeklyTargetSchedule(commit)) return computeWeeklyStreak(commit, commit.history, appToday());
    return computeStreak(commit, commit.history, appToday());
  }

  function updateCommitStatusFromHistory(commit){
    if(!commit) return;
    commit.history = commit.history || [];
    commit.streak = rebuildStreak(commit);
    commit.doneToday = commit.history.includes(appToday());
    if(commit.target && commit.streak >= commit.target){
      commit.achieved = true;
      commit.achievedAt = commit.achievedAt || appToday();
    } else if(commit.target && commit.streak < commit.target){
      commit.achieved = false;
    }
  }

  function ensureLifeState(){
    if(!state.lives) state.lives = { anna: START_LIVES, jordan: START_LIVES };
    state.lives.anna = Math.min(MAX_LIVES, Math.max(0, state.lives.anna));
    state.lives.jordan = Math.min(MAX_LIVES, Math.max(0, state.lives.jordan));
    if(!state.lifeLastEvaluatedDate) state.lifeLastEvaluatedDate = { anna: null, jordan: null };
    if(!state.lifeGains) state.lifeGains = { anna: {}, jordan: {} };
    if(!state.lifeLosses) state.lifeLosses = { anna: {}, jordan: {} };
    if(!state.weeklyLifeLosses) state.weeklyLifeLosses = { anna: {}, jordan: {} };
    if(!state.lifeCouncilAck) state.lifeCouncilAck = { anna: false, jordan: false };
  }

  // Day-based commitments only (daily/weekdays/custom) — "N times a week"
  // commitments aren't due on any particular calendar day, so they're
  // evaluated separately, once per week, in getUserWeeklyComplianceForWeek().
  function getUserScheduledCountsForDate(userId, date){
    const commits = state.commitments.filter(c => c.for === userId && c.enabled && !isWeeklyTargetSchedule(c));
    const isoDate = localDateKey(date);
    let scheduled = 0;
    let done = 0;
    for(const commit of commits){
      const created = getCommitCreatedDate(commit);
      if(created > isoDate) continue;
      if(isScheduledDay(commit, isoDate)){
        scheduled += 1;
        if(Array.isArray(commit.history) && commit.history.includes(isoDate)) done += 1;
      }
    }
    return { scheduled, done };
  }

  // Aggregate weekly-target ("twice/three/four a week") compliance for one
  // user across a single week, so a habit only costs a life once at that
  // week's end (Sunday), and only if its weekly quota wasn't met — never on
  // the other days of the week.
  function getUserWeeklyComplianceForWeek(userId, weekStartDateObj){
    const weekEndIso = localDateKey(new Date(weekStartDateObj.getTime() + 6 * 24 * 60 * 60 * 1000));
    const commits = state.commitments.filter(c => c.for === userId && c.enabled && isWeeklyTargetSchedule(c));
    let total = 0;
    let compliant = 0;
    for(const commit of commits){
      const created = getCommitCreatedDate(commit);
      if(created > weekEndIso) continue;
      total += 1;
      const count = countCompletionsThisWeek(commit, weekStartDateObj);
      if(count >= (commit.weeklyTarget || 0)) compliant += 1;
    }
    return { total, compliant };
  }

  function getWindowDates(endDate, windowSize = 7){
    const dates = [];
    let cursor = parseLocalDate(endDate);
    if(!cursor) return dates;
    for(let i = 0; i < windowSize; i += 1){
      dates.unshift(localDateKey(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }
    return dates;
  }

  function updateLivesForUser(userId){
    ensureLifeState();
    const today = appToday();
    const yesterday = prevLocalDate(today);
    let startDate = state.lifeLastEvaluatedDate[userId] ? nextLocalDate(state.lifeLastEvaluatedDate[userId]) : null;
    if(!startDate){
      const createdDates = state.commitments.filter(c=>c.for===userId).map(getCommitCreatedDate).filter(Boolean);
      const historyDates = state.commitments.filter(c=>c.for===userId && Array.isArray(c.history)).flatMap(c=>c.history);
      const allDates = [...createdDates, ...historyDates];
      startDate = allDates.length ? allDates.reduce((a,b)=> a < b ? a : b) : today;
    }
    if(!startDate) startDate = today;
    let cursor = parseLocalDate(startDate);
    const end = parseLocalDate(yesterday);
    if(!cursor || !end || cursor > end) return;
    while(cursor <= end){
      const dayKey = localDateKey(cursor);
      const counts = getUserScheduledCountsForDate(userId, dayKey);
      if(counts.scheduled > 0 && counts.done < counts.scheduled){
        if(!state.lifeLosses[userId][dayKey]){
          state.lifeLosses[userId][dayKey] = true;
          state.lives[userId] = Math.max(0, state.lives[userId] - 1);
          if(dayKey === yesterday || dayKey === today) showToast('Bots is judging you', `${userName(userId)} missed a scheduled habit.`);
        }
      }
      // "N times a week" habits are only judged once, at the end of their
      // week (Sunday) — never on the other days — so a "twice a week" habit
      // can't cost a life on the five days it isn't due.
      if(getDayKey(dayKey) === 'sun'){
        const weekStart = weekStartDate(cursor);
        const weekStartIso = localDateKey(weekStart);
        if(!state.weeklyLifeLosses[userId][weekStartIso]){
          const compliance = getUserWeeklyComplianceForWeek(userId, weekStart);
          if(compliance.total > 0 && compliance.compliant < compliance.total){
            state.weeklyLifeLosses[userId][weekStartIso] = true;
            state.lives[userId] = Math.max(0, state.lives[userId] - 1);
            if(dayKey === yesterday || dayKey === today) showToast('Bots is judging you', `${userName(userId)} missed a weekly target.`);
          }
        }
      }
      const window = getWindowDates(dayKey, 7);
      if(window.length === 7){
        const totals = window.reduce((acc, date) => {
          const counts = getUserScheduledCountsForDate(userId, date);
          acc.scheduled += counts.scheduled;
          acc.done += counts.done;
          return acc;
        }, { scheduled:0, done:0 });
        if(totals.scheduled > 0){
          const ratio = totals.done / totals.scheduled;
          let gain = 0;
          if(ratio >= 1) gain = 2;
          else if(ratio >= 0.9) gain = 1;
          if(gain > 0 && !state.lifeGains[userId][dayKey]){
            state.lifeGains[userId][dayKey] = gain;
            state.lives[userId] = Math.min(MAX_LIVES, state.lives[userId] + gain);
            if(dayKey === yesterday || dayKey === today){
              showToast('Loki is pleased with ' + userName(userId), `Great job keeping up with scheduled habits.`);
            }
          }
        }
      }
      state.lifeLastEvaluatedDate[userId] = dayKey;
      cursor.setDate(cursor.getDate() + 1);
    }
    save(state);
  }

  function processCouncilAcknowledgement(userId){
    state.lifeCouncilAck[userId] = true;
    if(state.lifeCouncilAck.anna && state.lifeCouncilAck.jordan){
      state.lives.anna = RESET_LIVES_AFTER_COUNCIL;
      state.lives.jordan = RESET_LIVES_AFTER_COUNCIL;
      state.lifeCouncilAck.anna = false;
      state.lifeCouncilAck.jordan = false;
      showToast('Family council complete', 'Lives have been reset to 3 for both people.');
    }
    save(state);
    renderLives();
  }

  function renderLives(){
    ensureLifeState();
    if(livesAnna) livesAnna.textContent = `${state.lives.anna} / ${MAX_LIVES}`;
    if(livesJordan) livesJordan.textContent = `${state.lives.jordan} / ${MAX_LIVES}`;
    if(councilAnna) councilAnna.classList.toggle('hidden', !(state.lives.anna <= 0));
    if(councilJordan) councilJordan.classList.toggle('hidden', !(state.lives.jordan <= 0));
  }

  function findNextReminderDateForWeekly(commit, nowDate){
    const weeklyTarget = commit.weeklyTarget || null;
    if(!weeklyTarget) return null;
    const start = weekStartDate(nowDate);
    const completed = countCompletionsThisWeek(commit, nowDate);
    const remaining = Math.max(0, weeklyTarget - completed);
    if(remaining === 0){ const next = new Date(start); next.setDate(start.getDate()+7); return next; }
    const todayStr = localDateKey(nowDate);
    for(let i=0;i<7;i++){
      const day = new Date(start); day.setDate(start.getDate()+i);
      const dstr = localDateKey(day);
      if(dstr < todayStr) continue;
      return day;
    }
    const next = new Date(start); next.setDate(start.getDate()+7); return next;
  }

  function scheduleReminderFor(commit){
    if(!commit || !commit.for) return;
    const key = commit.id;
    if(notifyTimers.has(key)){ clearTimeout(notifyTimers.get(key)); notifyTimers.delete(key); }
    if(!commit.reminderEnabled) return;
    const timeStr = commit.reminderTime || null;
    if(!timeStr) return;
    const [hh,mm] = timeStr.split(':').map(Number);
    const now = new Date();
    let nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if(nextDate <= now) nextDate.setDate(nextDate.getDate()+1);
    const delay = nextDate.getTime() - now.getTime();
    const id = setTimeout(function tick(){
      showSystemNotification('Reminder: ' + commit.text, 'Time for: ' + commit.text);
      scheduleReminderFor(commit);
    }, Math.max(0, delay));
    notifyTimers.set(key, id);
  }

  function scheduleAllReminders(){
    for(const c of state.commitments) scheduleReminderFor(c);
  }


  function renderUsers(){
    commitFor.innerHTML = '';
    if(activeUserSelect) activeUserSelect.innerHTML = '';
    state.users.forEach(u => {
      const opt = document.createElement('option'); opt.value = u.id; opt.textContent = u.name;
      commitFor.appendChild(opt);
      if(activeUserSelect){ const opt2 = opt.cloneNode(true); activeUserSelect.appendChild(opt2); }
    });
    if(!state.users.find(u => u.id === currentUser)) currentUser = state.users[0]?.id || 'anna';
    commitFor.value = currentUser;
    if(activeUserSelect) activeUserSelect.value = currentUser;
  }

  // Overflow ("...") menus: only one open at a time, closed by clicking
  // anywhere outside a menu/menu-button, or automatically whenever the list
  // re-renders (every state-changing action calls renderList()).
  function closeAllCardMenus(){
    document.querySelectorAll('.card-menu:not(.hidden)').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('.card-menu-btn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  function toggleCardMenu(menuEl, btnEl){
    const isHidden = menuEl.classList.contains('hidden');
    closeAllCardMenus();
    if(isHidden){
      menuEl.classList.remove('hidden');
      if(btnEl) btnEl.setAttribute('aria-expanded', 'true');
    }
  }

  // Escape closes an open menu and returns focus to the button that opened
  // it, so keyboard users aren't left with focus stranded on a hidden menu.
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    const openMenu = document.querySelector('.card-menu:not(.hidden)');
    if(!openMenu) return;
    const btn = document.querySelector(`.card-menu-btn[aria-controls="${openMenu.id}"]`);
    closeAllCardMenus();
    if(btn) btn.focus();
  });

  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.card-menu') && !e.target.closest('.card-menu-btn')){
      closeAllCardMenus();
    }
  });

  // Pushes one commitment's current fields to the server: creates it if it
  // has no remoteId yet, otherwise updates it in place. Used after any local
  // change to your own commitment (done-toggle, add/edit, reminder change) so
  // the other person's phone picks it up on its next sync, rather than
  // waiting for a manual push.
  async function pushCommitmentToServer(c){
    if(!authToken) return;
    const payload = {
      text: c.text, enabled: c.enabled, doneToday: c.doneToday, schedule: c.schedule,
      scheduleDays: c.scheduleDays || null, reminderEnabled: c.reminderEnabled || false,
      reminderTime: c.reminderTime || null, weeklyTarget: c.weeklyTarget || null,
      label: c.label || null, target: c.target || null, achieved: c.achieved || false,
      achievedAt: c.achievedAt || null, createdAt: c.createdAt || null
    };
    try{
      let res;
      if(c.remoteId){
        res = await fetch(apiBase() + '/api/commitments/' + c.remoteId, { method: 'PUT', headers: { 'content-type':'application/json', 'authorization':'Bearer '+authToken }, body: JSON.stringify(payload) });
      } else {
        res = await fetch(apiBase() + '/api/commitments', { method: 'POST', headers: { 'content-type':'application/json', 'authorization':'Bearer '+authToken }, body: JSON.stringify(payload) });
      }
      if(res.ok){
        const j = await res.json();
        c.remoteId = j.id || c.remoteId;
        if(j.streak !== undefined) c.streak = j.streak;
        if(j.lastDone !== undefined) c.lastDone = j.lastDone;
        if(j.achieved !== undefined) c.achieved = j.achieved || c.achieved;
        if(j.achievedAt !== undefined) c.achievedAt = j.achievedAt || c.achievedAt;
        save(state);
      }
    }catch(e){ console.error('push commitment failed', e); }
  }

  async function deleteCommitmentFromServer(c){
    if(!authToken || !c.remoteId) return;
    try{
      await fetch(apiBase() + '/api/commitments/' + c.remoteId, { method: 'DELETE', headers: { authorization: 'Bearer '+authToken } });
    }catch(e){ console.error('delete push failed', e); }
  }

  function toggleCommitDone(c){
    if(!canEditCommit(c)){
      showToast('Not yours to mark', `Only ${userName(c.for)} can mark "${c.text}" done.`);
      return;
    }
    const today = appToday();
    c.history = c.history || [];
    if(!c.doneToday){
      if(!c.history.includes(today)) c.history.push(today);
      c.doneToday = true;
      showToast('Loki is pleased with ' + userName(c.for), `${c.text} was completed.`);
    } else {
      c.doneToday = false;
      const idx = c.history.indexOf(today);
      if(idx >= 0) c.history.splice(idx, 1);
    }
    updateCommitStatusFromHistory(c);
    if(c.target && c.streak >= c.target){
      c.achieved = true;
      c.achievedAt = c.achievedAt || today;
    } else if(c.target && c.streak < c.target){
      c.achieved = false;
    }
    if(c.doneToday) c.lastDone = today;
    save(state);
    updateLivesForUser(c.for);
    renderList();
    scheduleReminderFor(c);
    pushCommitmentToServer(c);
  }

  // Once a commitment is synced, the server is the source of truth for paw
  // counts/attribution (c.pawCount/c.lastPaw) since both people's paws need
  // to be visible to each other. Local-only/offline commitments fall back to
  // the plain local pawLog array.
  function lastPawFor(c){
    if(c.lastPaw !== undefined) return c.lastPaw;
    if(Array.isArray(c.pawLog) && c.pawLog.length) return c.pawLog[c.pawLog.length - 1];
    return null;
  }

  function hasPawedToday(c){
    const last = lastPawFor(c);
    return !!last && last.date === appToday();
  }

  function pawCountFor(c){
    if(c.pawCount !== undefined) return c.pawCount;
    return Array.isArray(c.pawLog) ? c.pawLog.length : (c.paws || 0);
  }

  async function givePaw(c, fromUserId){
    if(hasPawedToday(c)) return;
    if(isRemoteMode() && c.remoteId){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/paws', { method: 'POST', headers: { authorization: 'Bearer '+authToken } });
        if(res.ok){
          const j = await res.json();
          c.pawCount = j.pawCount;
          c.lastPaw = j.lastPaw;
        }
      }catch(e){ console.error('paw push failed', e); }
    } else {
      c.pawLog = c.pawLog || [];
      c.pawLog.push({ date: appToday(), by: fromUserId });
    }
    save(state);
    renderList();
    showToast('Paw sent!', `${userName(fromUserId)} cheered on “${c.text}”.`);
  }

  // Comments mirror the same source-of-truth split as paws: server-backed
  // once synced (c.lastComment), plain local array otherwise.
  function lastCommentFor(c){
    if(c.lastComment !== undefined) return c.lastComment;
    if(Array.isArray(c.comments) && c.comments.length){
      const text = c.comments[c.comments.length - 1];
      return typeof text === 'string' ? { text, by: null } : text;
    }
    return null;
  }

  async function addComment(c, fromUserId){
    const text = (prompt('Leave a note on "' + c.text + '"') || '').trim();
    if(!text) return;
    if(isRemoteMode() && c.remoteId){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/comments', { method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ text }) });
        if(res.ok){
          const j = await res.json();
          c.lastComment = j.lastComment;
        }
      }catch(e){ console.error('comment push failed', e); }
    } else {
      c.comments = c.comments || [];
      c.comments.push(text);
    }
    save(state);
    renderList();
    showToast('Meow sent!', `${userName(fromUserId)} left a note.`);
  }

  function renderCommitmentsForUser(userId, targetList){
    targetList.innerHTML = '';
    const visible = state.commitments.filter(c => c.for === userId);
    if(visible.length === 0){
      targetList.innerHTML = '<li class="empty-state small muted">Nothing here yet. Tap + and give the Good Cat something to keep an eye on.</li>';
      return;
    }
    visible.forEach(c => {
      c.history = c.history || [];
      updateCommitStatusFromHistory(c);
      const li = document.createElement('li');
      li.className = 'commit-card';
      li.classList.toggle('is-done', !!c.doneToday);
      li.classList.toggle('is-paused', !c.enabled);

      const owned = canEditCommit(c);
      const topRow = document.createElement('div'); topRow.className = 'card-top-row';
      // The status icon doubles as the keyboard-accessible way to toggle
      // done: tap-anywhere-on-card (below) covers mouse/touch, but a card's
      // own aria-label would otherwise have to summarize (and thus hide from
      // screen readers) all the rich content elsewhere on it -- badges,
      // schedule, progress, paw chip, comments. A small labeled button keeps
      // that content readable while still giving keyboard/AT users a real
      // control. Not owned -> purely decorative, nothing to operate here.
      const icon = document.createElement(owned ? 'button' : 'div');
      icon.className = 'card-status-icon';
      icon.textContent = c.achieved ? '🏆' : c.doneToday ? '✅' : (LABEL_ICONS[c.label] || '📌');
      if(owned){
        icon.type = 'button';
        icon.setAttribute('aria-pressed', c.doneToday ? 'true' : 'false');
        icon.setAttribute('aria-label', c.doneToday ? `Mark "${c.text}" not done` : `Mark "${c.text}" done`);
        icon.addEventListener('click', (e)=>{ e.stopPropagation(); toggleCommitDone(c); });
      } else {
        icon.setAttribute('aria-hidden', 'true');
      }

      const body = document.createElement('div'); body.className='card-body';
      const notStartedYet = c.createdAt && c.createdAt > appToday();
      const badgesHtml = [
        !c.enabled ? '<span class="paused-badge">Paused</span>' : '',
        notStartedYet ? `<span class="paused-badge">Starts ${escapeHtml(c.createdAt)}</span>` : '',
        c.label ? `<span class="label-badge">${LABEL_ICONS[c.label] || ''} ${escapeHtml(c.label)}</span>` : '',
        c.achieved ? '<span class="achieved-badge">Achieved</span>' : ''
      ].filter(Boolean).join(' ');
      body.innerHTML = `
        <strong class="card-name">${escapeHtml(c.text)}</strong>
        ${badgesHtml ? `<div class="card-badges">${badgesHtml}</div>` : ''}
        <div class="card-meta">${getScheduleDescription(c)}</div>
      `;

      const sideActions = document.createElement('div'); sideActions.className = 'card-side-actions';
      const canPaw = c.for !== currentUser;
      if(canPaw){
        const pawBtn = document.createElement('button');
        pawBtn.type = 'button';
        pawBtn.className = 'paw-button';
        const alreadyPawed = hasPawedToday(c);
        pawBtn.textContent = '🐾';
        pawBtn.disabled = alreadyPawed;
        pawBtn.title = alreadyPawed ? 'Already pawed today' : `Send ${userName(c.for)} a paw`;
        pawBtn.setAttribute('aria-label', pawBtn.title);
        pawBtn.addEventListener('click', ()=> givePaw(c, currentUser));
        sideActions.appendChild(pawBtn);
      }
      const menuBtn = document.createElement('button');
      menuBtn.type = 'button';
      menuBtn.className = 'card-menu-btn';
      menuBtn.setAttribute('aria-label', `More actions for "${c.text}"`);
      menuBtn.setAttribute('aria-haspopup', 'true');
      menuBtn.setAttribute('aria-expanded', 'false');
      const menuId = 'card-menu-' + c.id;
      menuBtn.setAttribute('aria-controls', menuId);
      menuBtn.textContent = '⋯';
      sideActions.appendChild(menuBtn);

      topRow.appendChild(icon);
      topRow.appendChild(body);
      topRow.appendChild(sideActions);
      li.appendChild(topRow);

      if(c.target){
        const progress = document.createElement('div'); progress.className = 'card-progress';
        const percent = Math.min(100, Math.round(((c.streak||0) / c.target) * 100));
        progress.innerHTML = `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-text">${c.streak||0} / ${c.target} days (${percent}%)</div>`;
        li.appendChild(progress);
      }
      // weekly progress for N-times-per-week schedules
      if(c.weeklyTarget){
        const weeklyCount = countCompletionsThisWeek(c, getEffectiveNow());
        const wPercent = Math.min(100, Math.round((weeklyCount / c.weeklyTarget) * 100));
        const wp = document.createElement('div'); wp.className='weekly-progress';
        wp.innerHTML = `<div class="weekly-meta">This week: <strong>${weeklyCount}</strong> / ${c.weeklyTarget}</div><div class="weekly-bar"><div class="weekly-fill" style="width:${wPercent}%"></div></div>`;
        li.appendChild(wp);
      }

      const pawCount = pawCountFor(c);
      if(pawCount > 0){
        const lastPaw = lastPawFor(c);
        const pawChip = document.createElement('div'); pawChip.className = 'paw-chip';
        pawChip.textContent = lastPaw && lastPaw.by ? `🐾 ${pawCount} · last from ${userName(lastPaw.by.toLowerCase ? lastPaw.by.toLowerCase() : lastPaw.by)}` : `🐾 ${pawCount}`;
        li.appendChild(pawChip);
      }

      const lastComment = lastCommentFor(c);
      if(lastComment){
        const commentPreview = document.createElement('div');
        commentPreview.className = 'comment-preview';
        const byName = lastComment.by ? userName(lastComment.by.toLowerCase ? lastComment.by.toLowerCase() : lastComment.by) : null;
        commentPreview.textContent = byName ? `Latest meow from ${byName}: ${lastComment.text}` : `Latest meow: ${lastComment.text}`;
        li.appendChild(commentPreview);
      }

      // Overflow menu: Edit/Reminder/Delete are owner-only once logged in;
      // History and Comment are open to both, since viewing/encouraging is
      // the whole point of the other person seeing your habits.
      const menu = document.createElement('div'); menu.className = 'card-menu hidden'; menu.id = menuId;

      if(owned){
        const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='menu-item'; editBtn.textContent = '✏️ Edit';
        editBtn.addEventListener('click', ()=>{ closeAllCardMenus(); openEditCommit(c); });
        menu.appendChild(editBtn);

        // Pausing keeps the commitment and its history, it just stops it
        // counting toward streaks/lives and marks it "Paused" until resumed --
        // the quick way to do that without opening the full edit form.
        const pauseBtn = document.createElement('button'); pauseBtn.type='button'; pauseBtn.className='menu-item';
        pauseBtn.textContent = c.enabled ? '⏸ Pause' : '▶️ Resume';
        pauseBtn.addEventListener('click', ()=>{
          closeAllCardMenus();
          c.enabled = !c.enabled;
          save(state);
          pushCommitmentToServer(c);
          renderList();
        });
        menu.appendChild(pauseBtn);

        const reminderRow = document.createElement('div'); reminderRow.className = 'menu-item menu-reminder';
        const reminderToggle = document.createElement('label'); reminderToggle.className = 'toggle-switch small';
        reminderToggle.innerHTML = `<input type="checkbox" ${c.reminderEnabled ? 'checked':''}/><span class="toggle-slider"></span><span class="toggle-label">Reminder</span>`;
        const reminderCheckbox = reminderToggle.querySelector('input');
        const reminderTimeInput = document.createElement('input');
        reminderTimeInput.type = 'time';
        reminderTimeInput.className = 'menu-reminder-time';
        reminderTimeInput.value = c.reminderTime || '';
        function saveReminder(){
          c.reminderEnabled = reminderCheckbox.checked;
          c.reminderTime = reminderTimeInput.value || null;
          save(state);
          scheduleReminderFor(c);
          pushCommitmentToServer(c);
          renderList();
        }
        reminderCheckbox.addEventListener('change', saveReminder);
        reminderTimeInput.addEventListener('change', saveReminder);
        reminderRow.appendChild(reminderToggle);
        reminderRow.appendChild(reminderTimeInput);
        menu.appendChild(reminderRow);
      }

      const histBtn = document.createElement('button'); histBtn.type='button'; histBtn.className='menu-item'; histBtn.textContent='📅 History';
      histBtn.addEventListener('click', ()=>{ closeAllCardMenus(); showHistory(c); });
      menu.appendChild(histBtn);

      const commentBtn = document.createElement('button'); commentBtn.type='button'; commentBtn.className='menu-item'; commentBtn.textContent='💬 Add a comment';
      commentBtn.addEventListener('click', ()=>{ closeAllCardMenus(); addComment(c, currentUser); });
      menu.appendChild(commentBtn);

      if(owned){
        const del = document.createElement('button'); del.type='button'; del.className='menu-item danger'; del.textContent='🗑 Delete';
        del.addEventListener('click', ()=>{
          closeAllCardMenus();
          if(!confirm(`Delete “${c.text}”? This cannot be undone.`)) return;
          deleteCommitmentFromServer(c);
          state.commitments = state.commitments.filter(x=>x.id!==c.id);
          save(state);
          renderList();
        });
        menu.appendChild(del);
      }
      li.appendChild(menu);

      menuBtn.addEventListener('click', (event)=>{
        event.stopPropagation();
        toggleCardMenu(menu, menuBtn);
      });

      li.addEventListener('click', (event)=>{
        if(event.target.closest('.card-side-actions') || event.target.closest('.card-menu')) return;
        toggleCommitDone(c);
      });
      targetList.appendChild(li);
    });
  }

  function renderList(){
    updateLivesForUser('anna');
    updateLivesForUser('jordan');
    renderCommitmentsForUser('anna', commitListAnna);
    renderCommitmentsForUser('jordan', commitListJordan);
    renderLives();
  }

  // Remote sync helpers
  function apiBase(){
    return apiBaseInput.value || DEFAULT_API_BASE;
  }

  function setLoginStatus(text){
    if(loginStatus) loginStatus.textContent = text || '';
  }

  function exportBackup(){
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `good-cat-backup-${appToday()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Restoring a backup is a deliberate, explicit replace of everything on
  // this device -- unlike sync (which merges live data), a restore is
  // supposed to throw away what's here and load the file instead.
  function importBackup(file){
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(e){ alert('That file is not valid backup JSON.'); return; }
      if(!parsed || !Array.isArray(parsed.commitments) || !Array.isArray(parsed.users)){
        alert('That file does not look like a Good Cat backup.');
        return;
      }
      if(!confirm('Import this backup? This replaces everything currently on this device.')) return;
      // Mutate the existing state object in place (rather than reassigning
      // `state`) so every other reference to it -- including the debug
      // exposure below -- stays correct after a restore.
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, parsed);
      save(state);
      renderUsers();
      renderList();
      scheduleAllReminders();
      showToast('Backup imported', 'Your data has been restored.');
    };
    reader.onerror = () => alert('Could not read that file.');
    reader.readAsText(file);
  }

  // Once logged in as "anna" or "jordan", that becomes who you are on this
  // device -- no more manually picking from the dropdown, since the whole
  // point of separate phones is that each one already knows whose it is.
  function adoptIdentityFromLogin(user){
    const name = (user && user.name || '').toLowerCase();
    if(name === 'anna' || name === 'jordan'){
      currentUser = name;
      renderUsers();
    }
  }

  function setAuthGateStatus(text){
    if(authGateStatus) authGateStatus.textContent = text || '';
  }

  async function register(){
    const name = authName.value.trim();
    const password = authPass.value;
    if(!name||!password) return setAuthGateStatus('Enter a username and password.');
    try{
      const res = await fetch(apiBase() + '/api/register', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, password }) });
      const j = await res.json();
      if(res.ok){
        adoptIdentityFromLogin(j.user);
        setToken(j.token);
        showToast('Registered', `Welcome, ${userName(currentUser)}.`);
      } else {
        setAuthGateStatus(j.error || 'Registration failed.');
      }
    }catch(e){
      setAuthGateStatus('Could not reach that API base -- check the address and try again.');
    }
  }

  async function login(){
    const name = authName.value.trim();
    const password = authPass.value;
    if(!name||!password) return setAuthGateStatus('Enter a username and password.');
    try{
      const res = await fetch(apiBase() + '/api/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, password }) });
      const j = await res.json();
      if(res.ok){
        adoptIdentityFromLogin(j.user);
        setToken(j.token);
        showToast('Logged in', `Syncing as ${userName(currentUser)}.`);
      } else {
        setAuthGateStatus(j.error || 'Login failed.');
      }
    }catch(e){
      setAuthGateStatus('Could not reach that API base -- check the address and try again.');
    }
  }

  function setToken(t){
    authToken = t;
    if(t){
      localStorage.setItem('accountability:token', t);
      localStorage.setItem('accountability:api', apiBase());
      btnLogout.style.display='inline';
      setLoginStatus('Logged in');
      setAuthGateStatus('');
      if(authGate) authGate.classList.add('hidden');
      lockIdentityControls(true);
      runSync();
      if(syncIntervalId) clearInterval(syncIntervalId);
      syncIntervalId = setInterval(runSync, 20000);
    } else {
      localStorage.removeItem('accountability:token');
      btnLogout.style.display='none';
      setLoginStatus('Logged out');
      if(authGate) authGate.classList.remove('hidden');
      lockIdentityControls(false);
      if(syncIntervalId){ clearInterval(syncIntervalId); syncIntervalId = null; }
    }
  }

  ackAnna.addEventListener('click', ()=> processCouncilAcknowledgement('anna'));
  ackJordan.addEventListener('click', ()=> processCouncilAcknowledgement('jordan'));

  function openEditCommit(commit){
    editingCommitId = commit.id;
    commitText.value = commit.text;
    commitFor.value = commit.for;
    commitSchedule.value = commit.schedule || 'daily';
    if(commit.schedule === 'custom' && Array.isArray(commit.scheduleDays)){
      customDays.style.display = 'block';
      document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input => {
        input.checked = commit.scheduleDays.includes(input.value);
      });
    } else {
      customDays.style.display = commit.schedule === 'custom' ? 'block' : 'none';
      document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input => input.checked = false);
    }
    commitLabel.value = commit.label || '';
    commitTarget.value = commit.target || '';
    commitStartDate.value = commit.createdAt || '';
    commitReminderEnabled.checked = !!commit.reminderEnabled;
    commitReminderTime.value = commit.reminderTime || '';
    commitEnabled.checked = !!commit.enabled;
    const modalTitle = addModal.querySelector('h2');
    const submitBtn = addForm.querySelector('button[type="submit"]');
    if(modalTitle) modalTitle.textContent = 'Edit Commitment';
    if(submitBtn) submitBtn.textContent = 'Save Commitment';
    addModal.classList.remove('hidden');
  }

  btnRegister.addEventListener('click', register);
  btnLogin.addEventListener('click', login);
  btnLogout.addEventListener('click', ()=>{ setToken(null); setLoginStatus('Logged out'); alert('logged out'); });
  btnExportData.addEventListener('click', exportBackup);
  btnImportData.addEventListener('click', () => importFileInput.click());
  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if(file) importBackup(file);
    importFileInput.value = '';
  });

  // Non-destructive sync: merges the server's view into local state instead
  // of replacing it. Runs on login, every 20s while logged in, after local
  // pushes, and on demand via the Sync button -- so paws/comments/edits from
  // the other person's phone show up here without either side ever wiping
  // the other's data.
  async function fetchHistoryFor(remoteId){
    try{
      const res = await fetch(apiBase() + '/api/commitments/' + remoteId + '/history', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return [];
      const rows = await res.json();
      return rows.map(r => r.date);
    }catch(e){ return []; }
  }

  async function mergeRemoteCommitment(r){
    let scheduleDays = null;
    if(r.scheduleDays){
      scheduleDays = Array.isArray(r.scheduleDays) ? r.scheduleDays : (()=>{ try{ return JSON.parse(r.scheduleDays); }catch(e){ return null; } })();
    }
    const history = await fetchHistoryFor(r.id);
    let local = state.commitments.find(c => c.remoteId === r.id);
    if(!local){
      local = { id: 'r'+r.id, remoteId: r.id, pawLog: [], comments: [] };
      state.commitments.push(local);
    }
    local.text = r.text;
    local.for = r.for;
    local.enabled = r.enabled;
    local.schedule = r.schedule;
    local.scheduleDays = scheduleDays;
    local.reminderEnabled = r.reminderEnabled;
    local.reminderTime = r.reminderTime;
    local.weeklyTarget = r.weeklyTarget;
    local.label = r.label;
    local.target = r.target;
    local.history = history;
    local.createdAt = r.createdAt || local.createdAt || appToday();
    local.pawCount = r.pawCount;
    local.lastPaw = r.lastPaw;
    local.lastComment = r.lastComment;
  }

  async function pushUnsyncedLocalCommitments(){
    const unsynced = state.commitments.filter(c => c.for === currentUser && !c.remoteId);
    for(const c of unsynced) await pushCommitmentToServer(c);
  }

  async function runSync(){
    if(!authToken) return;
    try{
      await pushUnsyncedLocalCommitments();
      const res = await fetch(apiBase() + '/api/commitments', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      const list = await res.json();
      for(const r of list) await mergeRemoteCommitment(r);
      // Drop local copies of commitments that were synced before but no
      // longer exist on the server (deleted by their owner elsewhere).
      const remoteIds = new Set(list.map(r => r.id));
      state.commitments = state.commitments.filter(c => !c.remoteId || remoteIds.has(c.remoteId));
      save(state);
      renderList();
    }catch(e){ console.error('sync failed', e); }
  }

  btnSync.addEventListener('click', async ()=>{
    if(!authToken) return alert('login first');
    await runSync();
    showToast('Synced', 'Up to date with the server.');
  });

  settingsBtn.addEventListener('click', ()=> settingsPanel.classList.remove('hidden'));
  settingsClose.addEventListener('click', ()=> settingsPanel.classList.add('hidden'));
  settingsPanel.addEventListener('click', e => { if(e.target === settingsPanel) settingsPanel.classList.add('hidden'); });

  if(activeUserSelect){
    activeUserSelect.addEventListener('change', ()=>{
      currentUser = activeUserSelect.value;
      commitFor.value = currentUser;
      renderList();
    });
  }

  function updateDebugToolsDisplay(){
    ensureLifeState();
    if(debugCurrentDate){
      const offset = state.debugDayOffset || 0;
      debugCurrentDate.textContent = appToday() + (offset ? ` (real date +${offset}d)` : ' (real date)');
    }
    if(debugLivesAnna) debugLivesAnna.value = state.lives.anna;
    if(debugLivesJordan) debugLivesJordan.value = state.lives.jordan;
  }

  function toggleDebugPanel(show){
    if(!debugPanel) return;
    const visible = show === undefined ? debugPanel.classList.contains('hidden') : show;
    debugPanel.classList.toggle('hidden', !visible);
    if(visible){
      debugState.textContent = JSON.stringify(state, null, 2);
      updateDebugToolsDisplay();
    }
  }

  document.addEventListener('keydown', e => {
    if(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd'){
      e.preventDefault();
      toggleDebugPanel();
    }
  });

  if(btnShowState){
    btnShowState.addEventListener('click', ()=>{
      toggleDebugPanel(true);
    });
  }

  if(btnDebugJump){
    btnDebugJump.addEventListener('click', ()=>{
      const n = parseInt(debugJumpDays.value, 10);
      if(!n || n < 1) return alert('Enter a positive number of days to jump forward.');
      state.debugDayOffset = (state.debugDayOffset || 0) + n;
      save(state);
      renderList();
      toggleDebugPanel(true);
    });
  }

  if(btnDebugResetDate){
    btnDebugResetDate.addEventListener('click', ()=>{
      state.debugDayOffset = 0;
      save(state);
      renderList();
      toggleDebugPanel(true);
    });
  }

  if(btnDebugRunCheck){
    btnDebugRunCheck.addEventListener('click', ()=>{
      updateLivesForUser('anna');
      updateLivesForUser('jordan');
      renderList();
      toggleDebugPanel(true);
    });
  }

  if(btnDebugSetLives){
    btnDebugSetLives.addEventListener('click', ()=>{
      ensureLifeState();
      const a = parseInt(debugLivesAnna.value, 10);
      const j = parseInt(debugLivesJordan.value, 10);
      if(!Number.isNaN(a)) state.lives.anna = Math.min(MAX_LIVES, Math.max(0, a));
      if(!Number.isNaN(j)) state.lives.jordan = Math.min(MAX_LIVES, Math.max(0, j));
      save(state);
      renderLives();
      toggleDebugPanel(true);
    });
  }

  const btnCloseDebug = document.getElementById('btnCloseDebug');
  if(btnCloseDebug){
    btnCloseDebug.addEventListener('click', ()=> toggleDebugPanel(false));
  }

  function clearAddForm(){
    editingCommitId = null;
    commitText.value = '';
    if(commitFor) commitFor.value = currentUser;
    if(activeUserSelect) activeUserSelect.value = currentUser;
    commitSchedule.value = 'daily';
    customDays.style.display = 'none';
    document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input=>input.checked=false);
    commitLabel.value = '';
    commitTarget.value = '';
    commitStartDate.value = '';
    commitStartDate.min = appToday();
    commitReminderEnabled.checked = false;
    commitReminderTime.value = '';
    commitEnabled.checked = true;
    const modalTitle = addModal.querySelector('h2');
    const submitBtn = addForm.querySelector('button[type="submit"]');
    if(modalTitle) modalTitle.textContent = 'Add Commitment';
    if(submitBtn) submitBtn.textContent = 'Add Commitment';
  }

  addButton.addEventListener('click', ()=>{ clearAddForm(); addModal.classList.remove('hidden'); });
  addClose.addEventListener('click', ()=>{ addModal.classList.add('hidden'); clearAddForm(); });
  addModal.addEventListener('click', e => { if(e.target === addModal){ addModal.classList.add('hidden'); clearAddForm(); } });

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
    const today = getEffectiveNow();
    for(let i = n-1;i>=0;i--){
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      out.push(localDateKey(d));
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
    const startDate = commitStartDate && commitStartDate.value ? commitStartDate.value : null;
    const reminderEnabled = commitReminderEnabled ? !!commitReminderEnabled.checked : false;
    const reminderTime = commitReminderTime ? (commitReminderTime.value || null) : null;
    const weeklyTarget = schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null));

    let commitItem;
    if(editingCommitId){
      commitItem = state.commitments.find(c=>c.id===editingCommitId);
      if(commitItem){
        commitItem.text = text;
        commitItem.for = forUser;
        commitItem.enabled = enabled;
        commitItem.schedule = schedule;
        commitItem.scheduleDays = scheduleDays;
        commitItem.label = label;
        commitItem.target = target;
        commitItem.createdAt = startDate || commitItem.createdAt;
        commitItem.reminderEnabled = reminderEnabled;
        commitItem.reminderTime = reminderTime;
        commitItem.weeklyTarget = weeklyTarget;
        updateCommitStatusFromHistory(commitItem);
        scheduleReminderFor(commitItem);
      }
    } else {
      commitItem = { id: uid(), text, for: forUser, enabled, doneToday:false, schedule, scheduleDays, streak:0, lastDone:null, remoteId:null, history: [], label, target, reminderEnabled, reminderTime, paws:0, comments: [], weeklyTarget, createdAt: startDate || appToday() };
      state.commitments.push(commitItem);
      scheduleReminderFor(commitItem);
    }

    save(state);
    editingCommitId = null;
    commitText.value='';
    if(commitLabel) commitLabel.value='';
    if(commitTarget) commitTarget.value='';
    if(commitStartDate) commitStartDate.value='';
    if(commitReminderEnabled) commitReminderEnabled.checked = false;
    if(commitReminderTime) commitReminderTime.value = '';
    document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input=>input.checked=false);
    addModal.classList.add('hidden');
    renderList();
    if(commitItem && commitItem.for === currentUser) pushCommitmentToServer(commitItem);
  });

  // Initial render
  renderUsers();
  renderList();
  // schedule reminders for current user
  scheduleAllReminders();

  // Register the service worker unconditionally so the app shell is cached
  // and works offline once loaded -- previously this only happened as a side
  // effect of enabling notifications, so most sessions never got it at all.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(e => console.error('service worker registration failed', e));
  }

  // Expose for debugging
  window._accountability = { state, save };
})();
