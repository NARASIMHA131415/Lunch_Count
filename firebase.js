const baseRolls = [];
  for (let i = 1; i <= 52; i++) baseRolls.push('23471A61' + String(i).padStart(2, '0'));
  for (let i = 1; i <= 8; i++) baseRolls.push('24475A61' + String(i).padStart(2, '0'));

  // Shared app data is loaded only from Realtime Database; do not restore it from browser storage.
  let state = {};
  let payState = {};
  let fixedState = {};
  let customRolls = [];
  let removedRolls = [];
  let amountPerPerson = 0;
  let currentFilter = 'all';
  let searchQuery = '';

  const grid = document.getElementById('grid');
  const amountInput = document.getElementById('amountInput');
  amountInput.value = amountPerPerson || '';

  function getActiveRolls(){
    const base = baseRolls.filter(r => !removedRolls.includes(r));
    const custom = customRolls.filter(r => !removedRolls.includes(r));
    return [...base, ...custom];
  }
  function saveState(){ pushToFirebase(); }
  function savePayState(){ pushToFirebase(); }
  function saveFixedState(){ pushToFirebase(); }
  function saveCustom(){ pushToFirebase(); }
  function saveRemoved(){ pushToFirebase(); }
  function requireLiveConnection(){
    if (isFirebaseConnected && fbDocRef) return true;
    alert('Not connected to Firebase Realtime Database. Enter the database URL in Firebase Setup and wait for the green Connected status before making changes. Nothing was saved.');
    return false;
  }

  /* ===== FIREBASE SYNC ===== */
  // 🔥 Embedded Firebase config (aiml-58d47) — file works out of the box, no manual setup needed on each device
  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD0jH-ya_lE2Y8ASUvJlUcpyPVdL6nHQnk",
    authDomain: "aiml-58d47.firebaseapp.com",
    projectId: "aiml-58d47",
    storageBucket: "aiml-58d47.firebasestorage.app",
    messagingSenderId: "1028164423927",
      appId: "1:1028164423927:web:fc4d3d0a738cabd89a43f2",
    measurementId: "G-TBQBH5X4YV",
    databaseURL: ""
  };
  const DEFAULT_ROOM = "AIML-LUNCH-2026"; // Same room for everyone → change this in one place if you want a private code

  let fbApp = null, fbDb = null, fbDocRef = null, fbUnsubscribe = null;
  let isFirebaseConnected = false, isApplyingRemote = false;
  let fbSaveTimer = null;

  function getSavedFirebaseConfig(){
    try {
      const saved = JSON.parse(localStorage.getItem('firebase_config') || 'null');
      if (saved && saved.apiKey) return saved;
    } catch(e){}
    return DEFAULT_FIREBASE_CONFIG;
  }
  function getSavedRoom(){
    return localStorage.getItem('firebase_room') || DEFAULT_ROOM || '';
  }

  function updateSyncUI(){
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    const pill = document.getElementById('roomPill');
    const warn = document.getElementById('localWarn');
    const room = getSavedRoom();
    pill.textContent = 'Room: ' + (room || '—');
    if (isFirebaseConnected){
      dot.classList.add('online');
      txt.textContent = '🟢 Connected — Live Sync ON (Room: ' + room + ')';
      if (warn) warn.style.display = 'none';
    } else {
      dot.classList.remove('online');
      txt.textContent = '🔴 Local Only — Firebase not connected';
      if (warn) warn.style.display = 'block';
    }
  }

  function toggleFirebasePanel(){
    const p = document.getElementById('firebasePanel');
    p.classList.toggle('open');
    if (p.classList.contains('open')){
      const cfg = getSavedFirebaseConfig() || {};
      document.getElementById('fb_apiKey').value = cfg.apiKey || '';
      document.getElementById('fb_authDomain').value = cfg.authDomain || '';
      document.getElementById('fb_projectId').value = cfg.projectId || '';
      document.getElementById('fb_storageBucket').value = cfg.storageBucket || '';
      document.getElementById('fb_messagingSenderId').value = cfg.messagingSenderId || '';
      document.getElementById('fb_appId').value = cfg.appId || '';
      document.getElementById('fb_databaseURL').value = cfg.databaseURL || '';
      document.getElementById('fb_room').value = getSavedRoom() || '';
    }
  }

  function saveFirebaseConfig(){
    const cfg = {
      apiKey: document.getElementById('fb_apiKey').value.trim(),
      authDomain: document.getElementById('fb_authDomain').value.trim(),
      projectId: document.getElementById('fb_projectId').value.trim(),
      storageBucket: document.getElementById('fb_storageBucket').value.trim(),
      messagingSenderId: document.getElementById('fb_messagingSenderId').value.trim(),
      appId: document.getElementById('fb_appId').value.trim(),
      databaseURL: document.getElementById('fb_databaseURL').value.trim().replace(/\/$/, '')
    };
    const room = document.getElementById('fb_room').value.trim().toUpperCase().replace(/\s+/g,'-');
    if (!cfg.apiKey || !cfg.projectId || !cfg.appId){ alert('Firebase app config is incomplete'); return; }
    if (!cfg.databaseURL || !/^https:\/\//i.test(cfg.databaseURL)){ alert('Paste the exact Realtime Database URL from Firebase Console'); return; }
    if (!room){ alert('Please enter a Room Code (e.g. AIML-LUNCH-2026) — same for all devices'); return; }
    localStorage.setItem('firebase_config', JSON.stringify(cfg));
    localStorage.setItem('firebase_room', room);
    initFirebase(true);
  }

  function disconnectFirebase(){
    if (fbUnsubscribe) fbUnsubscribe();
    isFirebaseConnected = false; fbDb = null; fbDocRef = null;
    updateSyncUI();
    alert('Disconnected. Now in Local Only mode.');
  }

  function initFirebase(fromUser){
    const cfg = getSavedFirebaseConfig();
    const room = getSavedRoom();
    if (!cfg || !room || !cfg.databaseURL){
      updateSyncUI();
      if (fromUser) alert('Paste the Realtime Database URL from Firebase Console, then Save & Connect.');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.database){
      updateSyncUI();
      if (fromUser) alert('❌ Firebase Database SDK failed to load. Check internet and reload.');
      return;
    }
    try {
      if (fbUnsubscribe) { fbUnsubscribe(); fbUnsubscribe = null; }
      const connect = () => {
        try {
          fbApp = firebase.initializeApp(cfg);
          fbDb = firebase.database();
          fbDocRef = fbDb.ref('rooms/' + room);
          isFirebaseConnected = true;
          updateSyncUI();
          if (fromUser) alert('✅ Connected to Realtime Database! Room: ' + room + '\nChanges will sync live across devices.');

          let firstSnapshot = true;
          const listener = fbDocRef.on('value', snapshot => {
            if (!snapshot.exists()) {
              // Only the first client reaching an empty room seeds it with its current local data.
              if (firstSnapshot) pushToFirebase(true);
              firstSnapshot = false;
              return;
            }
            firstSnapshot = false;
            const data = snapshot.val();
            if (!data || typeof data !== 'object') return;
            isApplyingRemote = true;
            state = data.state || {};
            payState = data.payState || {};
            fixedState = data.fixedState || {};
            customRolls = Array.isArray(data.customRolls) ? data.customRolls : [];
            removedRolls = Array.isArray(data.removedRolls) ? data.removedRolls : [];
            amountPerPerson = parseFloat(data.amountPerPerson) || 0;
            amountInput.value = amountPerPerson || '';
            render();
            setTimeout(() => { isApplyingRemote = false; }, 100);
          }, err => {
            console.error('Realtime Database error:', err);
            isFirebaseConnected = false; updateSyncUI();
            if (fromUser) alert('❌ Realtime Database error: ' + err.message + '\nCheck the database URL and Realtime Database Rules.');
          });
          fbUnsubscribe = () => fbDocRef.off('value', listener);
        } catch(e) {
          console.error(e);
          isFirebaseConnected = false; updateSyncUI();
          if (fromUser) alert('❌ Firebase init failed: ' + e.message);
        }
      };
      if (firebase.apps && firebase.apps.length) {
        // Reuse default app if same project; otherwise delete it before reinitializing.
        const existing = firebase.app();
        if (existing.options.projectId === cfg.projectId) {
          fbApp = existing;
          fbDb = firebase.database(fbApp);
          fbDocRef = fbDb.ref('rooms/' + room);
          isFirebaseConnected = true;
          updateSyncUI();
          let firstSnapshot = true;
          const listener = fbDocRef.on('value', snapshot => {
            if (!snapshot.exists()) { if (firstSnapshot) pushToFirebase(true); firstSnapshot = false; return; }
            firstSnapshot = false;
            const data = snapshot.val() || {};
            isApplyingRemote = true;
            state = data.state || {}; payState = data.payState || {}; fixedState = data.fixedState || {};
            customRolls = Array.isArray(data.customRolls) ? data.customRolls : [];
            removedRolls = Array.isArray(data.removedRolls) ? data.removedRolls : [];
            amountPerPerson = parseFloat(data.amountPerPerson) || 0;
            amountInput.value = amountPerPerson || ''; render();
            setTimeout(() => { isApplyingRemote = false; }, 100);
          }, err => { console.error(err); isFirebaseConnected = false; updateSyncUI(); if(fromUser) alert('Realtime Database error: '+err.message); });
          fbUnsubscribe = () => fbDocRef.off('value', listener);
          if (fromUser) alert('✅ Connected to Realtime Database! Room: ' + room + '\nChanges will sync live across devices.');
        } else {
          existing.delete().then(connect).catch(err => { if(fromUser) alert('Could not reinitialize Firebase: '+err.message); });
        }
      } else connect();
    } catch(e){
      console.error(e); isFirebaseConnected = false; updateSyncUI();
      if (fromUser) alert('❌ Firebase init failed: ' + e.message);
    }
  }

  function pushToFirebase(immediate){
    if (!isFirebaseConnected || !fbDocRef || isApplyingRemote) return;
    const doPush = () => {
      const payload = {
        state, payState, fixedState, customRolls, removedRolls, amountPerPerson,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      fbDocRef.set(payload).catch(err => {
        console.error('Realtime Database write failed:', err);
        isFirebaseConnected = false; updateSyncUI();
      });
    };
    if (immediate){ doPush(); return; }
    clearTimeout(fbSaveTimer);
    fbSaveTimer = setTimeout(doPush, 300);
  }

  function toggleAddForm(){
    const f = document.getElementById('addForm');
    f.classList.toggle('open');
    if (f.classList.contains('open')) document.getElementById('newRollInput').focus();
  }

  function toggleSharePanel(){
    document.getElementById('sharePanel').classList.toggle('open');
  }

  function getAllData(){
    return {
      app: 'aiml-lunch-count',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: state,
      payState: payState,
      fixedState: fixedState,
      customRolls: customRolls,
      removedRolls: removedRolls,
      amountPerPerson: amountPerPerson
    };
  }

  function applyData(data){
    if (!requireLiveConnection()) return;
    if (!data || typeof data !== 'object') throw new Error('Invalid data');
    state = data.state || {};
    payState = data.payState || {};
    fixedState = data.fixedState || {};
    customRolls = data.customRolls || [];
    removedRolls = data.removedRolls || [];
    amountPerPerson = parseFloat(data.amountPerPerson) || 0;
    saveState(); savePayState(); saveFixedState(); saveCustom(); saveRemoved();
    amountInput.value = amountPerPerson || '';
    render();
  }

  function exportData(){
    const data = getAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aiml-lunch-data-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    alert('✅ Data exported! Send this file to other devices — they click Import and select it.');
  }

  function importFile(event){
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e){
      try {
        const data = JSON.parse(e.target.result);
        if (!confirm('Import this data into the connected Firebase room? Current cloud room data will be replaced for everyone.')) return;
        applyData(data);
        alert('✅ Data imported successfully!');
      } catch(err){ alert('❌ Invalid file. Please select a valid exported JSON file.'); }
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function generateShareCode(){
    const code = btoa(unescape(encodeURIComponent(JSON.stringify(getAllData()))));
    document.getElementById('shareCode').value = code;
  }

  function copyShareCode(){
    const ta = document.getElementById('shareCode');
    if (!ta.value.trim()){ alert('First click Generate Code'); return; }
    ta.select();
    navigator.clipboard.writeText(ta.value).then(() => alert('✅ Code copied! Send it on WhatsApp.')).catch(() => { document.execCommand('copy'); alert('✅ Code copied!'); });
  }

  function importFromCode(){
    const code = document.getElementById('shareCode').value.trim();
    if (!code){ alert('Paste a share code first'); return; }
    try {
      const data = JSON.parse(decodeURIComponent(escape(atob(code))));
      if (!confirm('Import this shared data? Current data on this device will be replaced.')) return;
      applyData(data);
      alert('✅ Data imported successfully!');
    } catch(err){ alert('❌ Invalid code. Make sure you copied the full code.'); }
  }

  function addMember(){
    if (!requireLiveConnection()) return;
    const input = document.getElementById('newRollInput');
    const roll = input.value.trim().toUpperCase();
    if (!roll){ alert('Please enter a roll number'); return; }
    const active = getActiveRolls();
    if (active.includes(roll)){ alert(roll + ' already exists!'); return; }
    // If it was previously removed, un-remove it
    if (removedRolls.includes(roll)){
      removedRolls = removedRolls.filter(r => r !== roll);
      saveRemoved();
    } else {
      customRolls.push(roll);
      saveCustom();
    }
    input.value = '';
    document.getElementById('addForm').classList.remove('open');
    render();
    // scroll to new card
    setTimeout(() => {
      const cards = document.querySelectorAll('.card');
      cards.forEach(c => { if (c.textContent.includes(roll)) c.scrollIntoView({behavior:'smooth', block:'center'}); });
    }, 100);
  }

  document.getElementById('newRollInput').addEventListener('keydown', e => { if (e.key === 'Enter') addMember(); });

  function removeMember(roll){
    if (!requireLiveConnection()) return;
    if (fixedState[roll]){ alert('🔒 This member is Fixed. Unfix first to remove.'); return; }
    if (!confirm('Remove ' + roll + ' from the list?')) return;
    if (customRolls.includes(roll)){
      customRolls = customRolls.filter(r => r !== roll);
      saveCustom();
    } else {
      if (!removedRolls.includes(roll)) removedRolls.push(roll);
      saveRemoved();
    }
    delete state[roll]; delete payState[roll]; delete fixedState[roll];
    saveState(); savePayState(); saveFixedState();
    render();
  }

  function toggleFix(roll){
    if (!requireLiveConnection()) return;
    if (fixedState[roll]) delete fixedState[roll];
    else fixedState[roll] = true;
    saveFixedState();
    render();
  }

  function fixAll(){
    if (!requireLiveConnection()) return;
    getActiveRolls().forEach(r => fixedState[r] = true);
    saveFixedState(); render();
  }
  function unfixAll(){
    if (!requireLiveConnection()) return;
    fixedState = {}; saveFixedState(); render();
  }

  function render() {
    const activeRolls = getActiveRolls();
    grid.innerHTML = '';
    let visible = 0;

    activeRolls.forEach((roll, idx) => {
      const status = state[roll] || '';
      const pay = payState[roll] || '';
      const isFixed = !!fixedState[roll];

      if (currentFilter === 'yes' && status !== 'yes') return;
      if (currentFilter === 'no' && status !== 'no') return;
      if (currentFilter === 'pending' && status !== '') return;
      if (currentFilter === 'paid' && pay !== 'paid') return;
      if (currentFilter === 'notpaid' && pay !== 'notpaid') return;
      if (currentFilter === 'fixed' && !isFixed) return;
      if (searchQuery && !roll.toLowerCase().includes(searchQuery.toLowerCase())) return;

      visible++;

      const card = document.createElement('div');
      let cls = 'card';
      if (status === 'yes') cls += ' present';
      if (status === 'no') cls += ' absent';
      if (pay === 'paid') cls += ' is-paid';
      if (pay === 'notpaid') cls += ' is-notpaid';
      if (isFixed) cls += ' is-fixed';
      card.className = cls;
      card.style.animationDelay = (idx * 0.015) + 's';

      const num = roll.slice(-2);
      const isLE = roll.startsWith('24475A61');
      const leLabel = isLE ? 'LE-' + parseInt(num, 10) : '';
      const leBadge = isLE ? `<span class="le-badge">${leLabel}</span>` : '';
      const fixedBadge = isFixed ? `<span class="fixed-badge">🔒 FIXED</span>` : '';

      const baseSub = status === 'yes' ? '🍽️ Coming for Lunch' : status === 'no' ? '❌ Not Coming — tap YES to change' : 'Tap YES or NO';
      const subText = isLE ? `${leLabel} • ${baseSub}` : `AIML • ${baseSub}`;
      const payLabel = pay === 'paid' ? '<b>💰 Paid ✓</b>' : pay === 'notpaid' ? '⏳ Not Paid' : '💰 Money:';
      const dis = isFixed ? 'disabled' : '';

      card.innerHTML = `
        <div class="status-icon">${status === 'yes' ? '✓' : status === 'no' ? '✕' : ''}</div>
        <div class="card-top">
          <div class="left">
            <div class="avatar">${num}<span class="pay-dot">₹</span></div>
            <div class="info">
              <div class="roll">${roll}${leBadge}${fixedBadge}</div>
              <div class="sub">${subText}</div>
            </div>
          </div>
          <div class="actions">
            <button class="yes-btn" ${dis} onclick="mark('${roll}', 'yes', this)" title="${isFixed ? '🔒 Fixed — unfix to change' : 'Yes - Coming for Lunch'}">YES</button>
            <button class="no-btn" ${dis} onclick="mark('${roll}', 'no', this)" title="${isFixed ? '🔒 Fixed — unfix to change' : 'No - Not Coming'}">NO</button>
          </div>
        </div>
        <div class="pay-row">
          <div class="pay-label">${payLabel}</div>
          <div class="pay-actions">
            <button class="paid-btn" ${dis} onclick="markPay('${roll}', 'paid', this)" title="${isFixed ? '🔒 Fixed' : 'Money Paid'}">💰 Paid</button>
            <button class="notpaid-btn" ${dis} onclick="markPay('${roll}', 'notpaid', this)" title="${isFixed ? '🔒 Fixed' : 'Money Not Paid'}">Not Paid</button>
          </div>
        </div>
        <div class="lock-note">🔒 Fixed — click Fix button below to unlock & change</div>
        <div class="bottom-row">
          <button class="fix-btn" onclick="toggleFix('${roll}')" title="Fix / Unfix this member">${isFixed ? '🔓 Unfix (Unlock)' : '📌 Fix (Lock)'}</button>
          <button class="remove-btn" ${dis} onclick="removeMember('${roll}')" title="${isFixed ? 'Unfix first to remove' : 'Remove this member'}">🗑️ Remove</button>
        </div>
      `;
      grid.appendChild(card);
    });

    if (visible === 0) grid.innerHTML = '<div class="empty">No members found 🔍</div>';
    updateStats(activeRolls);
  }

  function floatEmoji(btn, emoji){
    const rect = btn.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float-check'; el.textContent = emoji;
    el.style.left = (rect.left + rect.width/2 - 14) + 'px';
    el.style.top = (rect.top - 10) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function mark(roll, type, btn) {
    if (!requireLiveConnection()) return;
    if (fixedState[roll]) return;
    if (state[roll] === type) delete state[roll]; else state[roll] = type;
    saveState();
    if (state[roll]) floatEmoji(btn, type === 'yes' ? '✅' : '❌');
    render();
  }

  function markPay(roll, type, btn) {
    if (!requireLiveConnection()) return;
    if (fixedState[roll]) return;
    if (payState[roll] === type) delete payState[roll]; else payState[roll] = type;
    savePayState();
    if (payState[roll]) floatEmoji(btn, type === 'paid' ? '💰' : '⏳');
    render();
  }

  function markAll(type) {
    if (!requireLiveConnection()) return;
    getActiveRolls().forEach(r => { if (!fixedState[r]) state[r] = type; });
    saveState(); render();
  }

  function setFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
  }

  function updateStats(activeRolls) {
    activeRolls = activeRolls || getActiveRolls();
    const total = activeRolls.length;
    const yes = activeRolls.filter(r => state[r] === 'yes').length;
    const no = activeRolls.filter(r => state[r] === 'no').length;
    const marked = yes + no;
    const paid = activeRolls.filter(r => payState[r] === 'paid').length;
    const notPaid = activeRolls.filter(r => payState[r] === 'notpaid').length;

    document.getElementById('yesCount').textContent = yes;
    document.getElementById('noCount').textContent = no;
    document.getElementById('totalCount').textContent = total;
    document.getElementById('paidCount').textContent = paid;
    document.getElementById('notPaidCount').textContent = notPaid;
    document.getElementById('headerTotal').textContent = total + ' Students';
    document.getElementById('filterAll').textContent = 'All (' + total + ')';
    document.getElementById('progressText').textContent = marked + ' / ' + total + ' responded';
    document.getElementById('payProgressText').textContent = paid + ' / ' + total + ' paid';
    document.getElementById('fillGreen').style.width = (total ? yes/total*100 : 0) + '%';
    document.getElementById('fillRed').style.width = (total ? no/total*100 : 0) + '%';
    document.getElementById('fillGold').style.width = (total ? paid/total*100 : 0) + '%';

    const paidComing = activeRolls.filter(r => state[r] === 'yes' && payState[r] === 'paid').length;
    const comingNotPaid = yes - paidComing;
    const amtText = document.getElementById('amountText');
    if (amountPerPerson > 0) {
      const collected = paidComing * amountPerPerson;
      const pending = comingNotPaid * amountPerPerson;
      const totalNeeded = yes * amountPerPerson;
      amtText.innerHTML = `Collected: ₹${collected.toLocaleString('en-IN')}<br>Pending: ₹${pending.toLocaleString('en-IN')} (${comingNotPaid} left)<br>Total for ${yes} coming: ₹${totalNeeded.toLocaleString('en-IN')}`;
    } else {
      amtText.innerHTML = 'Enter amount →<br>to see total';
    }
  }

  amountInput.addEventListener('input', function(){
    if (!requireLiveConnection()){ this.value = amountPerPerson || ''; return; }
    amountPerPerson = parseFloat(this.value) || 0;
    pushToFirebase();
    updateStats();
  });

  document.getElementById('searchInput').addEventListener('input', function() {
    searchQuery = this.value.trim(); render();
  });

  render();
  updateSyncUI();
  // Auto-connect Firebase if config saved
  window.addEventListener('load', () => setTimeout(() => initFirebase(false), 800));
