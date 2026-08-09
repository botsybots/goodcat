import { localDateKey, parseLocalDate, nextLocalDate, prevLocalDate, getDayKey, weekStartDate } from './date-utils.js';
import { isScheduledDay, isWeeklyTargetSchedule, isDeadlineSchedule, isTrackerSchedule, isTrackerCompliantOnDay, getScheduleDescription, countCompletionsThisWeek, computeStreak, computeWeeklyStreak, trackerMilestoneWeeks, trackerMilestoneLabel, LABEL_CATEGORIES } from './schedule-utils.js';
import { pickCatImage } from './cat-images.js';
import { isSoundEnabled, setSoundEnabled, playSound } from './sound.js';

// Simple Accountability App (localStorage-backed)
(function(){
  const DEFAULT_USERS = [
    { id: 'anna', name: 'Anna' },
    { id: 'jordan', name: 'Jordan' }
  ];

  const STORAGE_KEY = 'accountability:data:v1';
  const DEFAULT_API_BASE = 'https://goodcat-api.onrender.com';
  const LABEL_ICONS = { Health: '🩺', Fitness: '💪', Education: '📚', Home: '🏠', Money: '💰', Social: '🎉', Relationship: '💞' };

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

  // "Cleanliness" was renamed to "Home" -- keep old local data matching the
  // current label set instead of leaving it stranded as an unrecognized value.
  (function migrateCleanlinessLabel(){
    let changed = false;
    for(const c of state.commitments || []){
      if(c.label === 'Cleanliness'){ c.label = 'Home'; changed = true; }
    }
    if(changed) save(state);
  })();

  // DOM refs
  const commitFor = document.getElementById('commitFor');
  const userSwitch = document.getElementById('userSwitch');
  const addForm = document.getElementById('addForm');
  const commitText = document.getElementById('commitText');
  const commitEnabled = document.getElementById('commitEnabled');
  const commitSchedule = document.getElementById('commitSchedule');
  const commitListAnna = document.getElementById('commitList-anna');
  const commitListJordan = document.getElementById('commitList-jordan');
  const jointSection = document.getElementById('jointSection');
  const commitListJoint = document.getElementById('commitList-joint');
  const commitLabel = document.getElementById('commitLabel');
  const commitTarget = document.getElementById('commitTarget');
  const commitJoint = document.getElementById('commitJoint');
  const commitStartDate = document.getElementById('commitStartDate');
  const commitReminderEnabled = document.getElementById('commitReminderEnabled');
  const commitReminderTime = document.getElementById('commitReminderTime');
  const customDays = document.getElementById('customDays');
  const commitDeadlineRow = document.getElementById('commitDeadlineRow');
  const commitDeadlineDate = document.getElementById('commitDeadlineDate');
  const authName = document.getElementById('authName');
  const authPass = document.getElementById('authPass');
  const btnRegister = document.getElementById('btnRegister');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const btnSync = document.getElementById('btnSync');
  const resetPasswordUser = document.getElementById('resetPasswordUser');
  const resetPasswordNew = document.getElementById('resetPasswordNew');
  const btnResetPassword = document.getElementById('btnResetPassword');
  const btnEnableNotify = document.getElementById('btnEnableNotify');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const importFileInput = document.getElementById('importFileInput');
  const notifyStatus = document.getElementById('notifyStatus');
  const boopEnabledToggle = document.getElementById('boopEnabledToggle');
  const boopHourRow = document.getElementById('boopHourRow');
  const boopHourInput = document.getElementById('boopHourInput');
  const soundEnabledToggle = document.getElementById('soundEnabledToggle');
  const btnDebugTriggerBoop = document.getElementById('btnDebugTriggerBoop');
  const boopOverlay = document.getElementById('boopOverlay');
  const boopCat = document.getElementById('boopCat');
  const boopText = document.getElementById('boopText');
  const livesAnna = document.getElementById('lives-anna');
  const livesJordan = document.getElementById('lives-jordan');
  const councilAnna = document.getElementById('council-anna');
  const councilJordan = document.getElementById('council-jordan');
  const councilCatAnna = document.getElementById('council-cat-anna');
  const councilCatJordan = document.getElementById('council-cat-jordan');
  const ackAnna = document.getElementById('ack-anna');
  const ackJordan = document.getElementById('ack-jordan');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsClose = document.getElementById('settingsClose');
  const debugPanel = document.getElementById('debugPanel');
  const btnShowState = document.getElementById('btnShowState');
  const dangerZoneSection = document.getElementById('dangerZoneSection');
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
  const detailModal = document.getElementById('detailModal');
  const detailClose = document.getElementById('detailClose');
  const detailBody = document.getElementById('detailBody');
  const wizardModal = document.getElementById('wizardModal');
  const wizClose = document.getElementById('wizClose');
  const wizProgress = document.getElementById('wizProgress');
  const wizStep1 = document.getElementById('wizStep1');
  const wizStep2 = document.getElementById('wizStep2');
  const wizStep3 = document.getElementById('wizStep3');
  const wizStep4 = document.getElementById('wizStep4');
  const wizLabelGrid = document.getElementById('wizLabelGrid');
  const wizText = document.getElementById('wizText');
  const wizSchedule = document.getElementById('wizSchedule');
  const wizCustomDays = document.getElementById('wizCustomDays');
  const wizDeadlineRow = document.getElementById('wizDeadlineRow');
  const wizDeadlineDate = document.getElementById('wizDeadlineDate');
  const wizTrackerHint = document.getElementById('wizTrackerHint');
  const wizJoint = document.getElementById('wizJoint');
  const wizStartDate = document.getElementById('wizStartDate');
  const wizSummary = document.getElementById('wizSummary');
  const wizBack = document.getElementById('wizBack');
  const wizNext = document.getElementById('wizNext');
  const loginStatus = document.getElementById('loginStatus');
  const authGate = document.getElementById('authGate');
  const authGateStatus = document.getElementById('authGateStatus');
  const levelAnna = document.getElementById('level-anna');
  const levelJordan = document.getElementById('level-jordan');
  const suggestionsSection = document.getElementById('suggestionsSection');
  const suggestionsList = document.getElementById('suggestionsList');
  const btnSuggest = document.getElementById('btnSuggest');
  const pauseRequestsSection = document.getElementById('pauseRequestsSection');
  const pauseRequestsList = document.getElementById('pauseRequestsList');
  const suggestModal = document.getElementById('suggestModal');
  const suggestClose = document.getElementById('suggestClose');
  const suggestForm = document.getElementById('suggestForm');
  const suggestText = document.getElementById('suggestText');
  const suggestSchedule = document.getElementById('suggestSchedule');
  const suggestCustomDays = document.getElementById('suggestCustomDays');
  const suggestLabel = document.getElementById('suggestLabel');
  const suggestSubmitBtn = document.getElementById('suggestSubmitBtn');
  const suggestModalTitle = document.getElementById('suggestModalTitle');
  const suggestModalHint = document.getElementById('suggestModalHint');
  const btnLeaderboard = document.getElementById('btnLeaderboard');
  const btnResetProgress = document.getElementById('btnResetProgress');
  const btnStartFresh = document.getElementById('btnStartFresh');
  const leaderboardModal = document.getElementById('leaderboardModal');
  const leaderboardClose = document.getElementById('leaderboardClose');
  const leaderboardBody = document.getElementById('leaderboardBody');
  const celebrationOverlay = document.getElementById('celebrationOverlay');
  const celebrationText = document.getElementById('celebrationText');
  const celebrationCat = document.getElementById('celebrationCat');
  const appTitle = document.getElementById('appTitle');
  const tabCommitments = document.getElementById('tabCommitments');
  const tabTodos = document.getElementById('tabTodos');
  const tabShopping = document.getElementById('tabShopping');
  const commitmentsView = document.getElementById('commitmentsView');
  const todosView = document.getElementById('todosView');
  const shoppingView = document.getElementById('shoppingView');
  const wellbeingSection = document.getElementById('wellbeingSection');
  const wellbeingIcon = document.getElementById('wellbeingIcon');
  const wellbeingCat = document.getElementById('wellbeingCat');
  const wellbeingQuestion = document.getElementById('wellbeingQuestion');
  const todoAddForm = document.getElementById('todoAddForm');
  const todoInput = document.getElementById('todoInput');
  const todoList = document.getElementById('todoList');
  const todosLoggedOutHint = document.getElementById('todosLoggedOutHint');
  const shoppingAddForm = document.getElementById('shoppingAddForm');
  const shoppingInput = document.getElementById('shoppingInput');
  const shoppingList = document.getElementById('shoppingList');
  const shoppingLoggedOutHint = document.getElementById('shoppingLoggedOutHint');
  const btnClearCheckedShopping = document.getElementById('btnClearCheckedShopping');
  const START_LIVES = 9;
  const MAX_LIVES = 9;
  const RESET_LIVES_AFTER_COUNCIL = 3;

  // XP/leveling -- "some other members of the species" filled in between
  // Big Botson and Tiger per Anna's list, ending at Lion as the top tier.
  const LEVELS = [
    { name: 'Baby Cat', xp: 0 },
    { name: 'Kitten', xp: 50 },
    { name: 'Little One', xp: 150 },
    { name: 'Adult Cat', xp: 300 },
    { name: 'Big Botson', xp: 500 },
    { name: 'Bobcat', xp: 750 },
    { name: 'Panther', xp: 1050 },
    { name: 'Cougar', xp: 1400 },
    { name: 'Tiger', xp: 1800 },
    { name: 'Lion', xp: 2300 }
  ];
  function levelForXp(xp){
    let current = LEVELS[0];
    for(const l of LEVELS){ if(xp >= l.xp) current = l; }
    return current;
  }

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
  if(authToken){
    const payload = decodeJwtPayload(authToken);
    if(payload) adoptIdentityFromLogin(payload);
    setToken(authToken);
  } else {
    setLoginStatus('Logged out');
    if(authGate) authGate.classList.remove('hidden');
  }

  // Notification controls. The button itself used to never change
  // appearance and its status text only ever refreshed once, at page load
  // -- so re-opening Settings later always showed the original "Enable
  // Notifications" label even once permission had actually been granted,
  // looking exactly like it hadn't stuck. It also silently swallowed any
  // failure in the push-subscribe step, so a real failure there (e.g. the
  // server's push keys having changed) looked identical to success.
  let notifyTimers = new Map();
  function updateNotifyStatus(){
    const supported = typeof Notification !== 'undefined';
    const permission = supported ? Notification.permission : 'unsupported';
    notifyStatus.textContent = supported ? 'Permission: ' + permission : 'Not supported in this browser';
    if(!supported) return;
    btnEnableNotify.textContent = permission === 'granted' ? '🔔 Notifications On' : '🔔 Enable Notifications';
  }
  updateNotifyStatus();
  settingsBtn.addEventListener('click', updateNotifyStatus);
  btnEnableNotify.addEventListener('click', async ()=>{
    if(typeof Notification === 'undefined') return alert('Notifications not supported in this browser.');
    const p = await Notification.requestPermission(); updateNotifyStatus();
    if(p==='granted'){
      // register service worker and subscribe for push. Also re-run when
      // already granted -- clicking again re-subscribes, which is the way
      // to recover if the subscription itself ever goes stale/fails.
      try{
        const reg = await navigator.serviceWorker.register('service-worker.js');
        const vap = await fetch(apiBase() + '/api/vapidPublicKey');
        const j = await vap.json();
        const key = j.publicKey;
        const applicationServerKey = urlBase64ToUint8Array(key);
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
        const subRes = await fetch(apiBase() + '/api/subscribe', { method: 'POST', headers: { 'content-type':'application/json', 'authorization':'Bearer '+authToken }, body: JSON.stringify(sub) });
        if(!subRes.ok) throw new Error('subscribe request failed');
        showToast('Notifications on', "You'll get reminders and updates from Good Cat.");
      }catch(e){
        console.error('push subscribe failed', e);
        showToast('Almost there', 'Permission was granted, but saving the subscription failed. Try again in a bit.');
      }
      scheduleAllReminders();
    } else if(p === 'denied'){
      showToast('Blocked', "Notifications are blocked for this app in your phone/browser settings -- you'll need to allow them there.");
    }
  });

  // Boop's enabled/hour setting is stored server-side, per person -- the
  // server-side scheduler (checkBoop in index.js) needs to know it even when
  // this particular device isn't the one open. Sound is a pure per-device
  // preference (see sound.js), so it just reads/writes localStorage.
  async function loadBoopSettings(){
    if(soundEnabledToggle) soundEnabledToggle.checked = isSoundEnabled();
    if(!authToken || !boopEnabledToggle) return;
    try{
      const res = await fetch(apiBase() + '/api/boop-settings', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      const { enabled, hour } = await res.json();
      boopEnabledToggle.checked = enabled;
      if(boopHourRow) boopHourRow.style.display = enabled ? '' : 'none';
      if(boopHourInput) boopHourInput.value = String(hour).padStart(2, '0') + ':00';
    }catch(e){ /* settings just won't refresh this time -- not worth surfacing */ }
  }
  settingsBtn.addEventListener('click', loadBoopSettings);

  async function saveBoopSettings(){
    if(!authToken) return;
    const enabled = !!(boopEnabledToggle && boopEnabledToggle.checked);
    if(boopHourRow) boopHourRow.style.display = enabled ? '' : 'none';
    const hourParsed = boopHourInput ? parseInt(boopHourInput.value.split(':')[0], 10) : 20;
    const hour = Number.isNaN(hourParsed) ? 20 : hourParsed;
    try{
      await fetch(apiBase() + '/api/boop-settings', { method: 'PUT', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ enabled, hour }) });
    }catch(e){ console.error('save boop settings failed', e); }
  }
  if(boopEnabledToggle) boopEnabledToggle.addEventListener('change', saveBoopSettings);
  if(boopHourInput) boopHourInput.addEventListener('change', saveBoopSettings);
  if(soundEnabledToggle) soundEnabledToggle.addEventListener('change', ()=> setSoundEnabled(soundEnabledToggle.checked));

  // Sends a real push through the real server pathway right now, bypassing
  // the once-a-day cap/quiet-hours/completion checks that gate the
  // automatic scheduler -- so this is how Boop can actually be seen working
  // (both halves: in-app animation if this tab is focused, plain OS
  // notification otherwise) without waiting for the real trigger conditions.
  if(btnDebugTriggerBoop){
    btnDebugTriggerBoop.addEventListener('click', async ()=>{
      if(!authToken) return alert('login first');
      try{
        const res = await fetch(apiBase() + '/api/boop/trigger', { method: 'POST', headers: { authorization: 'Bearer '+authToken } });
        const data = await res.json().catch(()=>({}));
        if(!res.ok){ alert(data.error || 'Boop failed.'); return; }
        showToast('Boop sent', 'Watch for the in-app animation (if this tab stays focused) or a notification.');
      }catch(e){ alert('Boop request failed.'); }
    });
  }

  // show/hide custom days / deadline date when schedule selector changes
  commitSchedule.addEventListener('change', ()=>{
    customDays.style.display = commitSchedule.value === 'custom' ? 'block' : 'none';
    if(commitDeadlineRow) commitDeadlineRow.style.display = commitSchedule.value === 'deadline' ? 'block' : 'none';
  });

  // Top-level tab switch between the commitments dashboard and the shared
  // to-do list -- not persisted across reloads, since it's a quick glance
  // switch rather than a durable preference.
  function switchTab(tab){
    const tabs = { commitments: { btn: tabCommitments, view: commitmentsView }, todos: { btn: tabTodos, view: todosView }, shopping: { btn: tabShopping, view: shoppingView } };
    Object.entries(tabs).forEach(([name, { btn, view }]) => {
      const active = name === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      view.classList.toggle('hidden', !active);
    });
    if(tab === 'todos') fetchTodos();
    if(tab === 'shopping') fetchShoppingItems();
  }
  // Tapping the "Good Cat" title acts as a home button -- closes whatever
  // modal/panel is open and lands back on the main Commitments tab, scrolled
  // to the top. Jordan asked for this since there was previously no way to
  // get back to the main view short of a full reload.
  function goHome(){
    document.querySelectorAll('.panel-modal:not(.hidden)').forEach(el => el.classList.add('hidden'));
    if(debugPanel) debugPanel.classList.add('hidden');
    switchTab('commitments');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if(appTitle){
    appTitle.addEventListener('click', goHome);
    appTitle.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goHome(); } });
  }

  tabCommitments.addEventListener('click', ()=> switchTab('commitments'));
  tabTodos.addEventListener('click', ()=> switchTab('todos'));
  tabShopping.addEventListener('click', ()=> switchTab('shopping'));

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
  }

  // catImage is resolved ONCE by the caller (via pickCatImage) at the moment
  // the triggering event happens, not re-picked here -- a toast is a single
  // one-shot DOM element anyway, but keeping the pick call at the call site
  // is what keeps this consistent with showCelebration() and the council
  // banner below, which DO need to guard against re-picking on every render.
  function showToast(title, body, catImage){
    const t = document.createElement('div'); t.className='toast';
    const imgHtml = catImage ? `<img class="toast-cat" src="${escapeHtml(catImage.src)}" alt="${escapeHtml(catImage.name)}" />` : '';
    t.innerHTML = `${imgHtml}<div class="toast-body"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(body)}</p></div>`;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),400); },4500);
  }

  function showSystemNotification(title, body){
    if(typeof Notification === 'undefined') return showToast(title, body);
    if(Notification.permission === 'granted'){
      try{ new Notification(title, { body }); }catch(e){ showToast(title, body); }
    } else showToast(title, body);
  }

  // Big celebratory moment for completing a habit -- separate from the
  // small corner toast, which is still used for lower-stakes stuff (life
  // gains/losses, sync errors, etc).
  const FIREWORK_COLORS = ['#b5541f', '#4b5d40', '#e0a458', '#8a3f16', '#dbe3d0', '#c9682c'];
  function launchFireworks(){
    for(let burst = 0; burst < 3; burst += 1){
      setTimeout(()=>{
        const cx = 20 + Math.random() * 60;
        const cy = 20 + Math.random() * 40;
        const count = 16;
        for(let i = 0; i < count; i += 1){
          const angle = (Math.PI * 2 * i) / count;
          const dist = 60 + Math.random() * 70;
          const p = document.createElement('span');
          p.className = 'firework-particle';
          p.style.left = cx + 'vw';
          p.style.top = cy + 'vh';
          p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
          p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
          p.style.background = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
          document.body.appendChild(p);
          setTimeout(()=>p.remove(), 950);
        }
      }, burst * 260);
    }
  }

  let celebrationTimer = null;
  function hideCelebration(){
    celebrationOverlay.classList.add('hidden');
    if(celebrationTimer){ clearTimeout(celebrationTimer); celebrationTimer = null; }
  }
  function showCelebration(message, { fireworks = true, catImage } = {}){
    celebrationText.textContent = message;
    if(catImage){
      celebrationCat.src = catImage.src;
      celebrationCat.alt = catImage.name;
      celebrationCat.classList.remove('hidden');
    } else {
      celebrationCat.classList.add('hidden');
    }
    celebrationOverlay.classList.remove('hidden');
    if(fireworks) launchFireworks();
    if(celebrationTimer) clearTimeout(celebrationTimer);
    celebrationTimer = setTimeout(hideCelebration, 2600);
  }
  celebrationOverlay.addEventListener('click', hideCelebration);

  // Boop's in-app half: a small non-blocking card (not a full-screen
  // overlay like celebration -- everything underneath stays tappable),
  // dismissed by tapping anywhere. Reached two ways: the debug "Trigger a
  // boop now" button (which goes through a real server push) and a real
  // push whose service-worker handler decides the app is currently focused
  // and postMessages here instead of showing an OS notification.
  let boopDismissTimer = null;
  function dismissBoop(){
    if(!boopOverlay) return;
    boopOverlay.classList.add('hidden');
    document.removeEventListener('click', dismissBoopOnTap);
    if(boopDismissTimer){ clearTimeout(boopDismissTimer); boopDismissTimer = null; }
  }
  function dismissBoopOnTap(){ dismissBoop(); }
  function showBoopAnimation(text){
    if(!boopOverlay) return;
    playSound('meow');
    if(boopText) boopText.textContent = text || 'Boop.';
    boopOverlay.classList.remove('hidden');
    // Re-trigger the CSS pop-in animation even if it's already showing.
    if(boopCat){ boopCat.style.animation = 'none'; void boopCat.offsetWidth; boopCat.style.animation = ''; }
    // Deferred so the click that triggered this (e.g. the debug button)
    // doesn't immediately dismiss it via bubbling.
    document.removeEventListener('click', dismissBoopOnTap);
    setTimeout(()=> document.addEventListener('click', dismissBoopOnTap), 0);
    if(boopDismissTimer) clearTimeout(boopDismissTimer);
    boopDismissTimer = setTimeout(dismissBoop, 8000);
  }
  if(boopOverlay) boopOverlay.addEventListener('click', dismissBoop);

  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('message', event => {
      if(event.data && event.data.type === 'boop') showBoopAnimation(event.data.body);
    });
  }

  const FIRST_TIME_MESSAGES = [
    task => `Nice start on "${task}"! Day one in the books. 🐾`,
    task => `"${task}" — logged! Every streak starts somewhere.`,
    task => `First one down for "${task}". Keep going!`
  ];
  const STREAK_MESSAGES = [
    (task, n) => `🔥 ${n}-day streak with "${task}" — keep it up!`,
    (task, n) => `You're on a roll! ${n} days strong on "${task}".`,
    (task, n) => `Loki approves: ${n} in a row for "${task}"! 🐾`,
    (task, n) => `${n} days and counting on "${task}" — nice work.`,
    (task, n) => `That's ${n} straight for "${task}". Don't stop now!`,
    (task, n) => `${n}-day streak unlocked for "${task}". Good cat. 😼`
  ];
  const WEEKLY_PROGRESS_MESSAGES = [
    (task, count, target) => `${count}/${target} this week for "${task}" — nice pace!`,
    (task, count, target) => `You're at ${count} of ${target} for "${task}" this week. Keep going!`,
    (task, count, target) => `${count}/${target} logged for "${task}" this week. 🐾`
  ];
  function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

  function celebrateCompletion(c){
    playSound('chirrup');
    const catImage = pickCatImage('pleased');
    if(isWeeklyTargetSchedule(c)){
      const count = countCompletionsThisWeek(c, getEffectiveNow());
      showCelebration(pick(WEEKLY_PROGRESS_MESSAGES)(c.text, count, c.weeklyTarget), { catImage });
    } else if(c.streak > 1){
      showCelebration(pick(STREAK_MESSAGES)(c.text, c.streak), { catImage });
    } else {
      showCelebration(pick(FIRST_TIME_MESSAGES)(c.text), { catImage });
    }
  }

  // A rare, unpredictable bonus -- not tied to any particular streak or
  // performance, just an occasional surprise for showing up.
  const RARE_EVENT_CHANCE = 0.05;
  const RARE_EVENT_MESSAGES = [
    '✨ Loki purrs approvingly and grants you a bonus life!',
    '🌟 A rare golden paw print appears underfoot — +1 life!',
    '🐾 The Good Cat spirit smiles on you today. Bonus life earned!',
    '🎁 An unexpected treat from Bots — +1 life!'
  ];
  function maybeTriggerRareEvent(userId){
    if(Math.random() >= RARE_EVENT_CHANCE) return;
    // A joint commitment rolls once, not once per person -- if it hits,
    // it's a bonus life for both of you, not a second independent chance.
    const isJoint = userId === 'both';
    if(isRemoteMode()){
      fetch(apiBase() + '/api/lives/bonus', {
        method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken },
        body: JSON.stringify({ joint: isJoint })
      }).then(async res => {
        if(!res.ok) return;
        const j = await res.json();
        if(!j.granted) return; // everyone involved was already at MAX_LIVES
        setTimeout(()=> showCelebration(pick(RARE_EVENT_MESSAGES), { catImage: pickCatImage('playful') }), 2800);
      }).catch(()=>{});
      return;
    }
    ensureLifeState();
    const targets = isJoint ? ['anna','jordan'] : [userId];
    let grantedAny = false;
    targets.forEach(t=>{
      if(state.lives[t] < MAX_LIVES){
        state.lives[t] = Math.min(MAX_LIVES, state.lives[t] + 1);
        grantedAny = true;
      }
    });
    if(!grantedAny) return;
    save(state);
    setTimeout(()=> showCelebration(pick(RARE_EVENT_MESSAGES), { catImage: pickCatImage('playful') }), 2800);
  }

  function userName(id){
    if(id === 'both') return 'Both of you';
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
    return !isRemoteMode() || c.for === currentUser || c.for === 'both';
  }

  function lockIdentityControls(locked){
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
    if(isDeadlineSchedule(commit) || isTrackerSchedule(commit)) return 0;
    if(isWeeklyTargetSchedule(commit)) return computeWeeklyStreak(commit, commit.history, appToday());
    return computeStreak(commit, commit.history, appToday());
  }

  function updateCommitStatusFromHistory(commit){
    if(!commit) return;
    commit.history = commit.history || [];
    commit.streak = rebuildStreak(commit);
    // A one-off commitment is either completed or not -- there's no "today"
    // to key off, since it may have been finished days before its deadline
    // and should still read as done on every later render, not just the day
    // it happened.
    commit.doneToday = isDeadlineSchedule(commit) ? commit.history.length > 0 : commit.history.includes(appToday());
    if(commit.target && commit.streak >= commit.target){
      commit.achieved = true;
      commit.achievedAt = commit.achievedAt || appToday();
    } else if(commit.target && commit.streak < commit.target){
      commit.achieved = false;
    }
  }

  // In remote mode, state.lives/lifeCouncilAck are just a cache of the
  // server's answer (see fetchUsersStatus()) -- the lifeLastEvaluatedDate/
  // lifeGains/lifeLosses/weeklyLifeLosses dictionaries below are local-mode-
  // only bookkeeping now (server/lives.js has its own equivalents). This
  // still runs unconditionally either way, so an early render (before the
  // first sync lands) always has something sane to display.
  // lastShownLifeEventAt is remote-mode-only: a pure local dedup marker
  // (not a source of truth) so this device only toasts about a server-side
  // life event once, however many times it shows up in a sync.
  function ensureLifeState(){
    if(!state.lives) state.lives = { anna: START_LIVES, jordan: START_LIVES };
    state.lives.anna = Math.min(MAX_LIVES, Math.max(0, state.lives.anna));
    state.lives.jordan = Math.min(MAX_LIVES, Math.max(0, state.lives.jordan));
    if(!state.lifeLastEvaluatedDate) state.lifeLastEvaluatedDate = { anna: null, jordan: null };
    if(!state.lifeGains) state.lifeGains = { anna: {}, jordan: {} };
    if(!state.lifeLosses) state.lifeLosses = { anna: {}, jordan: {} };
    if(!state.weeklyLifeLosses) state.weeklyLifeLosses = { anna: {}, jordan: {} };
    if(!state.lifeCouncilAck) state.lifeCouncilAck = { anna: false, jordan: false };
    if(!state.lastShownLifeEventAt) state.lastShownLifeEventAt = { anna: null, jordan: null };
    if(!state.lifeEventBaselineSet) state.lifeEventBaselineSet = { anna: false, jordan: false };
  }

  // Day-based commitments only (daily/weekdays/custom) — "N times a week"
  // commitments aren't due on any particular calendar day, so they're
  // evaluated separately, once per week, in getUserWeeklyComplianceForWeek().
  function getUserScheduledCountsForDate(userId, date){
    const commits = state.commitments.filter(c => (c.for === userId || c.for === 'both') && c.enabled && !isWeeklyTargetSchedule(c));
    const isoDate = localDateKey(date);
    let scheduled = 0;
    let done = 0;
    for(const commit of commits){
      const created = getCommitCreatedDate(commit);
      if(created > isoDate) continue;
      if(isScheduledDay(commit, isoDate)){
        scheduled += 1;
        // A one-off deadline commitment is only ever "due" on its single
        // deadline date, but may have been completed on an earlier day --
        // so "done" means completed at all, not completed on this exact date.
        // A tracker's history holds LOGGED (bad) days, so compliance is the
        // inverse of a normal habit's -- see isTrackerCompliantOnDay().
        const isDone = isDeadlineSchedule(commit)
          ? Array.isArray(commit.history) && commit.history.length > 0
          : isTrackerSchedule(commit)
            ? isTrackerCompliantOnDay(commit, commit.history, isoDate)
            : Array.isArray(commit.history) && commit.history.includes(isoDate);
        if(isDone) done += 1;
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
    const commits = state.commitments.filter(c => (c.for === userId || c.for === 'both') && c.enabled && isWeeklyTargetSchedule(c));
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

  // Backfilling a past date as done should actually undo the consequence,
  // not just the record -- otherwise there's no real reason to bother.
  // Checks whether the specific day (or the week it falls in, for a
  // weekly-target schedule) had already cost a life, and refunds it if the
  // day/week is now fully compliant as a result of the edit. Deliberately
  // one-directional: un-marking a day doesn't retroactively charge a life
  // (the day-walk in updateLivesForUser never revisits an already-evaluated
  // day either way, so this mirrors that existing write-once behavior
  // rather than introducing a new asymmetry).
  function reevaluatePastDayForOneUser(userId, dayIso){
    ensureLifeState();
    if(state.lifeLosses[userId] && state.lifeLosses[userId][dayIso]){
      const counts = getUserScheduledCountsForDate(userId, dayIso);
      if(counts.scheduled > 0 && counts.done >= counts.scheduled){
        delete state.lifeLosses[userId][dayIso];
        state.lives[userId] = Math.min(MAX_LIVES, state.lives[userId] + 1);
        if(userId === currentUser) showToast('Life refunded', `${userName(userId)} — that day's fully caught up now, so the life lost for it has been given back.`);
      }
    }
    const weekStart = weekStartDate(parseLocalDate(dayIso));
    const weekStartIso = localDateKey(weekStart);
    if(state.weeklyLifeLosses[userId] && state.weeklyLifeLosses[userId][weekStartIso]){
      const compliance = getUserWeeklyComplianceForWeek(userId, weekStart);
      if(compliance.total > 0 && compliance.compliant >= compliance.total){
        delete state.weeklyLifeLosses[userId][weekStartIso];
        state.lives[userId] = Math.min(MAX_LIVES, state.lives[userId] + 1);
        if(userId === currentUser) showToast('Life refunded', `${userName(userId)} — that week's fully caught up now, so the life lost for it has been given back.`);
      }
    }
  }

  function reevaluatePastDay(forValue, dayIso){
    if(forValue === 'both'){
      reevaluatePastDayForOneUser('anna', dayIso);
      reevaluatePastDayForOneUser('jordan', dayIso);
    } else {
      reevaluatePastDayForOneUser(forValue, dayIso);
    }
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

  // Local/offline-mode only now -- in remote mode, lives are evaluated
  // server-side (see server/lives.js) and this device just displays whatever
  // the last sync brought back (see fetchUsersStatus()), so this whole
  // day-walk is skipped there entirely.
  function updateLivesForUser(userId){
    if(isRemoteMode()) return;
    ensureLifeState();
    const today = appToday();
    const yesterday = prevLocalDate(today);
    let startDate = state.lifeLastEvaluatedDate[userId] ? nextLocalDate(state.lifeLastEvaluatedDate[userId]) : null;
    if(!startDate){
      const createdDates = state.commitments.filter(c=>c.for===userId || c.for==='both').map(getCommitCreatedDate).filter(Boolean);
      const historyDates = state.commitments.filter(c=>(c.for===userId || c.for==='both') && Array.isArray(c.history)).flatMap(c=>c.history);
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
          // This loop never evaluates "today" (see the `end = yesterday`
          // bound above) -- by the time a day gets judged here it has
          // already fully finished, so the toast says so explicitly rather
          // than reading like a real-time judgment of a day still in
          // progress. Also only ever shown on the device of the person it's
          // actually about -- this function runs for BOTH people on every
          // render (each device needs to display an approximation of the
          // other's lives too), but a toast about someone else's missed
          // habit popping up on your own phone was the actual bug reported.
          if(userId === currentUser && dayKey === yesterday){
            const cat = pickCatImage('judging');
            playSound('meow');
            showToast(`${cat ? cat.name : 'Bots'} is judging you`, `${userName(userId)} missed a scheduled habit yesterday — lost 1 life.`, cat);
          }
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
            if(userId === currentUser && dayKey === yesterday){
              const cat = pickCatImage('judging');
              playSound('meow');
              showToast(`${cat ? cat.name : 'Bots'} is judging you`, `${userName(userId)} missed a weekly target last week — lost 1 life.`, cat);
            }
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
            const before = state.lives[userId];
            state.lives[userId] = Math.min(MAX_LIVES, before + gain);
            // Lives cap at MAX_LIVES, so a "perfect week" gain can be
            // partly or entirely absorbed by the cap if you're already
            // near full -- report what actually changed, not the raw
            // tier, and stay quiet if nothing did (already at max).
            const actualGain = state.lives[userId] - before;
            if(userId === currentUser && actualGain > 0 && dayKey === yesterday){
              const cat = pickCatImage('pleased');
              showToast(`${cat ? cat.name : 'Loki'} is pleased with ` + userName(userId), `Kept up with scheduled habits this past week — gained ${actualGain} ${actualGain === 1 ? 'life' : 'lives'}!`, cat);
            }
          }
        }
      }
      state.lifeLastEvaluatedDate[userId] = dayKey;
      cursor.setDate(cursor.getDate() + 1);
    }
    save(state);
  }

  // In remote mode this is always about the CALLER's own council -- the
  // server enforces that too (POST /api/lives/council-ack always acks the
  // caller, there's no target-user param), so this rejects the "wrong"
  // button before even making the request. Local/offline mode has no such
  // concept (one shared device, either column is fair game) and behaves
  // exactly as it always did.
  async function processCouncilAcknowledgement(userId){
    if(isRemoteMode()){
      if(userId !== currentUser){
        showToast('Not yours to acknowledge', `Only ${userName(userId)} can acknowledge this council.`);
        return;
      }
      try{
        const res = await fetch(apiBase() + '/api/lives/council-ack', { method:'POST', headers:{ authorization:'Bearer '+authToken } });
        if(!res.ok){ showToast('Not this time', 'Could not acknowledge -- try again in a moment.'); return; }
        const j = await res.json();
        if(!j.bothAcked) showToast('Acknowledged', 'Waiting for the other person to acknowledge too.');
        // Don't show "Family council complete" here directly even if
        // bothAcked -- fetchUsersStatus()'s normal event-diffing shows it,
        // so whoever acked FIRST (and might be looking at a different
        // device right now) gets told too, not just whoever completes it.
        await fetchUsersStatus();
      }catch(e){
        showToast('Offline?', 'Could not reach the server.');
      }
      return;
    }
    ensureLifeState();
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

  // Picks a council cat image only on the moment the banner actually
  // switches from hidden to showing -- renderLives() runs on nearly every
  // render (any toggle, any sync), so re-picking unconditionally here would
  // change the face while someone's just scrolling, not on a new event.
  // In remote mode, only the person the council is actually about can
  // acknowledge it (see processCouncilAcknowledgement) -- disabling the
  // other person's button here avoids a confusing "I tapped it and nothing
  // happened."
  function updateCouncilBanner(bannerEl, catImgEl, ackBtn, userId, isActive){
    if(!bannerEl) return;
    const wasActive = !bannerEl.classList.contains('hidden');
    bannerEl.classList.toggle('hidden', !isActive);
    if(isActive && !wasActive){
      playSound('meow');
    }
    if(isActive && !wasActive && catImgEl){
      const cat = pickCatImage('judging');
      if(cat){
        catImgEl.src = cat.src;
        catImgEl.alt = cat.name;
        catImgEl.classList.remove('hidden');
      }
    }
    if(ackBtn){
      const canAck = !isRemoteMode() || userId === currentUser;
      ackBtn.disabled = !canAck;
      ackBtn.title = canAck ? '' : `Only ${userName(userId)} can acknowledge this.`;
    }
  }

  function renderLives(){
    ensureLifeState();
    if(livesAnna) livesAnna.textContent = `${state.lives.anna} / ${MAX_LIVES}`;
    if(livesJordan) livesJordan.textContent = `${state.lives.jordan} / ${MAX_LIVES}`;
    // A family council is a joint thing -- it's called whenever EITHER
    // person runs out of lives, not only once both have independently hit
    // zero (that would mean whoever wasn't at zero could never even be
    // asked to acknowledge, so the reset -- which needs both acks -- could
    // sit unresolved indefinitely). Both banners show together so both
    // people can acknowledge, even if only one of them is actually at 0.
    const councilActive = state.lives.anna <= 0 || state.lives.jordan <= 0;
    updateCouncilBanner(councilAnna, councilCatAnna, ackAnna, 'anna', councilActive);
    updateCouncilBanner(councilJordan, councilCatJordan, ackJordan, 'jordan', councilActive);
  }

  function renderLevels(){
    const xp = state.usersXp || {};
    function paint(el, userId){
      if(!el) return;
      if(xp[userId] === undefined){ el.textContent = ''; return; }
      const level = levelForXp(xp[userId]);
      el.textContent = `🐾 ${level.name} · ${xp[userId]} XP`;
    }
    paint(levelAnna, 'anna');
    paint(levelJordan, 'jordan');
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
    state.users.forEach(u => {
      const opt = document.createElement('option'); opt.value = u.id; opt.textContent = u.name;
      commitFor.appendChild(opt);
    });
    if(!state.users.find(u => u.id === currentUser)) currentUser = state.users[0]?.id || 'anna';
    commitFor.value = currentUser;
    if(userSwitch) userSwitch.textContent = userName(currentUser);
    // Debug Tools and the Danger Zone (Start Fresh) both stay Anna-only --
    // Jordan doesn't need either day to day, and they're exactly the kind
    // of controls that caused real confusion when used without realizing
    // what they actually do.
    if(btnShowState) btnShowState.style.display = currentUser === 'anna' ? '' : 'none';
    if(dangerZoneSection) dangerZoneSection.style.display = currentUser === 'anna' ? '' : 'none';
    // Defaults to the OTHER person, not whoever's currently logged in --
    // recovering the other person's forgotten password is the whole point
    // of this tool, so that should be the default rather than something you
    // have to remember to switch (picking your own account by accident
    // silently changes YOUR password instead of theirs, while they stay
    // locked out with no error to notice).
    if(resetPasswordUser) resetPasswordUser.value = currentUser === 'anna' ? 'jordan' : 'anna';
    applyLayoutForCurrentUser();
  }

  // Whoever's logged in sees their own commitments first, with the other
  // person's section collapsible (Jordan asked to be able to minimize
  // Anna's, and by the same logic Anna should be able to minimize his) --
  // and "Add Commitment" lives in your own section header instead of a
  // floating button disconnected from either list.
  function applyLayoutForCurrentUser(){
    const otherId = currentUser === 'anna' ? 'jordan' : 'anna';
    const mineSection = document.getElementById('section-' + currentUser);
    const otherSection = document.getElementById('section-' + otherId);
    const columns = document.querySelector('main.user-columns');
    if(!mineSection || !otherSection || !columns) return;
    columns.appendChild(mineSection);
    columns.appendChild(otherSection);
    mineSection.classList.remove('is-collapsed');

    const myActions = document.getElementById('panel-actions-' + currentUser);
    if(myActions && addButton){
      addButton.classList.remove('fab');
      addButton.classList.add('inline-add-btn');
      myActions.appendChild(addButton);
    }
    const staleToggle = myActions ? myActions.querySelector('.collapse-toggle') : null;
    if(staleToggle) staleToggle.remove();

    const otherActions = document.getElementById('panel-actions-' + otherId);
    if(otherActions && !otherActions.querySelector('.collapse-toggle')){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collapse-toggle icon-button';
      const setLabel = ()=>{
        const collapsed = otherSection.classList.contains('is-collapsed');
        btn.textContent = collapsed ? '▸' : '▾';
        btn.setAttribute('aria-label', (collapsed ? 'Show ' : 'Minimize ') + userName(otherId) + "'s commitments");
      };
      otherSection.classList.toggle('is-collapsed', !!state.collapsedOther);
      setLabel();
      btn.addEventListener('click', ()=>{
        otherSection.classList.toggle('is-collapsed');
        state.collapsedOther = otherSection.classList.contains('is-collapsed');
        save(state);
        setLabel();
      });
      otherActions.appendChild(btn);
    }
  }

  // Escape closes whichever panel-modal is currently open (detail view,
  // wizard, settings, etc.) -- generic rather than tied to any one modal,
  // since any of them can be the one open at a given moment.
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape') return;
    const open = document.querySelector('.panel-modal:not(.hidden)');
    if(open) open.classList.add('hidden');
  });

  // Pushes one commitment's current fields to the server: creates it if it
  // has no remoteId yet, otherwise updates it in place. Used after any local
  // change to your own commitment (done-toggle, add/edit, reminder change) so
  // the other person's phone picks it up on its next sync, rather than
  // waiting for a manual push.
  async function pushCommitmentToServer(c){
    if(!authToken) return;
    const payload = {
      text: c.text, enabled: c.enabled, schedule: c.schedule,
      scheduleDays: c.scheduleDays || null, reminderEnabled: c.reminderEnabled || false,
      reminderTime: c.reminderTime || null, weeklyTarget: c.weeklyTarget || null,
      label: c.label || null, target: c.target || null, achieved: c.achieved || false,
      achievedAt: c.achievedAt || null, createdAt: c.createdAt || null,
      scope: c.for === 'both' ? 'joint' : 'personal', deadlineDate: c.deadlineDate || null,
      lastLoggedAt: c.lastLoggedAt || null
    };
    // A tracker's "doneToday" is never a real toggle -- it's only ever
    // changed via the dedicated /log endpoint (logTracker()). Sending it
    // here would route an ordinary edit (pause, rename, etc.) through the
    // server's doneToday branch, which increments today's completion_log
    // count on every single push, not just an actual log event.
    if(!isTrackerSchedule(c)) payload.doneToday = c.doneToday;
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
        if(j.xp !== undefined && j.xp !== null){
          // The server reports the requester's own new XP total -- for a
          // joint commitment the other person's XP also changed, but their
          // client picks that up on its own next sync, same as everything
          // else that isn't tied to whoever made this particular request.
          state.usersXp = state.usersXp || {};
          const prevXp = state.usersXp[currentUser] || 0;
          const prevLevel = levelForXp(prevXp);
          state.usersXp[currentUser] = j.xp;
          const newLevel = levelForXp(j.xp);
          if(j.xp > prevXp && newLevel.name !== prevLevel.name){
            setTimeout(()=> showCelebration(`🎉 ${userName(currentUser)} leveled up to ${newLevel.name}!`), 2800);
          }
        }
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
    const justCompleted = !c.doneToday;
    const isDeadline = isDeadlineSchedule(c);
    if(!c.doneToday){
      // A one-off commitment only ever has one completion -- replace rather
      // than push, so there's never more than the single record it needs.
      if(isDeadline) c.history = [today];
      else if(!c.history.includes(today)) c.history.push(today);
      c.doneToday = true;
    } else {
      c.doneToday = false;
      if(isDeadline) c.history = [];
      else {
        const idx = c.history.indexOf(today);
        if(idx >= 0) c.history.splice(idx, 1);
      }
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
    pushCommitmentToServer(c).then(()=>{ renderLevels(); });
    if(justCompleted){
      celebrateCompletion(c);
      maybeTriggerRareEvent(c.for);
    }
  }

  // Resets a tracker's running clock. Unlike toggleCommitDone, this isn't a
  // toggle -- there's no "undone" state to switch back to, since the whole
  // point is an honest log of when it last happened. Still records today in
  // history (for the existing History heatmap) and pushes to the server via
  // the dedicated /log endpoint rather than the doneToday PUT semantics.
  async function logTracker(c){
    if(!canEditCommit(c)){
      showToast('Not yours to log', `Only ${userName(c.for)} can log "${c.text}".`);
      return;
    }
    const nowIso = new Date().toISOString();
    const today = appToday();
    if(isRemoteMode() && c.remoteId){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/log', { method: 'POST', headers: { authorization: 'Bearer '+authToken } });
        if(res.ok){
          const j = await res.json();
          c.lastLoggedAt = j.lastLoggedAt || nowIso;
          if(j.xp !== undefined && j.xp !== null){
            state.usersXp = state.usersXp || {};
            state.usersXp[currentUser] = j.xp;
          }
        } else {
          c.lastLoggedAt = nowIso;
        }
      }catch(e){ console.error('tracker log push failed', e); c.lastLoggedAt = nowIso; }
    } else {
      c.lastLoggedAt = nowIso;
    }
    c.history = c.history || [];
    if(!c.history.includes(today)) c.history.push(today);
    save(state);
    renderList();
    // XP is docked immediately (the /log endpoint applies it synchronously,
    // same as marking a normal habit done/undone). The life loss follows
    // the usual daily evaluation instead, once today is fully in the past --
    // same timing as any other missed habit -- so this is upfront that it
    // hasn't landed yet rather than implying it already has.
    showToast('Logged', `"${c.text}" — XP docked. Counts as a miss once today's tally runs, same as any other missed habit.`);
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

  async function addComment(c, fromUserId, providedText){
    const text = (providedText || '').trim();
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

  // Full comment thread -- the endpoint already existed for this, it just
  // was never actually shown anywhere; cards only ever displayed the single
  // latest comment as a preview.
  async function fetchCommentThread(c){
    if(isRemoteMode() && c.remoteId){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/comments', { headers: { authorization: 'Bearer '+authToken } });
        if(res.ok) return await res.json();
      }catch(e){ /* fall through to local */ }
    }
    return (c.comments || []).map(t => (typeof t === 'string' ? { text: t, by: null, at: null } : t));
  }

  // A row of the last 7 days (today included) so a habit's recent pattern
  // is visible at a glance, without opening History. "N times a week"
  // habits have no specific due day, so a day is never marked "missed" for
  // them -- only "complete" (done) or neutral, to avoid implying a daily
  // obligation that doesn't exist.
  function buildWeekStrip(c){
    const strip = document.createElement('div'); strip.className = 'week-strip';
    const todayIso = appToday();
    const isWeekly = isWeeklyTargetSchedule(c);
    getWindowDates(todayIso, 7).forEach(dateIso => {
      const cell = document.createElement('div'); cell.className = 'week-day';
      const dateObj = parseLocalDate(dateIso);
      const withinLifetime = !c.createdAt || c.createdAt <= dateIso;
      const done = withinLifetime && Array.isArray(c.history) && c.history.includes(dateIso);
      const due = withinLifetime && !isWeekly && isScheduledDay(c, dateIso);
      if(done) cell.classList.add('is-complete');
      else if(due && dateIso !== todayIso) cell.classList.add('is-missed');
      else if(due) cell.classList.add('is-pending'); // due today, day isn't over yet
      else cell.classList.add('is-off');
      if(dateIso === todayIso) cell.classList.add('is-today');
      const label = document.createElement('span'); label.className = 'week-day-label';
      label.textContent = dateObj.toLocaleDateString('en-US', { weekday: 'narrow' });
      const circle = document.createElement('span'); circle.className = 'week-day-circle';
      circle.textContent = String(dateObj.getDate());
      cell.appendChild(label);
      cell.appendChild(circle);
      strip.appendChild(cell);
    });
    return strip;
  }

  // A one-off commitment doesn't have a "recent pattern" the way a recurring
  // habit does -- a 7-day strip of empty boxes either side of its one due
  // date would be more confusing than useful. Shows a countdown/overdue
  // status instead, in both the compact headline row and the full detail view.
  function deadlineStatusInfo(c){
    const today = appToday();
    const done = Array.isArray(c.history) && c.history.length > 0;
    if(done){
      const completedOn = c.history[0];
      return { cls: 'is-complete', text: `✅ Completed${completedOn ? ' on ' + completedOn : ''}` };
    }
    const deadline = c.deadlineDate;
    if(!deadline) return { cls: '', text: 'No deadline set' };
    if(deadline < today) return { cls: 'is-overdue', text: `⏰ Overdue — was due ${deadline}` };
    if(deadline === today) return { cls: 'is-due-today', text: '⏳ Due today' };
    const days = Math.round((parseLocalDate(deadline) - parseLocalDate(today)) / (24*60*60*1000));
    return { cls: 'is-upcoming', text: `📅 Due ${deadline} · ${days} day${days === 1 ? '' : 's'} left` };
  }

  function buildDeadlineStatus(c){
    const info = deadlineStatusInfo(c);
    const el = document.createElement('div');
    el.className = 'deadline-status' + (info.cls ? ' ' + info.cls : '');
    el.textContent = info.text;
    return el;
  }

  // A tracker has no schedule and no lives at stake -- just a plain-English
  // running clock since it was last logged, for things like "Eating meat"
  // where the goal is to see how long you've gone, not to comply with a
  // schedule.
  function formatElapsed(ms){
    const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if(days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'}`;
    if(hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'}`;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  function trackerStatusText(lastLoggedAtIso, full){
    if(!lastLoggedAtIso) return full ? "Not logged yet" : '⏱️ Not logged yet';
    const elapsed = formatElapsed(Date.now() - new Date(lastLoggedAtIso).getTime());
    return full ? `It's been ${elapsed} since last logged` : `⏱️ ${elapsed}`;
  }

  // Compact (headline) or full (detail) variant, both driven off the same
  // data-lastLoggedAt attribute so the ticking updater below can refresh
  // either one without needing to know which commitment it belongs to.
  function buildTrackerStatus(c, { full = false } = {}){
    const el = document.createElement('div');
    el.className = 'tracker-status' + (full ? ' tracker-status-detail' : '');
    el.dataset.lastLoggedAt = c.lastLoggedAt || '';
    el.dataset.full = full ? '1' : '';
    el.textContent = trackerStatusText(c.lastLoggedAt, full);
    return el;
  }

  // Refreshes every visible tracker clock in place -- re-queries the DOM
  // each tick rather than holding element references, so it stays correct
  // across renderList() rebuilding the list and detail view being
  // opened/closed freely.
  function tickTrackerClocks(){
    document.querySelectorAll('.tracker-status').forEach(el => {
      el.textContent = trackerStatusText(el.dataset.lastLoggedAt || null, el.dataset.full === '1');
    });
    checkAllTrackerMilestones();
  }
  setInterval(tickTrackerClocks, 30000);

  function trackerElapsedDays(lastLoggedAtIso){
    if(!lastLoggedAtIso) return 0;
    return Math.floor((Date.now() - new Date(lastLoggedAtIso).getTime()) / 86400000);
  }

  // The last weekly milestone a tracker has actually reached, for the "Last
  // milestone" card in detail view -- null until a full week has passed.
  function lastTrackerMilestone(c){
    const weeks = trackerMilestoneWeeks(trackerElapsedDays(c.lastLoggedAt));
    if(weeks < 1) return null;
    return { weeks, label: trackerMilestoneLabel(weeks), days: weeks * 7 };
  }

  function buildTrackerMilestoneCard(c){
    const milestone = lastTrackerMilestone(c);
    const el = document.createElement('div');
    el.className = 'tracker-milestone';
    el.innerHTML = milestone
      ? `<div class="tracker-milestone-label">Last milestone</div><div class="tracker-milestone-value">🏅 ${escapeHtml(milestone.label)} · ${milestone.days} days</div>`
      : `<div class="tracker-milestone-label">Last milestone</div><div class="tracker-milestone-value muted">Keep it up for a week to hit your first one</div>`;
    return el;
  }

  // Celebrates a tracker crossing a new weekly milestone. Milestone
  // acknowledgement (c.milestonesCelebrated) is local-only, same as lives --
  // mergeRemoteCommitment() never touches unrecognized fields, so this
  // survives a server sync untouched, and each device pops its own fireworks
  // rather than depending on a round trip. If several weeks were crossed at
  // once (app not opened for a while), every one of them is marked
  // acknowledged but only the highest is actually celebrated, so reopening
  // the app after a month doesn't fire four overlays in a row.
  function checkTrackerMilestone(c){
    if(!isTrackerSchedule(c) || !c.lastLoggedAt) return;
    const weeks = trackerMilestoneWeeks(trackerElapsedDays(c.lastLoggedAt));
    if(weeks < 1) return;
    c.milestonesCelebrated = c.milestonesCelebrated || [];
    if(c.milestonesCelebrated.includes(weeks)) return;
    const newlyCrossed = [];
    for(let w = 1; w <= weeks; w += 1){
      if(!c.milestonesCelebrated.includes(w)){
        c.milestonesCelebrated.push(w);
        newlyCrossed.push(w);
      }
    }
    save(state);
    if(newlyCrossed.length){
      showCelebration(`🎉 "${c.text}" hit a milestone: ${trackerMilestoneLabel(weeks)}!`, { catImage: pickCatImage('pleased') });
    }
  }

  function checkAllTrackerMilestones(){
    state.commitments.filter(isTrackerSchedule).forEach(checkTrackerMilestone);
  }

  function renderCommitmentsForUser(userId, targetList){
    targetList.innerHTML = '';
    const visible = state.commitments.filter(c => c.for === userId);
    if(visible.length === 0){
      targetList.innerHTML = '<li class="empty-state small muted">Nothing here yet. Tap + and give the Good Cat something to keep an eye on.</li>';
      return;
    }
    visible.forEach(c => targetList.appendChild(buildHeadlineCard(c)));
  }

  function renderJointCommitments(){
    if(!jointSection || !commitListJoint) return;
    commitListJoint.innerHTML = '';
    const visible = state.commitments.filter(c => c.for === 'both');
    jointSection.classList.toggle('hidden', visible.length === 0);
    if(visible.length === 0) return;
    visible.forEach(c => commitListJoint.appendChild(buildHeadlineCard(c)));
  }

  function commitBadgesHtml(c){
    const notStartedYet = c.createdAt && c.createdAt > appToday();
    return [
      c.for === 'both' ? '<span class="joint-badge">🤝 Together</span>' : '',
      !c.enabled ? '<span class="paused-badge">Paused</span>' : '',
      c.enabled && c.pauseRequestPending ? `<span class="paused-badge">${c.pauseRequestedByMe ? 'Pause requested' : 'Pause needs your OK'}</span>` : '',
      notStartedYet ? `<span class="paused-badge">Starts ${escapeHtml(c.createdAt)}</span>` : '',
      c.label ? `<span class="label-badge">${LABEL_ICONS[c.label] || ''} ${escapeHtml(c.label)}</span>` : '',
      c.achieved ? '<span class="achieved-badge">Achieved</span>' : ''
    ].filter(Boolean).join(' ');
  }

  // Compact "glance" row for the dashboard list -- name, badges, and a mini
  // week-strip so the recent pattern is visible without opening anything.
  // No tap-to-toggle here: tapping opens the detail view instead, where
  // marking done is a dedicated, deliberate button rather than something
  // any stray tap on the list can trigger.
  function buildHeadlineCard(c){
    c.history = c.history || [];
    updateCommitStatusFromHistory(c);
    const li = document.createElement('li');
    li.className = 'commit-headline';
    // A tracker being "done today" means the avoided thing just happened --
    // the green success tint would send exactly the wrong signal there, so
    // it's excluded regardless of c.doneToday.
    li.classList.toggle('is-done', !!c.doneToday && !isTrackerSchedule(c));
    li.classList.toggle('is-paused', !c.enabled);

    const isDeadline = isDeadlineSchedule(c);
    const isTracker = isTrackerSchedule(c);
    const overdue = isDeadline && !c.doneToday && c.deadlineDate && c.deadlineDate < appToday();

    const icon = document.createElement('div');
    icon.className = 'card-status-icon';
    icon.textContent = c.achieved ? '🏆' : isTracker ? (LABEL_ICONS[c.label] || '⏱️') : c.doneToday ? '✅' : overdue ? '⏰' : (LABEL_ICONS[c.label] || '📌');
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div'); body.className = 'headline-body';
    const badgesHtml = commitBadgesHtml(c);
    body.innerHTML = `
      <strong class="card-name">${escapeHtml(c.text)}</strong>
      ${badgesHtml ? `<div class="card-badges">${badgesHtml}</div>` : ''}
    `;

    // Unlike the compact week-strip (a fixed-width row of dots), the
    // deadline/tracker status is a variable-length sentence -- it belongs
    // stacked inside the body with the name and badges, not squeezed in as
    // a fixed-width sibling next to the chevron, or long titles get crushed
    // into an unreadable mid-word wrap.
    if(isDeadline){
      body.appendChild(buildDeadlineStatus(c));
    } else if(isTracker){
      body.appendChild(buildTrackerStatus(c));
    }

    const chevron = document.createElement('div');
    chevron.className = 'headline-chevron';
    chevron.textContent = '›';
    chevron.setAttribute('aria-hidden', 'true');

    li.appendChild(icon);
    li.appendChild(body);
    if(!isDeadline && !isTracker){
      const miniStrip = buildWeekStrip(c);
      miniStrip.classList.add('mini');
      li.appendChild(miniStrip);
    }
    li.appendChild(chevron);

    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', `Open details for "${c.text}"`);
    li.addEventListener('click', ()=> openCommitDetail(c));
    li.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openCommitDetail(c); }
    });

    return li;
  }

  // The full picture for one commitment -- everything that used to be
  // spread across the always-expanded card plus the "..." menu now lives
  // here instead: full week-strip, progress, the actual comment thread
  // (not just a one-line preview), and every action as a visible button
  // rather than a hidden dropdown.
  async function openCommitDetail(c){
    const owned = canEditCommit(c);
    const canPaw = c.for !== currentUser && c.for !== 'both';
    const badgesHtml = commitBadgesHtml(c);
    const isDeadline = isDeadlineSchedule(c);
    const isTracker = isTrackerSchedule(c);
    const overdue = isDeadline && !c.doneToday && c.deadlineDate && c.deadlineDate < appToday();

    detailBody.innerHTML = `
      <div class="detail-header">
        <div class="detail-icon">${c.achieved ? '🏆' : isTracker ? (LABEL_ICONS[c.label] || '⏱️') : c.doneToday ? '✅' : overdue ? '⏰' : (LABEL_ICONS[c.label] || '📌')}</div>
        <div>
          <h2 class="detail-name">${escapeHtml(c.text)}</h2>
          ${badgesHtml ? `<div class="card-badges">${badgesHtml}</div>` : ''}
          <div class="card-meta">${getScheduleDescription(c)}</div>
        </div>
      </div>
    `;

    if(owned && isTracker){
      const logBtn = document.createElement('button');
      logBtn.type = 'button';
      logBtn.className = 'detail-mark-btn';
      logBtn.textContent = '🔁 Log now (resets the clock — costs a life)';
      logBtn.addEventListener('click', async ()=>{
        await logTracker(c);
        openCommitDetail(c);
      });
      detailBody.appendChild(logBtn);
    } else if(owned){
      const markBtn = document.createElement('button');
      markBtn.type = 'button';
      markBtn.className = 'detail-mark-btn' + (c.doneToday ? ' is-done' : '');
      markBtn.textContent = c.doneToday
        ? (isDeadline ? '✅ Completed — tap to undo' : '✅ Marked done today — tap to undo')
        : (isDeadline ? 'Mark as done' : 'Mark done for today');
      markBtn.addEventListener('click', ()=>{
        toggleCommitDone(c);
        openCommitDetail(c);
      });
      detailBody.appendChild(markBtn);
    }

    if(isDeadline) detailBody.appendChild(buildDeadlineStatus(c));
    else if(isTracker){
      detailBody.appendChild(buildTrackerStatus(c, { full: true }));
      detailBody.appendChild(buildTrackerMilestoneCard(c));
    }
    else detailBody.appendChild(buildWeekStrip(c));

    if(c.target){
      const progress = document.createElement('div'); progress.className = 'card-progress';
      const percent = Math.min(100, Math.round(((c.streak||0) / c.target) * 100));
      progress.innerHTML = `<div class="progress-bar"><div class="progress-fill" style="width:${percent}%"></div></div><div class="progress-text">${c.streak||0} / ${c.target} days (${percent}%)</div>`;
      detailBody.appendChild(progress);
    }
    if(c.weeklyTarget){
      const weeklyCount = countCompletionsThisWeek(c, getEffectiveNow());
      const wPercent = Math.min(100, Math.round((weeklyCount / c.weeklyTarget) * 100));
      const wp = document.createElement('div'); wp.className = 'weekly-progress';
      wp.innerHTML = `<div class="weekly-meta">This week: <strong>${weeklyCount}</strong> / ${c.weeklyTarget}</div><div class="weekly-bar"><div class="weekly-fill" style="width:${wPercent}%"></div></div>`;
      detailBody.appendChild(wp);
    }

    if(owned && !isTracker){
      const reminderRow = document.createElement('div'); reminderRow.className = 'menu-item menu-reminder detail-reminder-row';
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
      }
      reminderCheckbox.addEventListener('change', saveReminder);
      reminderTimeInput.addEventListener('change', saveReminder);
      reminderRow.appendChild(reminderToggle);
      reminderRow.appendChild(reminderTimeInput);
      detailBody.appendChild(reminderRow);
    }

    if(canPaw){
      const pawBtn = document.createElement('button');
      pawBtn.type = 'button';
      pawBtn.className = 'paw-button';
      const alreadyPawed = hasPawedToday(c);
      pawBtn.textContent = '🐾';
      pawBtn.disabled = alreadyPawed;
      pawBtn.title = alreadyPawed ? 'Already pawed today' : `Send ${userName(c.for)} a paw`;
      pawBtn.setAttribute('aria-label', pawBtn.title);
      pawBtn.addEventListener('click', ()=>{ givePaw(c, currentUser); openCommitDetail(c); });
      detailBody.appendChild(pawBtn);
    }
    const pawCount = pawCountFor(c);
    if(pawCount > 0){
      const lastPaw = lastPawFor(c);
      const pawChip = document.createElement('div'); pawChip.className = 'paw-chip';
      pawChip.textContent = lastPaw && lastPaw.by ? `🐾 ${pawCount} · last from ${userName(lastPaw.by.toLowerCase ? lastPaw.by.toLowerCase() : lastPaw.by)}` : `🐾 ${pawCount}`;
      detailBody.appendChild(pawChip);
    }

    const actions = document.createElement('div'); actions.className = 'detail-actions';
    if(owned){
      const editBtn = document.createElement('button'); editBtn.type='button'; editBtn.className='detail-action-btn'; editBtn.textContent='✏️ Edit';
      editBtn.addEventListener('click', ()=>{ detailModal.classList.add('hidden'); openEditCommit(c); });
      actions.appendChild(editBtn);

      // Resuming stays a single instant button -- only PAUSING (opting out
      // of the life-loss/leaderboard/reminder stakes) goes through the
      // request/approve flow, so the friction only applies to the direction
      // that matters.
      if(!c.enabled){
        const resumeBtn = document.createElement('button'); resumeBtn.type='button'; resumeBtn.className='detail-action-btn'; resumeBtn.textContent='▶️ Resume';
        resumeBtn.addEventListener('click', ()=>{
          c.enabled = true;
          save(state);
          pushCommitmentToServer(c);
          renderList();
          openCommitDetail(c);
        });
        actions.appendChild(resumeBtn);
      } else if(c.pauseRequestPending && c.pauseRequestedByMe){
        const cancelBtn = document.createElement('button'); cancelBtn.type='button'; cancelBtn.className='detail-action-btn'; cancelBtn.textContent='⏳ Waiting for approval — tap to cancel';
        cancelBtn.addEventListener('click', ()=> cancelPauseRequest(c));
        actions.appendChild(cancelBtn);
      } else if(c.pauseRequestPending && !c.pauseRequestedByMe){
        // A joint commitment: your co-owner is waiting on YOU to approve --
        // also reachable from the pause-requests inbox, but surfacing it
        // right here too means you don't have to go hunting for it.
        const approveBtn = document.createElement('button'); approveBtn.type='button'; approveBtn.className='detail-action-btn'; approveBtn.textContent='✅ Approve pause';
        approveBtn.addEventListener('click', async ()=>{
          if(!c.pauseRequestId) return;
          await resolvePauseRequest({ id: c.pauseRequestId, commitmentText: c.text }, 'approve');
          openCommitDetail(c);
        });
        const declineBtn = document.createElement('button'); declineBtn.type='button'; declineBtn.className='detail-action-btn danger'; declineBtn.textContent='✕ Decline pause';
        declineBtn.addEventListener('click', async ()=>{
          if(!c.pauseRequestId) return;
          await resolvePauseRequest({ id: c.pauseRequestId, commitmentText: c.text }, 'decline');
          openCommitDetail(c);
        });
        actions.appendChild(approveBtn);
        actions.appendChild(declineBtn);
      } else {
        const pauseBtn = document.createElement('button'); pauseBtn.type='button'; pauseBtn.className='detail-action-btn'; pauseBtn.textContent='⏸ Request pause';
        pauseBtn.addEventListener('click', ()=> requestPause(c));
        actions.appendChild(pauseBtn);
      }
    }

    const histBtn = document.createElement('button'); histBtn.type='button'; histBtn.className='detail-action-btn'; histBtn.textContent='📅 History';
    histBtn.addEventListener('click', ()=> showHistory(c));
    actions.appendChild(histBtn);

    if(owned){
      const delBtn = document.createElement('button'); delBtn.type='button'; delBtn.className='detail-action-btn danger'; delBtn.textContent='🗑 Delete';
      delBtn.addEventListener('click', ()=>{
        if(!confirm(`Delete "${c.text}"? This cannot be undone.`)) return;
        deleteCommitmentFromServer(c);
        state.commitments = state.commitments.filter(x=>x.id!==c.id);
        save(state);
        renderList();
        detailModal.classList.add('hidden');
      });
      actions.appendChild(delBtn);
    }
    detailBody.appendChild(actions);

    const commentsSection = document.createElement('div'); commentsSection.className = 'detail-comments';
    commentsSection.innerHTML = `
      <h3>💬 Comments</h3>
      <div id="detailCommentThread" class="comment-thread"><p class="small muted">Loading…</p></div>
      <div class="detail-reply-row">
        <input id="detailReplyInput" placeholder="Leave a note..." />
        <button type="button" id="detailReplySend">Send</button>
      </div>
    `;
    detailBody.appendChild(commentsSection);

    detailModal.classList.remove('hidden');

    // Wired up before the (awaited) thread fetch below, not after -- typing
    // and hitting Send fast enough to land before that fetch resolves used
    // to click a button with no listener on it yet, silently doing nothing.
    const replyInput = document.getElementById('detailReplyInput');
    const replySend = document.getElementById('detailReplySend');
    if(replySend && replyInput){
      const sendReply = async ()=>{
        const text = replyInput.value.trim();
        if(!text) return;
        await addComment(c, currentUser, text);
        openCommitDetail(c);
      };
      replySend.addEventListener('click', sendReply);
      replyInput.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); sendReply(); } });
    }

    const thread = await fetchCommentThread(c);
    const threadEl = document.getElementById('detailCommentThread');
    if(threadEl){
      threadEl.innerHTML = thread.length ? '' : '<p class="small muted">No comments yet.</p>';
      thread.forEach(entry => {
        const item = document.createElement('div'); item.className = 'comment-item';
        const byName = entry.by ? (userName(entry.by.toLowerCase ? entry.by.toLowerCase() : entry.by)) : null;
        const when = entry.at ? new Date(entry.at).toLocaleString() : '';
        item.innerHTML = `<div class="comment-meta">${byName ? escapeHtml(byName) : 'You'}${when ? ' · ' + escapeHtml(when) : ''}</div><p>${escapeHtml(entry.text)}</p>`;
        threadEl.appendChild(item);
      });
    }
  }


  function renderList(){
    updateLivesForUser('anna');
    updateLivesForUser('jordan');
    renderJointCommitments();
    renderCommitmentsForUser('anna', commitListAnna);
    renderCommitmentsForUser('jordan', commitListJordan);
    renderLives();
    renderLevels();
  }

  // Remote sync helpers. Always the production server -- a ?api=... query
  // param can override for local dev testing, but nothing here persists to
  // localStorage, so a device can never get stuck pointed at a stale address.
  function apiBase(){
    return new URLSearchParams(location.search).get('api') || DEFAULT_API_BASE;
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
      wellbeingCategory = null;
      renderWellbeingPrompt();
      fetchTodos();
      fetchShoppingItems();
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
    if(commitDeadlineRow) commitDeadlineRow.style.display = commit.schedule === 'deadline' ? 'block' : 'none';
    if(commitDeadlineDate) commitDeadlineDate.value = commit.deadlineDate || '';
    commitLabel.value = commit.label || '';
    commitTarget.value = commit.target || '';
    commitJoint.checked = commit.for === 'both';
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
    local.deadlineDate = r.deadlineDate || null;
    local.lastLoggedAt = r.lastLoggedAt || null;
    local.history = history;
    local.createdAt = r.createdAt || local.createdAt || appToday();
    local.pawCount = r.pawCount;
    local.lastPaw = r.lastPaw;
    local.lastComment = r.lastComment;
    local.pauseRequestPending = !!r.pauseRequestPending;
    local.pauseRequestId = r.pauseRequestId || null;
    local.pauseRequestedByMe = !!r.pauseRequestedByMe;
  }

  async function pushUnsyncedLocalCommitments(){
    const unsynced = state.commitments.filter(c => (c.for === currentUser || c.for === 'both') && !c.remoteId);
    for(const c of unsynced) await pushCommitmentToServer(c);
  }

  // Shows a toast for a server-side life event this device hasn't shown
  // yet -- this is what surfaces a change made on the OTHER device (the
  // other person's phone, or the family council completing while this
  // device wasn't looking), not just ones this device itself triggered
  // (those already show their own toast synchronously at the point of
  // action). The very first check EVER (tracked separately from "has this
  // device seen a non-null event yet" -- a debug lives-set or a fresh
  // account can go through several real checks with no event at all)
  // just establishes a baseline silently, otherwise shipping this would
  // immediately re-announce whatever already happened before this device
  // ever knew to look.
  function maybeShowLifeEventToast(event){
    ensureLifeState();
    const isFirstCheckEver = !state.lifeEventBaselineSet[currentUser];
    state.lifeEventBaselineSet[currentUser] = true;
    if(!event){ save(state); return; }
    const key = `${event.date}|${event.type}|${event.createdAt}`;
    if(state.lastShownLifeEventAt[currentUser] === key){ save(state); return; }
    state.lastShownLifeEventAt[currentUser] = key;
    save(state);
    if(isFirstCheckEver) return;
    if(event.type === 'daily_loss' || event.type === 'weekly_loss'){
      const cat = pickCatImage('judging');
      playSound('meow');
      const what = event.type === 'weekly_loss' ? 'missed a weekly target last week' : 'missed a scheduled habit yesterday';
      showToast(`${cat ? cat.name : 'Bots'} is judging you`, `${userName(currentUser)} ${what} — lost 1 life.`, cat);
    } else if(event.type === 'weekly_gain'){
      const cat = pickCatImage('pleased');
      showToast(`${cat ? cat.name : 'Loki'} is pleased with ` + userName(currentUser), `Kept up with scheduled habits this past week — gained ${event.delta} ${event.delta === 1 ? 'life' : 'lives'}!`, cat);
    } else if(event.type === 'refund' || event.type === 'weekly_refund'){
      showToast('Life refunded', `${userName(currentUser)} — that ${event.type === 'weekly_refund' ? "week's" : "day's"} fully caught up now, so the life lost for it has been given back.`);
    } else if(event.type === 'council_reset'){
      showToast('Family council complete', 'Lives have been reset to 3 for both people.');
    }
    // 'rare_bonus' is deliberately silent here -- maybeTriggerRareEvent()
    // already celebrated it synchronously the moment it happened; this is
    // just marking it seen so it doesn't also show up as "new" forever.
  }

  // Pulls both people's XP and current lives from the server -- lives are
  // now evaluated server-side (see server/lives.js), so this is also what
  // keeps this device's displayed lives current in remote mode.
  async function fetchUsersStatus(){
    try{
      const res = await fetch(apiBase() + '/api/users', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      const list = await res.json();
      ensureLifeState();
      state.usersXp = state.usersXp || {};
      for(const u of list){
        const uid = (u.name||'').toLowerCase();
        state.usersXp[uid] = u.xp || 0;
        if(uid === 'anna' || uid === 'jordan'){
          state.lives[uid] = u.lives != null ? u.lives : MAX_LIVES;
          if(uid === currentUser) maybeShowLifeEventToast(u.lastLifeEvent);
        }
      }
      save(state);
      renderLevels();
      renderLives();
    }catch(e){ /* non-critical */ }
  }

  async function fetchSuggestions(){
    try{
      const res = await fetch(apiBase() + '/api/suggestions', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      state.suggestions = await res.json();
      save(state);
      renderSuggestions();
    }catch(e){ /* non-critical */ }
  }

  // --- Pause requests: pausing closes off life-loss/leaderboard/reminder
  // stakes, so it needs the other person's approval rather than being
  // instant -- especially for a joint commitment, where pausing
  // unilaterally would affect someone else's stake too. Same inbox-card
  // style as suggestions, just a different action (approve/decline a pause
  // rather than accept/amend/reject a new commitment). ---
  async function fetchPauseRequests(){
    try{
      const res = await fetch(apiBase() + '/api/pause-requests', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      state.pauseRequests = await res.json();
      save(state);
      renderPauseRequests();
    }catch(e){ /* non-critical */ }
  }

  function renderPauseRequests(){
    if(!pauseRequestsList) return;
    const list = state.pauseRequests || [];
    pauseRequestsList.innerHTML = '';
    pauseRequestsSection.classList.toggle('hidden', list.length === 0);
    list.forEach(r => {
      const card = document.createElement('div'); card.className = 'suggestion-card';
      card.innerHTML = `
        <p class="suggestion-from">From ${escapeHtml(r.fromName)}</p>
        <p class="suggestion-text">Pause "${escapeHtml(r.commitmentText)}"?</p>
      `;
      const actions = document.createElement('div'); actions.className = 'suggestion-actions';
      const approveBtn = document.createElement('button'); approveBtn.type='button'; approveBtn.className='primary'; approveBtn.textContent='✅ Approve';
      approveBtn.addEventListener('click', ()=> resolvePauseRequest(r, 'approve'));
      const declineBtn = document.createElement('button'); declineBtn.type='button'; declineBtn.className='danger'; declineBtn.textContent='✕ Decline';
      declineBtn.addEventListener('click', ()=> resolvePauseRequest(r, 'decline'));
      actions.appendChild(approveBtn); actions.appendChild(declineBtn);
      card.appendChild(actions);
      pauseRequestsList.appendChild(card);
    });
  }

  async function resolvePauseRequest(r, action){
    if(!authToken) return;
    try{
      const res = await fetch(apiBase() + '/api/pause-requests/' + r.id + '/' + action, { method:'POST', headers: { authorization: 'Bearer '+authToken } });
      if(res.ok){
        state.pauseRequests = (state.pauseRequests||[]).filter(x=>x.id!==r.id);
        save(state);
        renderPauseRequests();
        showToast(action === 'approve' ? 'Approved' : 'Declined', action === 'approve' ? `"${r.commitmentText}" is now paused.` : `"${r.commitmentText}" stays active.`);
        runSync();
      }
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  function otherUserId(userId){
    return userId === 'anna' ? 'jordan' : (userId === 'jordan' ? 'anna' : null);
  }

  // Requesting (not instantly applying) a pause -- see the section comment
  // above. Offline/local-only mode has no "other person" to ask, so pause
  // stays instant there, same as before.
  async function requestPause(c){
    if(!isRemoteMode() || !c.remoteId){
      c.enabled = false;
      save(state);
      pushCommitmentToServer(c);
      renderList();
      openCommitDetail(c);
      return;
    }
    try{
      const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/pause-request', { method:'POST', headers: { authorization: 'Bearer '+authToken } });
      if(res.ok){
        const j = await res.json();
        c.pauseRequestPending = true;
        c.pauseRequestedByMe = true;
        c.pauseRequestId = j.id;
        save(state);
        renderList();
        openCommitDetail(c);
        const other = otherUserId(currentUser);
        showToast('Pause requested', `Waiting for ${userName(other)} to approve.`);
      } else {
        const j = await res.json().catch(()=>null);
        showToast('Could not request', (j && j.error) || 'Something went wrong.');
      }
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  async function cancelPauseRequest(c){
    if(!c.pauseRequestId) return;
    try{
      const res = await fetch(apiBase() + '/api/pause-requests/' + c.pauseRequestId + '/cancel', { method:'POST', headers: { authorization: 'Bearer '+authToken } });
      if(res.ok){
        c.pauseRequestPending = false;
        c.pauseRequestId = null;
        save(state);
        renderList();
        openCommitDetail(c);
        showToast('Cancelled', `Withdrew your pause request for "${c.text}".`);
      }
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  // --- Wellbeing check-in: a rotating, once-every-couple-of-weeks prompt
  // about one category at a time. The server owns the rotation/cooldown; the
  // client just asks whether one is due and shows it if so. ---
  const WELLBEING_QUESTIONS = {
    Health: "How's your health been feeling lately?",
    Fitness: 'How are your energy levels?',
    Education: "How's learning/growth been feeling?",
    Home: "How's home feeling — on top of things, or behind?",
    Money: 'How are you feeling about money right now?',
    Social: "How's your social life been feeling?",
    Relationship: "How's us been feeling lately?"
  };
  let wellbeingCategory = null;

  async function fetchWellbeingPrompt(){
    if(!authToken) return;
    try{
      const res = await fetch(apiBase() + '/api/wellbeing/prompt', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      const j = await res.json();
      wellbeingCategory = j.due ? j.category : null;
      renderWellbeingPrompt();
    }catch(e){ /* non-critical */ }
  }

  // fetchWellbeingPrompt() re-sets wellbeingCategory (and calls this) on
  // every sync while the SAME prompt is still pending -- only pick a new
  // cat image when the category actually changes to a new prompt, not on
  // every one of those re-renders.
  let lastWellbeingCategoryForImage;
  let wellbeingCatImage = null;
  function renderWellbeingPrompt(){
    if(!wellbeingSection) return;
    if(!wellbeingCategory){ wellbeingSection.classList.add('hidden'); return; }
    wellbeingIcon.textContent = LABEL_ICONS[wellbeingCategory] || '🐾';
    wellbeingQuestion.textContent = WELLBEING_QUESTIONS[wellbeingCategory] || `How's ${wellbeingCategory} been feeling?`;
    if(wellbeingCategory !== lastWellbeingCategoryForImage){
      lastWellbeingCategoryForImage = wellbeingCategory;
      wellbeingCatImage = pickCatImage('neutral');
    }
    if(wellbeingCat){
      if(wellbeingCatImage){
        wellbeingCat.src = wellbeingCatImage.src;
        wellbeingCat.alt = wellbeingCatImage.name;
        wellbeingCat.classList.remove('hidden');
      } else {
        wellbeingCat.classList.add('hidden');
      }
    }
    wellbeingSection.classList.remove('hidden');
  }

  wellbeingSection.querySelectorAll('.wellbeing-btn').forEach(btn => {
    btn.addEventListener('click', async ()=>{
      const rating = btn.dataset.rating;
      const category = wellbeingCategory;
      if(!category) return;
      try{
        const res = await fetch(apiBase() + '/api/wellbeing/respond', { method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ rating }) });
        if(!res.ok) return;
      }catch(e){ return; }
      wellbeingCategory = null;
      renderWellbeingPrompt();
      if(rating === 'low' && confirm(`Want to add a commitment for ${category}?`)){
        wizardReset();
        const tile = Array.from(wizLabelGrid.querySelectorAll('.label-tile')).find(t => t.dataset.label === category);
        if(tile){ tile.classList.add('selected'); wizardShowStep(2); }
        wizardModal.classList.remove('hidden');
      }
    });
  });

  // --- Shared to-do list ---
  async function fetchTodos(){
    if(!authToken){
      state.todos = [];
      renderTodos();
      return;
    }
    try{
      const res = await fetch(apiBase() + '/api/todos', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      state.todos = await res.json();
      renderTodos();
    }catch(e){ /* non-critical */ }
  }

  function renderTodos(){
    if(!todoList) return;
    const loggedOut = !authToken;
    if(todosLoggedOutHint) todosLoggedOutHint.classList.toggle('hidden', !loggedOut);
    if(todoAddForm) todoAddForm.classList.toggle('hidden', loggedOut);
    const todos = state.todos || [];
    todoList.innerHTML = '';
    if(loggedOut) return;
    if(todos.length === 0){
      todoList.innerHTML = '<li class="empty-state small muted">Nothing on the list yet.</li>';
      return;
    }
    todos.forEach(t => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (t.done ? ' is-done' : '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'todo-checkbox';
      checkbox.checked = !!t.done;
      checkbox.setAttribute('aria-label', `Mark "${t.text}" ${t.done ? 'not done' : 'done'}`);
      checkbox.addEventListener('change', ()=> toggleTodo(t, checkbox.checked));
      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = t.text;
      const meta = document.createElement('span');
      meta.className = 'todo-meta small muted';
      meta.textContent = t.createdByName ? `added by ${t.createdByName}` : '';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'todo-delete-btn';
      delBtn.textContent = '🗑';
      delBtn.setAttribute('aria-label', `Remove "${t.text}"`);
      delBtn.addEventListener('click', ()=> deleteTodo(t));
      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(meta);
      li.appendChild(delBtn);
      todoList.appendChild(li);
    });
  }

  // Returns whether it actually saved -- the caller (the form submit
  // handler below) needs that to decide whether it's safe to clear the
  // input, rather than clearing it unconditionally and having a failed add
  // look identical to a successful one.
  async function addTodo(text){
    if(!authToken) return false;
    try{
      const res = await fetch(apiBase() + '/api/todos', { method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ text }) });
      if(!res.ok){
        const j = await res.json().catch(()=>null);
        showToast('Not saved', (j && j.error) || "That to-do didn't save -- check you're still logged in and try again.");
        return false;
      }
      await fetchTodos();
      return true;
    }catch(e){
      showToast('Offline?', "Could not reach the server -- that to-do wasn't saved.");
      return false;
    }
  }

  async function toggleTodo(t, done){
    if(!authToken) return;
    t.done = done; // optimistic
    renderTodos();
    try{
      const res = await fetch(apiBase() + '/api/todos/' + t.id, { method: 'PUT', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ done }) });
      if(!res.ok) showToast('Not saved', "That change didn't save -- try again in a moment.");
      await fetchTodos();
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  async function deleteTodo(t){
    if(!authToken) return;
    try{
      const res = await fetch(apiBase() + '/api/todos/' + t.id, { method: 'DELETE', headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) showToast('Not removed', "That didn't delete -- try again in a moment.");
      await fetchTodos();
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  if(todoAddForm){
    todoAddForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const text = todoInput.value.trim();
      if(!text) return;
      const submitBtn = todoAddForm.querySelector('button[type="submit"]');
      if(submitBtn) submitBtn.disabled = true;
      const saved = await addTodo(text);
      if(submitBtn) submitBtn.disabled = false;
      if(saved) todoInput.value = '';
    });
  }

  // --- Shared shopping list -- same shape and rules as the to-do list
  // above; kept as its own separate list rather than mixed into todos,
  // since groceries and general tasks don't belong together. The one thing
  // genuinely specific to a shopping list: a bulk "clear checked" for once
  // the shop's actually done. ---
  async function fetchShoppingItems(){
    if(!authToken){
      state.shoppingItems = [];
      renderShoppingItems();
      return;
    }
    try{
      const res = await fetch(apiBase() + '/api/shopping-items', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) return;
      state.shoppingItems = await res.json();
      renderShoppingItems();
    }catch(e){ /* non-critical */ }
  }

  function renderShoppingItems(){
    if(!shoppingList) return;
    const loggedOut = !authToken;
    if(shoppingLoggedOutHint) shoppingLoggedOutHint.classList.toggle('hidden', !loggedOut);
    if(shoppingAddForm) shoppingAddForm.classList.toggle('hidden', loggedOut);
    const items = state.shoppingItems || [];
    shoppingList.innerHTML = '';
    if(btnClearCheckedShopping) btnClearCheckedShopping.classList.toggle('hidden', loggedOut || !items.some(i => i.done));
    if(loggedOut) return;
    if(items.length === 0){
      shoppingList.innerHTML = '<li class="empty-state small muted">Nothing on the list yet.</li>';
      return;
    }
    items.forEach(i => {
      const li = document.createElement('li');
      li.className = 'todo-item' + (i.done ? ' is-done' : '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'todo-checkbox';
      checkbox.checked = !!i.done;
      checkbox.setAttribute('aria-label', `Mark "${i.text}" ${i.done ? 'not bought' : 'bought'}`);
      checkbox.addEventListener('change', ()=> toggleShoppingItem(i, checkbox.checked));
      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = i.text;
      const meta = document.createElement('span');
      meta.className = 'todo-meta small muted';
      meta.textContent = i.createdByName ? `added by ${i.createdByName}` : '';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'todo-delete-btn';
      delBtn.textContent = '🗑';
      delBtn.setAttribute('aria-label', `Remove "${i.text}"`);
      delBtn.addEventListener('click', ()=> deleteShoppingItem(i));
      li.appendChild(checkbox);
      li.appendChild(text);
      li.appendChild(meta);
      li.appendChild(delBtn);
      shoppingList.appendChild(li);
    });
  }

  async function addShoppingItem(text){
    if(!authToken) return false;
    try{
      const res = await fetch(apiBase() + '/api/shopping-items', { method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ text }) });
      if(!res.ok){
        const j = await res.json().catch(()=>null);
        showToast('Not saved', (j && j.error) || "That item didn't save -- check you're still logged in and try again.");
        return false;
      }
      await fetchShoppingItems();
      return true;
    }catch(e){
      showToast('Offline?', "Could not reach the server -- that item wasn't saved.");
      return false;
    }
  }

  async function toggleShoppingItem(i, done){
    if(!authToken) return;
    i.done = done; // optimistic
    renderShoppingItems();
    try{
      const res = await fetch(apiBase() + '/api/shopping-items/' + i.id, { method: 'PUT', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken }, body: JSON.stringify({ done }) });
      if(!res.ok) showToast('Not saved', "That change didn't save -- try again in a moment.");
      await fetchShoppingItems();
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  async function deleteShoppingItem(i){
    if(!authToken) return;
    try{
      const res = await fetch(apiBase() + '/api/shopping-items/' + i.id, { method: 'DELETE', headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok) showToast('Not removed', "That didn't delete -- try again in a moment.");
      await fetchShoppingItems();
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  if(shoppingAddForm){
    shoppingAddForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const text = shoppingInput.value.trim();
      if(!text) return;
      const submitBtn = shoppingAddForm.querySelector('button[type="submit"]');
      if(submitBtn) submitBtn.disabled = true;
      const saved = await addShoppingItem(text);
      if(submitBtn) submitBtn.disabled = false;
      if(saved) shoppingInput.value = '';
    });
  }

  if(btnClearCheckedShopping){
    btnClearCheckedShopping.addEventListener('click', async ()=>{
      if(!authToken) return;
      try{
        const res = await fetch(apiBase() + '/api/shopping-items/clear-checked', { method: 'POST', headers: { authorization: 'Bearer '+authToken } });
        if(!res.ok){ showToast('Not cleared', "Couldn't clear checked items -- try again in a moment."); return; }
        await fetchShoppingItems();
        showToast('Cleared', 'Checked items removed from the list.');
      }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
    });
  }

  // Pays out each tracker's daily XP trickle since it was last credited --
  // piggybacks on the regular sync cycle rather than its own timer, since
  // there's no way to earn it faster than that anyway (it's calendar days
  // elapsed, not actions taken). Must run before fetchUsersStatus() so its
  // payout is already reflected in the number that call brings back.
  async function syncTrackerXp(){
    const trackers = state.commitments.filter(c => isTrackerSchedule(c) && c.remoteId && (c.for === currentUser || c.for === 'both'));
    for(const c of trackers){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + c.remoteId + '/tracker-xp', { method: 'POST', headers: { authorization: 'Bearer '+authToken } });
        if(res.ok){
          const j = await res.json();
          if(j.xp !== undefined && j.xp !== null){
            state.usersXp = state.usersXp || {};
            state.usersXp[currentUser] = j.xp;
          }
        }
      }catch(e){ console.error('tracker xp sync failed', e); }
    }
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
      checkAllTrackerMilestones();
      await syncTrackerXp();
      save(state);
      renderList();
      fetchUsersStatus();
      fetchSuggestions();
      fetchPauseRequests();
      fetchWellbeingPrompt();
      fetchTodos();
      fetchShoppingItems();
    }catch(e){ console.error('sync failed', e); }
  }

  btnSync.addEventListener('click', async ()=>{
    if(!authToken) return alert('login first');
    await runSync();
    showToast('Synced', 'Up to date with the server.');
  });

  // No email/phone on file for either account, so there's no self-service
  // "forgot password" flow -- being logged in as either person is enough to
  // set a new password for either account, which is what actually recovers
  // a locked-out account (the target's OWN current password is never
  // needed, on purpose).
  if(btnResetPassword){
    btnResetPassword.addEventListener('click', async ()=>{
      if(!authToken) return alert('Login first.');
      const targetUser = resetPasswordUser.value;
      const newPassword = resetPasswordNew.value;
      if(!newPassword) return showToast('Enter a password', 'Type a new password first.');
      if(!confirm(`Set a new password for ${userName(targetUser)}? They'll need to log in again with it on their own phone.`)) return;
      try{
        const res = await fetch(apiBase() + '/api/reset-password', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer '+authToken }, body: JSON.stringify({ username: targetUser, newPassword }) });
        if(!res.ok){
          const j = await res.json().catch(()=>null);
          showToast('Not this time', (j && j.error) || 'Could not reset that password.');
          return;
        }
        resetPasswordNew.value = '';
        showToast('Password set', `${userName(targetUser)}'s password has been changed.`);
      }catch(e){
        showToast('Offline?', 'Could not reach the server.');
      }
    });
  }

  settingsBtn.addEventListener('click', ()=> settingsPanel.classList.remove('hidden'));
  settingsClose.addEventListener('click', ()=> settingsPanel.classList.add('hidden'));
  settingsPanel.addEventListener('click', e => { if(e.target === settingsPanel) settingsPanel.classList.add('hidden'); });


  function updateDebugToolsDisplay(){
    ensureLifeState();
    if(debugCurrentDate){
      const offset = state.debugDayOffset || 0;
      debugCurrentDate.textContent = appToday() + (offset ? ` (real date +${offset}d)` : ' (real date)');
    }
    if(debugLivesAnna) debugLivesAnna.value = state.lives.anna;
    if(debugLivesJordan) debugLivesJordan.value = state.lives.jordan;
    // Only your own lives are actually settable from here -- the other
    // field is read-only display, since a change here can never reach the
    // other person's phone anyway (lives aren't synced).
    if(debugLivesAnna) debugLivesAnna.readOnly = currentUser !== 'anna';
    if(debugLivesJordan) debugLivesJordan.readOnly = currentUser !== 'jordan';
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

  // Jumping the date forward is a client-only illusion (nothing about it
  // reaches the server), so in remote mode it still previews streaks and
  // schedule display correctly, but lives won't move -- those are evaluated
  // server-side now against the real date (see server/lives.js).
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
    btnDebugRunCheck.addEventListener('click', async ()=>{
      if(isRemoteMode()){
        // Lives are evaluated server-side on a timer (plus on-demand inside
        // GET /api/users) now -- this just forces a fresh fetch rather than
        // re-running any evaluation locally.
        await fetchUsersStatus();
      } else {
        updateLivesForUser('anna');
        updateLivesForUser('jordan');
      }
      renderList();
      toggleDebugPanel(true);
    });
  }

  if(btnDebugSetLives){
    btnDebugSetLives.addEventListener('click', async ()=>{
      ensureLifeState();
      // Only ever writes currentUser's own lives -- see updateDebugToolsDisplay
      // for why the other field is read-only.
      const ownInput = currentUser === 'anna' ? debugLivesAnna : debugLivesJordan;
      const val = parseInt(ownInput.value, 10);
      if(Number.isNaN(val)){ toggleDebugPanel(true); return; }
      const clamped = Math.min(MAX_LIVES, Math.max(0, val));
      if(isRemoteMode()){
        try{
          await fetch(apiBase() + '/api/lives/set', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer '+authToken }, body: JSON.stringify({ lives: clamped }) });
        }catch(e){ showToast('Offline?', 'Could not reach the server.'); return; }
      }
      state.lives[currentUser] = clamped;
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
    commitSchedule.value = 'daily';
    customDays.style.display = 'none';
    document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input=>input.checked=false);
    if(commitDeadlineRow) commitDeadlineRow.style.display = 'none';
    if(commitDeadlineDate){ commitDeadlineDate.value = ''; commitDeadlineDate.min = appToday(); }
    commitLabel.value = '';
    commitTarget.value = '';
    commitJoint.checked = false;
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

  // The "+" button now opens the guided wizard (below) rather than this
  // form directly -- this modal is reached only via Edit from now on.
  addClose.addEventListener('click', ()=>{ addModal.classList.add('hidden'); clearAddForm(); });
  addModal.addEventListener('click', e => { if(e.target === addModal){ addModal.classList.add('hidden'); clearAddForm(); } });

  // --- Guided Add Commitment wizard: label first (per Jordan's request),
  // then name, then schedule, then joint/start-date as a final step, one
  // question per screen instead of one dense form. ---
  let wizardStep = 1;
  const WIZARD_TOTAL_STEPS = 4;
  const wizardSteps = [wizStep1, wizStep2, wizStep3, wizStep4];

  function wizardCustomDaysSelected(){
    return Array.from(wizCustomDays.querySelectorAll('input[name="wizDay"]:checked')).map(i=>i.value);
  }

  function wizardUpdateSummary(){
    const selectedTile = wizLabelGrid.querySelector('.label-tile.selected');
    const label = selectedTile ? selectedTile.dataset.label : '';
    const text = wizText.value.trim() || '(untitled)';
    const scheduleDesc = getScheduleDescription({ schedule: wizSchedule.value, scheduleDays: wizardCustomDaysSelected(), deadlineDate: wizDeadlineDate.value || null });
    wizSummary.innerHTML = `
      <p class="card-name">${escapeHtml(text)}</p>
      <p class="small muted">${label ? (LABEL_ICONS[label] || '') + ' ' + escapeHtml(label) + ' · ' : ''}${scheduleDesc}</p>
    `;
  }

  function wizardShowStep(n){
    wizardStep = n;
    wizardSteps.forEach((el, i) => el.classList.toggle('hidden', i !== n - 1));
    wizProgress.textContent = `Step ${n} of ${WIZARD_TOTAL_STEPS}`;
    wizBack.style.visibility = n === 1 ? 'hidden' : 'visible';
    wizNext.textContent = n === WIZARD_TOTAL_STEPS ? 'Add Commitment' : 'Next';
    if(n === WIZARD_TOTAL_STEPS) wizardUpdateSummary();
    if(n === 2) wizText.focus();
  }

  function wizardReset(){
    wizText.value = '';
    wizSchedule.value = 'daily';
    wizCustomDays.style.display = 'none';
    wizCustomDays.querySelectorAll('input[name="wizDay"]').forEach(i => i.checked = false);
    if(wizDeadlineRow) wizDeadlineRow.style.display = 'none';
    if(wizDeadlineDate){ wizDeadlineDate.value = ''; wizDeadlineDate.min = appToday(); }
    if(wizTrackerHint) wizTrackerHint.classList.add('hidden');
    wizLabelGrid.querySelectorAll('.label-tile').forEach(t => t.classList.remove('selected'));
    wizJoint.checked = false;
    wizStartDate.value = '';
    wizStartDate.min = appToday();
    wizardShowStep(1);
  }

  wizLabelGrid.querySelectorAll('.label-tile').forEach(tile => {
    tile.addEventListener('click', ()=>{
      wizLabelGrid.querySelectorAll('.label-tile').forEach(t => t.classList.remove('selected'));
      tile.classList.add('selected');
      wizardShowStep(2);
    });
  });

  wizSchedule.addEventListener('change', ()=>{
    wizCustomDays.style.display = wizSchedule.value === 'custom' ? 'block' : 'none';
    if(wizDeadlineRow) wizDeadlineRow.style.display = wizSchedule.value === 'deadline' ? 'block' : 'none';
    if(wizTrackerHint) wizTrackerHint.classList.toggle('hidden', wizSchedule.value !== 'tracker');
  });

  wizBack.addEventListener('click', ()=>{
    if(wizardStep > 1) wizardShowStep(wizardStep - 1);
  });

  function wizardSubmit(){
    const text = wizText.value.trim();
    if(!text) return;
    const selectedTile = wizLabelGrid.querySelector('.label-tile.selected');
    const label = selectedTile ? (selectedTile.dataset.label || null) : null;
    const forUser = wizJoint.checked ? 'both' : currentUser;
    const schedule = wizSchedule.value || 'daily';
    let scheduleDays = null;
    if(schedule === 'custom'){
      scheduleDays = wizardCustomDaysSelected();
      if(scheduleDays.length === 0){ alert('Select at least one day for a custom schedule'); wizardShowStep(3); return; }
    }
    let deadlineDate = null;
    if(schedule === 'deadline'){
      deadlineDate = wizDeadlineDate.value || null;
      if(!deadlineDate){ alert('Pick a deadline date.'); wizardShowStep(3); return; }
    }
    const startDate = wizStartDate.value || null;
    const weeklyTarget = schedule === 'once' ? 1 : (schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null)));
    const lastLoggedAt = schedule === 'tracker' ? new Date().toISOString() : null;

    const commitItem = {
      id: uid(), text, for: forUser, enabled: true, doneToday: false, schedule, scheduleDays,
      deadlineDate, lastLoggedAt, streak: 0, lastDone: null, remoteId: null, history: [], label, target: null,
      reminderEnabled: false, reminderTime: null, paws: 0, comments: [], weeklyTarget,
      createdAt: startDate || appToday()
    };
    state.commitments.push(commitItem);
    scheduleReminderFor(commitItem);
    save(state);
    renderList();
    wizardModal.classList.add('hidden');
    wizardReset();
    if(commitItem.for === currentUser || commitItem.for === 'both') pushCommitmentToServer(commitItem);
  }

  wizNext.addEventListener('click', ()=>{
    if(wizardStep === 2 && !wizText.value.trim()){ alert('Give it a name first.'); return; }
    if(wizardStep === 3 && wizSchedule.value === 'custom' && wizardCustomDaysSelected().length === 0){
      alert('Select at least one day for a custom schedule.');
      return;
    }
    if(wizardStep === 3 && wizSchedule.value === 'deadline' && !wizDeadlineDate.value){
      alert('Pick a deadline date.');
      return;
    }
    if(wizardStep < WIZARD_TOTAL_STEPS) wizardShowStep(wizardStep + 1);
    else wizardSubmit();
  });

  addButton.addEventListener('click', ()=>{ wizardReset(); wizardModal.classList.remove('hidden'); });
  wizClose.addEventListener('click', ()=>{ wizardModal.classList.add('hidden'); wizardReset(); });
  wizardModal.addEventListener('click', e => { if(e.target === wizardModal){ wizardModal.classList.add('hidden'); wizardReset(); } });

  // --- Suggestions: propose a commitment for your partner, who can accept
  // it as-is, tweak it first ("amend"), or reject it. ---
  let suggestModalMode = 'compose';
  let amendingSuggestionId = null;

  function clearSuggestForm(){
    suggestText.value = '';
    suggestSchedule.value = 'daily';
    suggestCustomDays.style.display = 'none';
    document.querySelectorAll('#suggestCustomDays input[name="suggestDay"]').forEach(i=>i.checked=false);
    suggestLabel.value = '';
  }

  suggestSchedule.addEventListener('change', ()=>{
    suggestCustomDays.style.display = suggestSchedule.value === 'custom' ? 'block' : 'none';
  });

  btnSuggest.addEventListener('click', ()=>{
    if(!authToken) return alert('Login first to suggest a commitment.');
    suggestModalMode = 'compose';
    amendingSuggestionId = null;
    clearSuggestForm();
    suggestModalTitle.textContent = 'Suggest a Commitment';
    suggestModalHint.textContent = "Propose something for your partner — they can accept, tweak it, or say no thanks.";
    suggestSubmitBtn.textContent = 'Send Suggestion';
    settingsPanel.classList.add('hidden');
    suggestModal.classList.remove('hidden');
  });

  suggestClose.addEventListener('click', ()=>{ suggestModal.classList.add('hidden'); clearSuggestForm(); });
  suggestModal.addEventListener('click', e => { if(e.target === suggestModal){ suggestModal.classList.add('hidden'); clearSuggestForm(); } });

  function addAcceptedSuggestionLocally(commit){
    state.commitments.push({
      id: 'r'+commit.id, remoteId: commit.id, for: currentUser, text: commit.text,
      enabled: commit.enabled, doneToday: commit.doneToday, schedule: commit.schedule,
      scheduleDays: commit.scheduleDays, weeklyTarget: commit.weeklyTarget, streak: commit.streak||0,
      lastDone: commit.lastDone, label: commit.label, target: null, history: [], paws:0, comments: [],
      createdAt: commit.createdAt, pawLog: []
    });
    save(state);
    renderList();
  }

  suggestForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!authToken) return;
    const text = suggestText.value.trim();
    if(!text) return;
    const schedule = suggestSchedule.value || 'daily';
    let scheduleDays = null;
    if(schedule === 'custom'){
      scheduleDays = Array.from(document.querySelectorAll('#suggestCustomDays input[name="suggestDay"]:checked')).map(i=>i.value);
      if(scheduleDays.length === 0){ alert('Select at least one day for a custom schedule'); return; }
    }
    const label = suggestLabel.value || null;
    try{
      if(suggestModalMode === 'amend' && amendingSuggestionId){
        const res = await fetch(apiBase() + '/api/suggestions/' + amendingSuggestionId + '/accept', {
          method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken },
          body: JSON.stringify({ text, schedule, scheduleDays, label })
        });
        if(res.ok){
          const commit = await res.json();
          addAcceptedSuggestionLocally(commit);
          state.suggestions = (state.suggestions||[]).filter(s=>s.id!==amendingSuggestionId);
          save(state);
          renderSuggestions();
          showToast('Accepted', `"${commit.text}" added to your commitments.`);
        } else {
          showToast('Something went wrong', 'Could not save your changes.');
        }
      } else {
        const res = await fetch(apiBase() + '/api/suggestions', {
          method: 'POST', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken },
          body: JSON.stringify({ text, schedule, scheduleDays, label })
        });
        showToast(res.ok ? 'Sent' : 'Something went wrong', res.ok ? 'Your suggestion is on its way.' : 'Could not send your suggestion.');
      }
    }catch(e){
      showToast('Offline?', 'Could not reach the server.');
    }
    suggestModal.classList.add('hidden');
    clearSuggestForm();
  });

  function renderSuggestions(){
    const list = state.suggestions || [];
    suggestionsList.innerHTML = '';
    suggestionsSection.classList.toggle('hidden', list.length === 0);
    list.forEach(s => {
      const card = document.createElement('div'); card.className = 'suggestion-card';
      const scheduleDesc = getScheduleDescription({ schedule: s.schedule, scheduleDays: s.scheduleDays });
      const labelBit = s.label ? ` · ${LABEL_ICONS[s.label] || ''} ${escapeHtml(s.label)}` : '';
      card.innerHTML = `
        <p class="suggestion-from">From ${escapeHtml(s.fromName)}</p>
        <p class="suggestion-text">${escapeHtml(s.text)}</p>
        <p class="suggestion-meta">${scheduleDesc}${labelBit}</p>
      `;
      const actions = document.createElement('div'); actions.className = 'suggestion-actions';
      const acceptBtn = document.createElement('button'); acceptBtn.type='button'; acceptBtn.className='primary'; acceptBtn.textContent='✅ Accept';
      acceptBtn.addEventListener('click', ()=> acceptSuggestion(s));
      const amendBtn = document.createElement('button'); amendBtn.type='button'; amendBtn.textContent='✏️ Amend & Accept';
      amendBtn.addEventListener('click', ()=> openAmendSuggestion(s));
      const rejectBtn = document.createElement('button'); rejectBtn.type='button'; rejectBtn.className='danger'; rejectBtn.textContent='✕ Reject';
      rejectBtn.addEventListener('click', ()=> rejectSuggestion(s));
      actions.appendChild(acceptBtn); actions.appendChild(amendBtn); actions.appendChild(rejectBtn);
      card.appendChild(actions);
      suggestionsList.appendChild(card);
    });
  }

  async function acceptSuggestion(s){
    if(!authToken) return;
    try{
      const res = await fetch(apiBase() + '/api/suggestions/' + s.id + '/accept', { method:'POST', headers: { authorization: 'Bearer '+authToken } });
      if(res.ok){
        const commit = await res.json();
        addAcceptedSuggestionLocally(commit);
        state.suggestions = (state.suggestions||[]).filter(x=>x.id!==s.id);
        save(state);
        renderSuggestions();
        showToast('Accepted', `"${commit.text}" added to your commitments.`);
      }
    }catch(e){ showToast('Offline?', 'Could not reach the server.'); }
  }

  function openAmendSuggestion(s){
    suggestModalMode = 'amend';
    amendingSuggestionId = s.id;
    suggestText.value = s.text;
    suggestSchedule.value = s.schedule || 'daily';
    if(s.schedule === 'custom' && Array.isArray(s.scheduleDays)){
      suggestCustomDays.style.display = 'block';
      document.querySelectorAll('#suggestCustomDays input[name="suggestDay"]').forEach(i=>{ i.checked = s.scheduleDays.includes(i.value); });
    } else {
      suggestCustomDays.style.display = 'none';
    }
    suggestLabel.value = s.label || '';
    suggestModalTitle.textContent = 'Amend & Accept';
    suggestModalHint.textContent = 'Tweak the details, then accept it into your own commitments.';
    suggestSubmitBtn.textContent = 'Save & Accept';
    suggestModal.classList.remove('hidden');
  }

  async function rejectSuggestion(s){
    if(!authToken) return;
    try{
      await fetch(apiBase() + '/api/suggestions/' + s.id + '/reject', { method:'POST', headers: { authorization: 'Bearer '+authToken } });
    }catch(e){ /* still drop it locally below */ }
    state.suggestions = (state.suggestions||[]).filter(x=>x.id!==s.id);
    save(state);
    renderSuggestions();
  }

  // --- Weekly leaderboard ---
  btnLeaderboard.addEventListener('click', async ()=>{
    if(!authToken) return alert('Login first to see the leaderboard.');
    settingsPanel.classList.add('hidden');
    leaderboardBody.innerHTML = '<p class="small muted">Loading…</p>';
    leaderboardModal.classList.remove('hidden');
    try{
      const res = await fetch(apiBase() + '/api/leaderboard/weekly', { headers: { authorization: 'Bearer '+authToken } });
      if(!res.ok){ leaderboardBody.innerHTML = '<p class="small muted">Could not load the leaderboard.</p>'; return; }
      renderLeaderboard(await res.json());
    }catch(e){
      leaderboardBody.innerHTML = '<p class="small muted">Could not reach the server.</p>';
    }
  });
  leaderboardClose.addEventListener('click', ()=> leaderboardModal.classList.add('hidden'));
  leaderboardModal.addEventListener('click', e => { if(e.target === leaderboardModal) leaderboardModal.classList.add('hidden'); });

  detailClose.addEventListener('click', ()=> detailModal.classList.add('hidden'));
  detailModal.addEventListener('click', e => { if(e.target === detailModal) detailModal.classList.add('hidden'); });

  // --- Reset my progress: for trying the app out and wanting a clean
  // slate. Wipes server-side streak/history/XP/lives for the caller's own
  // commitments, then mirrors lives locally for instant feedback -- the
  // full picture (including the other person's view, if this affected
  // anything of theirs) settles in via the runSync() below. ---
  if(btnResetProgress){
    btnResetProgress.addEventListener('click', async ()=>{
      if(!authToken) return alert('Login first.');
      if(!confirm(`Reset ${userName(currentUser)}'s progress? This sets lives back to 9/9 and streaks/XP back to zero. Commitments stay, but this can't be undone. Limited to once every 30 days.`)) return;
      try{
        const res = await fetch(apiBase() + '/api/me/reset', { method:'POST', headers:{ authorization:'Bearer '+authToken } });
        if(!res.ok){
          const j = await res.json().catch(()=>null);
          showToast('Not this time', (j && j.error) || 'Could not reset your progress.');
          return;
        }
      }catch(e){
        showToast('Offline?', 'Could not reach the server.');
        return;
      }

      ensureLifeState();
      state.commitments.forEach(c => {
        if(c.for === currentUser){
          c.history = [];
          c.streak = 0;
          c.doneToday = false;
          c.lastDone = null;
          c.achieved = false;
          c.achievedAt = null;
        }
      });
      state.lives[currentUser] = MAX_LIVES;
      state.usersXp = state.usersXp || {};
      state.usersXp[currentUser] = 0;
      save(state);
      renderList();
      toggleDebugPanel(false);
      showToast('Reset complete', `${userName(currentUser)} is back to 9/9 lives and 0 XP.`);
      runSync();
    });
  }

  // --- Start fresh: a genuine joint wipe, not scoped to just the caller --
  // deletes every commitment for BOTH people server-side and resets both
  // people's lives/XP to 9/9 and 0 there too. Lives are server-authoritative
  // now, so the OTHER person's device picks this up automatically on their
  // next sync -- no separate manual step needed on their end anymore. ---
  if(btnStartFresh){
    btnStartFresh.addEventListener('click', async ()=>{
      if(!authToken) return alert('Login first.');
      if(!confirm('Delete every habit for both of you and start fresh? This removes all commitments, history, comments, and paws, and sets lives back to 9/9 for both people. To-dos and the shopping list are untouched. This cannot be undone.')) return;
      try{
        const res = await fetch(apiBase() + '/api/reset-everything', { method:'POST', headers:{ authorization:'Bearer '+authToken } });
        if(!res.ok){
          const j = await res.json().catch(()=>null);
          showToast('Not this time', (j && j.error) || 'Could not reset.');
          return;
        }
      }catch(e){
        showToast('Offline?', 'Could not reach the server.');
        return;
      }

      ensureLifeState();
      state.commitments = [];
      state.lives = { anna: MAX_LIVES, jordan: MAX_LIVES };
      state.usersXp = { anna: 0, jordan: 0 };
      save(state);
      renderList();
      toggleDebugPanel(false);
      showToast('Fresh start', 'All habits are gone and lives are back to 9/9 for both of you.');
      runSync();
    });
  }

  function renderLeaderboard(data){
    const users = data.users || {};
    const names = Object.keys(users);
    let html = names.map(name => {
      const u = users[name];
      const pctNum = u.rate === null ? 0 : Math.round(u.rate*100);
      const pctLabel = u.rate === null ? '—' : pctNum + '%';
      return `
        <div class="leaderboard-row">
          <div class="leaderboard-row-head">
            <span class="leaderboard-name">${escapeHtml(userName(name))}</span>
            <span class="leaderboard-rate">${u.completed}/${u.scheduled} · ${pctLabel}</span>
          </div>
          <div class="leaderboard-bar"><div class="leaderboard-fill${u.hitTarget ? ' is-hit' : ''}" style="width:${Math.min(100,pctNum)}%"></div></div>
        </div>`;
    }).join('');
    const bothHit = names.length === 2 && names.every(n => users[n].hitTarget);
    const soloWinners = names.filter(n => users[n].hitTarget && !bothHit);
    let banner = '';
    if(bothHit) banner = '🎉 You both hit 100% this week — go pick a treat!';
    else if(soloWinners.length) banner = soloWinners.map(n => `${userName(n)} hit their target this week — they get to pick your next couple activity!`).join(' ');
    leaderboardBody.innerHTML = html + (banner ? `<div class="leaderboard-banner">${escapeHtml(banner)}</div>` : '');
  }

  // show logout button if token exists
  if(authToken) btnLogout.style.display='inline';

  // History modal elements
  const histModal = document.getElementById('historyModal');
  const histClose = document.getElementById('histClose');
  const histTitle = document.getElementById('histTitle');
  const histHeatmap = document.getElementById('histHeatmap');
  histClose.addEventListener('click', ()=>{ histModal.style.display='none'; histHeatmap.innerHTML=''; });

  // Marks (or unmarks) one specific PAST date as done -- for backfilling a
  // day you genuinely did but forgot to log at the time. Deliberately
  // separate from toggleCommitDone(), which always operates on "today".
  // Refunds a life via reevaluatePastDay() if that day (or its week, for a
  // weekly-target schedule) had already cost one and is now fully compliant
  // -- local-mode only; in remote mode the server's PUT .../history/:date
  // handler does this refund itself (see reevaluatePastDayForUser in
  // server/lives.js), and fetchUsersStatus() below picks up the result.
  async function toggleHistoryDate(commit, dayIso, markDone){
    if(!canEditCommit(commit)){
      showToast('Not yours to edit', `Only ${userName(commit.for)} can edit "${commit.text}"'s history.`);
      return;
    }
    commit.history = commit.history || [];
    const idx = commit.history.indexOf(dayIso);
    if(markDone && idx < 0) commit.history.push(dayIso);
    else if(!markDone && idx >= 0) commit.history.splice(idx, 1);
    else return; // already in the requested state
    updateCommitStatusFromHistory(commit);
    if(markDone && !isRemoteMode()) reevaluatePastDay(commit.for, dayIso);
    save(state);
    renderList();
    showToast(markDone ? 'Marked done' : 'Marked undone', `Updated ${dayIso} for "${commit.text}".`);
    if(isRemoteMode() && commit.remoteId){
      try{
        const res = await fetch(apiBase() + '/api/commitments/' + commit.remoteId + '/history/' + dayIso, {
          method: 'PUT', headers: { 'content-type':'application/json', authorization: 'Bearer '+authToken },
          body: JSON.stringify({ done: markDone })
        });
        if(res.ok){
          const j = await res.json();
          if(j.streak !== undefined) commit.streak = j.streak;
          if(j.xp !== undefined && j.xp !== null){
            state.usersXp = state.usersXp || {};
            state.usersXp[currentUser] = j.xp;
            renderLevels();
          }
          save(state);
          if(markDone) fetchUsersStatus();
        }
      }catch(e){ console.error('backfill push failed', e); }
    }
  }

  function renderHeatmap(entries, days, commit, onChange){
    // entries: array of YYYY-MM-DD strings OR objects {date, count}
    // Clamp the window to the commitment's own lifetime: showing days from
    // before it existed (or, for a deadline, after its due date) is just
    // noise -- the history should only cover days the commitment was
    // actually live. Lower bound = createdAt; upper bound = min(today,
    // deadline) for a one-off deadline, otherwise today.
    const today = appToday();
    let windowEnd = today;
    if(isDeadlineSchedule(commit) && commit.deadlineDate && commit.deadlineDate < today){
      windowEnd = commit.deadlineDate;
    }
    let all = getWindowDates(windowEnd, days || 7);
    if(commit && commit.createdAt){
      all = all.filter(d => d >= commit.createdAt);
    }
    histHeatmap.innerHTML = '';
    if(all.length === 0){
      const empty = document.createElement('p');
      empty.className = 'small muted';
      empty.textContent = 'No days to show yet in this range.';
      histHeatmap.appendChild(empty);
      return;
    }
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
    // Backfilling only makes sense for a strictly past day (today has its
    // own dedicated mark-done button in detail view) on a schedule where
    // "done" is a simple yes/no per day -- not for trackers, whose history
    // means something inverted (logged = bad), and whose XP/life stakes are
    // only ever charged live via /log.
    const canBackfill = commit && canEditCommit(commit) && !isTrackerSchedule(commit);
    let lastMonth = null;
    all.forEach(day => {
      const dateObj = parseLocalDate(day);
      const el = document.createElement('div'); el.className='hist-day';
      const count = map.get(day) || 0;
      let level = 0;
      if(count>0){
        if(maxCount <= 1) level = 1; else level = Math.ceil((count / maxCount) * 3);
      }
      el.classList.add('level-' + level);
      if(count > 0) el.classList.add('is-done');
      if(day === today) el.classList.add('is-today');

      // Date labels -- weekday on top, day-of-month as the main figure, and
      // the month abbreviation whenever it changes (or on the first cell) so
      // a window spanning two months stays readable.
      const dow = document.createElement('span'); dow.className = 'hist-day-dow';
      dow.textContent = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      const num = document.createElement('span'); num.className = 'hist-day-num';
      num.textContent = String(dateObj.getDate());
      const mon = document.createElement('span'); mon.className = 'hist-day-mon';
      const thisMonth = dateObj.getMonth();
      mon.textContent = (thisMonth !== lastMonth) ? dateObj.toLocaleDateString('en-US', { month: 'short' }) : '';
      lastMonth = thisMonth;
      el.appendChild(dow); el.appendChild(num); el.appendChild(mon);

      const isPast = day < today;
      if(canBackfill && isPast){
        el.classList.add('is-editable');
        el.title = day + (count? ' — done (tap to unmark)' : ' — tap to mark done');
        el.setAttribute('role', 'button');
        el.setAttribute('tabindex', '0');
        const toggle = async ()=>{
          await toggleHistoryDate(commit, day, count === 0);
          if(onChange) onChange();
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
      } else {
        el.title = day + (count? ` — done x${count}` : '');
      }
      histHeatmap.appendChild(el);
    });
  }

  async function showHistory(commit){
    histModal.style.display='flex';
    histTitle.textContent = commit.text + ' — history';
    const zoomSelect = document.getElementById('histZoom');
    const canBackfill = canEditCommit(commit) && !isTrackerSchedule(commit);
    const hint = document.getElementById('histBackfillHint');
    if(hint) hint.classList.toggle('hidden', !canBackfill);
    function renderForZoom(){
      const days = parseInt(zoomSelect.value,10) || 7;
      // prefer remote history if available
      if(authToken && commit.remoteId){
        fetch(apiBase() + '/api/commitments/' + commit.remoteId + '/history', { headers: { 'authorization': 'Bearer '+authToken } }).then(r=>r.ok? r.json() : Promise.resolve(null)).then(dates=>{
          if(dates) renderHeatmap(dates, days, commit, renderForZoom); else renderHeatmap(commit.history||[], days, commit, renderForZoom);
        }).catch(()=>{ renderHeatmap(commit.history||[], days, commit, renderForZoom); });
      } else {
        renderHeatmap(commit.history||[], days, commit, renderForZoom);
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
    const forUser = commitJoint && commitJoint.checked ? 'both' : commitFor.value;
    const enabled = commitEnabled.checked;
    const schedule = (typeof commitSchedule !== 'undefined' && commitSchedule.value) ? commitSchedule.value : 'daily';
    let scheduleDays = null;
    if(schedule === 'custom'){
      scheduleDays = Array.from(document.querySelectorAll('#customDays input[name="commitDay"]:checked')).map(i=>i.value);
      if(scheduleDays.length === 0){ alert('Select at least one day for a custom schedule'); return; }
    }
    let deadlineDate = null;
    if(schedule === 'deadline'){
      deadlineDate = commitDeadlineDate && commitDeadlineDate.value ? commitDeadlineDate.value : null;
      if(!deadlineDate){ alert('Pick a deadline date.'); return; }
    }
    const label = commitLabel ? (commitLabel.value.trim() || null) : null;
    const target = commitTarget ? (commitTarget.value ? parseInt(commitTarget.value,10) : null) : null;
    const startDate = commitStartDate && commitStartDate.value ? commitStartDate.value : null;
    const reminderEnabled = commitReminderEnabled ? !!commitReminderEnabled.checked : false;
    const reminderTime = commitReminderTime ? (commitReminderTime.value || null) : null;
    const weeklyTarget = schedule === 'once' ? 1 : (schedule === 'twice' ? 2 : (schedule === 'three' ? 3 : (schedule === 'four' ? 4 : null)));

    let commitItem;
    if(editingCommitId){
      commitItem = state.commitments.find(c=>c.id===editingCommitId);
      if(commitItem){
        commitItem.text = text;
        commitItem.for = forUser;
        commitItem.enabled = enabled;
        commitItem.schedule = schedule;
        commitItem.scheduleDays = scheduleDays;
        commitItem.deadlineDate = deadlineDate;
        // Only stamp a starting point the first time a commitment becomes a
        // tracker -- editing its text/label afterward shouldn't reset the
        // clock it's already been running.
        if(schedule === 'tracker' && !commitItem.lastLoggedAt) commitItem.lastLoggedAt = new Date().toISOString();
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
      const lastLoggedAt = schedule === 'tracker' ? new Date().toISOString() : null;
      commitItem = { id: uid(), text, for: forUser, enabled, doneToday:false, schedule, scheduleDays, deadlineDate, lastLoggedAt, streak:0, lastDone:null, remoteId:null, history: [], label, target, reminderEnabled, reminderTime, paws:0, comments: [], weeklyTarget, createdAt: startDate || appToday() };
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
    if(commitJoint) commitJoint.checked = false;
    document.querySelectorAll('#customDays input[name="commitDay"]').forEach(input=>input.checked=false);
    addModal.classList.add('hidden');
    renderList();
    if(commitItem && (commitItem.for === currentUser || commitItem.for === 'both')) pushCommitmentToServer(commitItem);
  });

  // Initial render
  renderUsers();
  renderList();
  // schedule reminders for current user
  scheduleAllReminders();

  // Register the service worker unconditionally so the app shell is cached
  // and works offline once loaded -- previously this only happened as a side
  // effect of enabling notifications, so most sessions never got it at all.
  //
  // iOS in particular checks for service-worker updates on a home-screen-
  // installed app far less reliably than a regular Safari tab -- a session
  // can sit on a stale, possibly-broken cached app.js indefinitely, looking
  // exactly like broken buttons, until it happens to update on its own.
  // Nudge a check every time the app comes back to the foreground, and
  // reload once a fresh version actually takes over so it's picked up
  // immediately rather than needing a manual force-quit.
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').then(reg => {
      const checkForUpdate = () => reg.update().catch(()=>{});
      document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible') checkForUpdate(); });
    }).catch(e => console.error('service worker registration failed', e));

    let refreshedOnce = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if(refreshedOnce) return;
      refreshedOnce = true;
      location.reload();
    });
  }

  // Expose for debugging
  window._accountability = { state, save };
})();
