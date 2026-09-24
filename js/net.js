/* 낙서 서바이벌 — 자동 방 연결 (PeerJS, 그물 구조 P2P)
 *
 * 1) 방 이름으로 정해진 "방장 주소"를 먼저 차지한 사람이 방장이 된다.
 *    (PeerJS 주소는 겹칠 수 없어서, 서버 없이 한 명만 방장이 된다)
 * 2) 나머지는 방장에게 붙어 참가자 명단을 받고, 서로서로 직접 연결한다.
 *    두 사람 사이에는 주소가 앞선 쪽이 연결을 건다(중복 방지).
 * 3) 방장이 나가면 남은 사람끼리 방장 주소를 다시 차지하려 하고, 먼저 잡은 사람이 이어받는다.
 *    이미 맺은 연결은 그대로라 게임은 멈추지 않는다.
 * 4) 6명이 차면 새로 온 사람은 다음 방(이름-n2, -n3 …)으로 간다.
 *
 * 주고받는 것은 각자의 "내 상태" 하나뿐이다(presence). 받는 쪽은 키 단위로 이어 붙인다.
 * 방장은 판 진행(그리기/난투/결과)도 자기 상태에 실어 보낸다.
 */
(function () {
  'use strict';
  const NS = window.NS;

  const PREFIX = 'nakseo-survival-v1-';   // 통신 형식이 바뀌면 숫자를 올린다
  const MAX = 6;
  const HEAVY = ['n', 'c', 'w', 'wi', 'gs'];   // 무거운 값: 바뀔 때와 3초마다만
  const jitter = (a, b) => a + Math.random() * (b - a);

  // PeerJS 주소 규칙: 영문 소문자, 숫자, 하이픈(연속·끝 금지)
  const cleanRoom = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20).replace(/-$/, '');
  const roomBase = (r) => String(r).replace(/-n\d+$/, '');
  const roomNo = (r) => { const m = /-n(\d+)$/.exec(r); return m ? +m[1] : 1; };
  const nextRoom = (r) => roomBase(r).slice(0, 16).replace(/-$/, '') + '-n' + (roomNo(r) + 1);

  function join(roomName, opts) {
    opts = opts || {};
    const uid = Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, 'x').padEnd(10, 'x');
    let room, DESK, MY;
    const setRoom = (r) => { room = r; DESK = PREFIX + r; MY = DESK + '-' + uid; };
    setRoom(cleanRoom(roomName) || 'plaza');
    const uidOf = (pid) => (typeof pid === 'string' && pid.startsWith(DESK + '-') ? pid.slice(DESK.length + 1).slice(0, 12) : null);

    let me = null, desk = null, lobby = null, closed = false, hops = 0, fails = 0;
    let state = 'connecting';   // connecting | host | client | offline | unsupported
    let deskT = 0, restartT = 0;
    const links = new Map();      // 상대 주소 → { conn, uid }
    const others = new Map();     // uid → { pr, last }
    const deskConns = new Map();
    const roster = new Set();
    let mine = {}, mineSnap = null, dirty = false, lastSend = 0, lastHeavy = '', lastFull = 0, lastRoster = 0;

    const send = (c, m) => { try { if (c && c.open) c.send(m); } catch (e) { /* 끊긴 연결 */ } };
    const safeClose = (c) => { try { c && c.close(); } catch (e) { /* 무시 */ } };

    function accept(u, p) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      try { if (JSON.stringify(p).length > 9000) return; } catch (e) { return; }
      const prev = others.get(u);
      const merged = Object.assign({}, prev ? prev.pr : {}, p);
      for (const k of Object.keys(p)) if (p[k] === null) delete merged[k];
      others.set(u, { pr: Object.freeze(merged), last: performance.now() });
    }

    function addLink(conn) {
      const pid = conn.peer, u = uidOf(pid);
      if (!u || u === uid) { safeClose(conn); return; }
      conn.on('open', () => {
        const old = links.get(pid);
        if (!old && links.size >= MAX - 1) { safeClose(conn); return; }
        if (old && old.conn !== conn) safeClose(old.conn);
        links.set(pid, { conn, uid: u });
        send(conn, { t: 'p', p: mine });
      });
      conn.on('data', (m) => {
        const l = links.get(pid);
        if (!l || l.conn !== conn || !m || typeof m !== 'object') return;
        if (m.t === 'p') accept(u, m.p);
        else if (m.t === 'bye') drop(pid, conn);
      });
      conn.on('close', () => drop(pid, conn));
      conn.on('error', () => drop(pid, conn));
    }
    function drop(pid, conn) {
      const l = links.get(pid);
      if (!l || l.conn !== conn) return;
      links.delete(pid);
      others.delete(l.uid);
    }
    function onRoster(ids) {
      if (!Array.isArray(ids)) return;
      for (const pid of ids.slice(0, MAX * 2)) {
        const u = uidOf(pid);
        if (u && u !== uid && uid < u && !links.has(pid) && me && !closed) addLink(me.connect(pid, { reliable: true, serialization: 'json' }));
      }
    }

    /* 방장 자리 */
    function pushRoster() {
      if (!desk) return;
      const ids = [...roster];
      for (const c of deskConns.values()) send(c, { t: 'roster', ids });
      onRoster(ids);
      lastRoster = performance.now();
    }
    function claimDesk() {
      if (closed || desk || !me) return;
      const d = new window.Peer(DESK, { debug: 0 });
      d.on('open', () => {
        if (closed) { d.destroy(); return; }
        desk = d;
        state = 'host';
        fails = 0;
        if (lobby) { const l = lobby; lobby = null; safeClose(l); }
        roster.clear();
        roster.add(MY);
        for (const pid of links.keys()) roster.add(pid);
        pushRoster();
      });
      d.on('connection', (c) => {
        c.on('open', () => {
          if (!uidOf(c.peer)) { safeClose(c); return; }
          if (!roster.has(c.peer) && roster.size >= MAX) {
            send(c, { t: 'full' });
            setTimeout(() => safeClose(c), 400);
            return;
          }
          deskConns.set(c.peer, c);
          roster.add(c.peer);
          pushRoster();
        });
        const gone = () => {
          if (deskConns.get(c.peer) !== c) return;
          deskConns.delete(c.peer);
          roster.delete(c.peer);
          pushRoster();
        };
        c.on('close', gone);
        c.on('error', gone);
      });
      d.on('disconnected', () => { if (desk === d && !closed) { try { d.reconnect(); } catch (e) { /* 무시 */ } } });
      d.on('error', (e) => {
        if (desk === d) return;
        try { d.destroy(); } catch (x) { /* 무시 */ }
        if (e.type === 'unavailable-id') joinLobby();   // 이미 방장이 있다 → 명단 받으러
        else scheduleDesk(jitter(1500, 3000));
      });
    }
    function joinLobby() {
      if (closed || !me || desk) return;
      const c = me.connect(DESK, { reliable: true, serialization: 'json' });
      const t = setTimeout(() => { if (lobby !== c) { safeClose(c); scheduleDesk(jitter(300, 1200)); } }, 9000);
      c.on('open', () => { clearTimeout(t); lobby = c; state = 'client'; fails = 0; });
      c.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'roster') onRoster(m.ids);
        else if (m.t === 'full' && lobby === c) moveOn();
      });
      c.on('close', () => {
        if (lobby !== c) return;
        lobby = null;
        if (!closed && !desk) { state = 'connecting'; scheduleDesk(jitter(200, 1000)); }
      });
    }
    function moveOn() {
      if (closed || hops >= 30) return;
      hops++;
      setRoom(nextRoom(room));
      restart(0);
      if (opts.onMove) { try { opts.onMove(room); } catch (e) { /* 무시 */ } }
    }
    function scheduleDesk(ms) { clearTimeout(deskT); deskT = setTimeout(claimDesk, ms); }

    function start() {
      if (closed) return;
      const p = new window.Peer(MY, { debug: 0 });
      me = p;
      p.on('open', () => { if (me === p) claimDesk(); });
      p.on('connection', addLink);
      p.on('disconnected', () => { if (me === p && !closed) { try { p.reconnect(); } catch (e) { /* 무시 */ } } });
      p.on('error', (e) => {
        if (me !== p) return;
        if (e.type === 'peer-unavailable') {
          // 방장이 막 사라졌으면 내가 맡아 본다
          if (String(e.message || '').endsWith(DESK)) scheduleDesk(jitter(100, 600));
          return;
        }
        if (!links.size && !desk && !lobby) {
          fails++;
          state = fails >= 3 ? 'offline' : 'connecting';
          restart(Math.min(10000, 1500 * fails));
        }
      });
    }
    function teardown() {
      clearTimeout(deskT);
      clearTimeout(restartT);
      for (const l of links.values()) safeClose(l.conn);
      links.clear();
      others.clear();
      deskConns.clear();
      roster.clear();
      for (const p of [desk, me]) if (p) { try { p.destroy(); } catch (e) { /* 무시 */ } }
      desk = me = lobby = null;
    }
    function restart(ms) {
      teardown();
      if (state !== 'offline') state = 'connecting';
      restartT = setTimeout(start, ms);
    }

    function flush() {
      const now = performance.now();
      const heavy = JSON.stringify(HEAVY.map((k) => mine[k]));
      let p = mine;
      if (heavy === lastHeavy && now - lastFull < 3000) {
        p = Object.assign({}, mine);
        for (const k of HEAVY) delete p[k];
      } else { lastHeavy = heavy; lastFull = now; }
      const msg = { t: 'p', p };
      for (const l of links.values()) send(l.conn, msg);
      lastSend = now;
      dirty = false;
    }
    const timer = setInterval(() => {
      const now = performance.now();
      if (dirty && now - lastSend > 45) flush();
      else if (now - lastSend > 1000) flush();
      for (const [u, o] of others) if (now - o.last > 6000) others.delete(u);
      if (desk && now - lastRoster > 4000) pushRoster();
    }, 16);

    if (typeof window.Peer === 'function' && typeof window.RTCPeerConnection === 'function') start();
    else state = 'unsupported';

    return {
      myId: uid,
      max: MAX,
      get room() { return room; },
      setPresence(patch) { mine = Object.assign({}, mine, patch); mineSnap = null; dirty = true; },
      peers() {
        if (!mineSnap) mineSnap = { id: uid, pr: Object.freeze(Object.assign({}, mine)), me: true, last: performance.now() };
        return [mineSnap].concat([...others].map(([u, o]) => ({ id: u, pr: o.pr, me: false, last: o.last })));
      },
      isDesk: () => !!desk,
      status() { return state === 'connecting' && links.size ? 'client' : state; },
      linkCount: () => links.size,
      leave() {
        if (closed) return;
        for (const l of links.values()) send(l.conn, { t: 'bye' });
        closed = true;
        clearInterval(timer);
        setTimeout(teardown, 200);
      },
    };
  }

  NS.Net = { join, cleanRoom, roomBase, roomNo, MAX, newRoomName: () => 'r-' + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x') };
})();
