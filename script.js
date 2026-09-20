/* =========================================================
   情報Ⅰ「パケット通信と通信品質」授業用シミュレーター
   script.js
   ---------------------------------------------------------
   体験1：データをパケットに分けて送り、受信側で並べ直す
   体験3：通信速度・遅延・パケットロスを変えて比較する
   活用　：3つのネットワークから用途に合うものを選ぶ
   ========================================================= */
'use strict';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* =========================================================
   タブ切り替え
   ========================================================= */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === tab.dataset.tab));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});

/* =========================================================
   ドット絵（16×16）を計算でつくる
   ========================================================= */
const ART_SIZE = 16;

function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STAR_PTS = (() => {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 1.0 : 0.45;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
})();

/** 1マスの色を返す（null は透明） */
function pixelColor(kind, x, y) {
  const u = ((x + 0.5) / ART_SIZE) * 2 - 1;   // -1 〜 1（右が＋）
  const v = ((y + 0.5) / ART_SIZE) * 2 - 1;   // -1 〜 1（下が＋）

  if (kind === 'heart') {
    const hx = u * 1.25;
    const hy = -v * 1.25 + 0.18;
    const f = Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * Math.pow(hy, 3);
    if (f <= 0) return hy > 0.45 && hx < -0.1 ? '#f28ba0' : '#e0516f';
    return null;
  }

  if (kind === 'star') {
    if (inPolygon(u, v, STAR_PTS)) return v < -0.15 ? '#ffd34d' : '#f5b312';
    return null;
  }

  // にこちゃん
  const d = Math.sqrt(u * u + v * v);
  if (d > 0.95) return null;
  const eye = (Math.abs(u) > 0.24 && Math.abs(u) < 0.5 && v > -0.48 && v < -0.12);
  if (eye) return '#3a2d1a';
  const mouth = (d > 0.48 && d < 0.68 && v > 0.16);
  if (mouth) return '#3a2d1a';
  return '#ffd34d';
}

function makeArt(kind) {
  const rows = [];
  for (let y = 0; y < ART_SIZE; y++) {
    const row = [];
    for (let x = 0; x < ART_SIZE; x++) row.push(pixelColor(kind, x, y));
    rows.push(row);
  }
  return rows;
}

const ARTS = [
  { id: 'heart', name: 'ハート', rows: makeArt('heart') },
  { id: 'star',  name: 'ほし',   rows: makeArt('star')  },
  { id: 'smile', name: 'にこちゃん', rows: makeArt('smile') }
];

/** 行データからドット絵のDOMをつくる */
function renderGrid(rows, size = 'md') {
  const g = document.createElement('div');
  g.className = `dot-grid ${size}`;
  rows.forEach((row) => row.forEach((c) => {
    const cell = document.createElement('i');
    cell.style.background = c ? c : 'transparent';
    g.appendChild(cell);
  }));
  return g;
}

/* =========================================================
   体験1：パケット分割 → 転送 → 復元
   ========================================================= */
const T1 = {
  packets: [],
  arrived: [],
  selectedArt: 'heart',
  running: false,
  lostNo: null
};

const packetList   = $('#packetList');
const packetLayer  = $('#packetLayer');
const arriveBox    = $('#arriveBox');
const restoreRaw   = $('#restoreRaw');
const restoreSort  = $('#restoreSorted');
const sendStatus   = $('#sendStatus');
const restoreStat  = $('#restoreStatus');
const sortBtn      = $('#sortBtn');
const resendBtn    = $('#resendBtn');

const ROUTES = ['#routeA', '#routeB', '#routeC'].map((id) => {
  const el = $(id);
  return { el, len: el.getTotalLength() };
});

/* --- 送るデータの切り替え --- */
$$('input[name="datatype"]').forEach((r) => {
  r.addEventListener('change', () => {
    const isText = $('input[name="datatype"]:checked').value === 'text';
    $('#textPicker').classList.toggle('hidden', !isText);
    $('#imagePicker').classList.toggle('hidden', isText);
  });
});

/* --- 画像の選択ボタン --- */
const artChoices = $('#artChoices');
ARTS.forEach((art) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'art-choice' + (art.id === T1.selectedArt ? ' is-selected' : '');
  b.dataset.art = art.id;
  b.appendChild(renderGrid(art.rows, 'sm'));
  const cap = document.createElement('span');
  cap.textContent = art.name;
  b.appendChild(cap);
  b.addEventListener('click', () => {
    T1.selectedArt = art.id;
    $$('.art-choice', artChoices).forEach((el) => el.classList.toggle('is-selected', el.dataset.art === art.id));
  });
  artChoices.appendChild(b);
});

/* --- パケットをつくる --- */
function buildPackets() {
  const type = $('input[name="datatype"]:checked').value;
  const list = [];

  if (type === 'text') {
    let text = $('#msgInput').value.trim();
    if (!text) text = 'ネットワーク';
    const size = 3;                                  // 1パケット 3文字
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += size) {
      list.push({ type: 'text', text: chars.slice(i, i + size).join('') });
    }
  } else {
    const art = ARTS.find((a) => a.id === T1.selectedArt);
    const size = 2;                                  // 1パケット 2行
    for (let i = 0; i < art.rows.length; i += size) {
      list.push({ type: 'image', rows: art.rows.slice(i, i + size) });
    }
  }

  const total = list.length;
  return list.map((p, i) => Object.assign(p, { no: i + 1, total }));
}

function renderPacketList() {
  packetList.innerHTML = '';
  if (!T1.packets.length) {
    packetList.innerHTML = '<p class="empty">「送信する」を押すとパケットが作られます。</p>';
    return;
  }
  T1.packets.forEach((p) => {
    const box = document.createElement('div');
    box.className = 'packet';
    const head = document.createElement('div');
    head.className = 'pk-head';
    head.innerHTML = `宛先 192.168.1.20<br>番号 ${p.no} / ${p.total}`;
    const body = document.createElement('div');
    body.className = 'pk-body';
    if (p.type === 'text') body.textContent = p.text;
    else body.appendChild(renderGrid(p.rows, 'sm'));
    box.appendChild(head);
    box.appendChild(body);
    packetList.appendChild(box);
  });
}

function resetT1(keepInputs = true) {
  T1.packets = [];
  T1.arrived = [];
  T1.lostNo = null;
  T1.running = false;
  packetLayer.innerHTML = '';
  arriveBox.innerHTML = '<p class="empty">まだ何も届いていません。</p>';
  restoreRaw.innerHTML = '<span class="empty">―</span>';
  restoreSort.innerHTML = '<span class="empty">―</span>';
  sortBtn.disabled = true;
  resendBtn.classList.add('hidden');
  restoreStat.textContent = '';
  sendStatus.textContent = '「送信する」を押してみよう。';
  renderPacketList();
  if (!keepInputs) $('#dropOne').checked = false;
}

/** SVG上のパケット図形をつくる */
function makeDot(no) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'pk');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('r', '12');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('y', '4');
  t.textContent = no;
  g.appendChild(c);
  g.appendChild(t);
  return g;
}

function addArriveTag(p) {
  if (arriveBox.querySelector('.empty')) arriveBox.innerHTML = '';
  const tag = document.createElement('span');
  tag.className = 'arrive-tag';
  tag.textContent = `${p.no}番`;
  arriveBox.appendChild(tag);
}

/** 届いた順 / 番号順のデータを表示 */
function showRestore(sorted) {
  const target = sorted ? restoreSort : restoreRaw;
  const list = sorted
    ? T1.packets.slice().sort((a, b) => a.no - b.no).filter((p) => T1.arrived.includes(p))
    : T1.arrived;

  target.innerHTML = '';

  if (T1.packets[0] && T1.packets[0].type === 'text') {
    if (sorted) {
      // 番号順に並べる（届かなかった所は □ で表示）
      let s = '';
      T1.packets.slice().sort((a, b) => a.no - b.no).forEach((p) => {
        s += T1.arrived.includes(p) ? p.text : '□'.repeat(Array.from(p.text).length);
      });
      target.textContent = s;
    } else {
      target.textContent = list.map((p) => p.text).join('');
    }
  } else {
    let rows = [];
    if (sorted) {
      T1.packets.slice().sort((a, b) => a.no - b.no).forEach((p) => {
        if (T1.arrived.includes(p)) rows = rows.concat(p.rows);
        else rows = rows.concat(p.rows.map((r) => r.map(() => '#b9c0cf')));
      });
    } else {
      list.forEach((p) => { rows = rows.concat(p.rows); });
    }
    target.appendChild(renderGrid(rows, 'md'));
  }
}

/** パケットをアニメーションで流す */
function animate(list, onAllDone) {
  const t0 = performance.now();
  let finished = 0;

  list.forEach((p, i) => {
    p.route = ROUTES[(i + Math.floor(Math.random() * 3)) % 3];
    p.delay = i * 150 + Math.random() * 120;
    p.dur   = 1200 + Math.random() * 2300;
    p.lostAt = 0.35 + Math.random() * 0.3;
    p.g = makeDot(p.no);
    p.g.style.opacity = '0';
    p.done = false;
    packetLayer.appendChild(p.g);
  });

  function frame(t) {
    list.forEach((p) => {
      if (p.done) return;
      const e = (t - t0 - p.delay) / p.dur;
      if (e < 0) return;
      p.g.style.opacity = '1';

      // わざと落とすパケット
      if (p.isLost && e >= p.lostAt) {
        const f = (e - p.lostAt) / 0.3;
        p.g.classList.add('lost');
        const pt = p.route.el.getPointAtLength(p.route.len * p.lostAt);
        p.g.setAttribute('transform', `translate(${pt.x},${pt.y + f * 40})`);
        p.g.style.opacity = String(Math.max(0, 1 - f));
        if (f >= 1) { p.g.remove(); p.done = true; finished++; }
        return;
      }

      if (e >= 1) {
        p.g.remove();
        p.done = true;
        finished++;
        T1.arrived.push(p);
        addArriveTag(p);
        showRestore(false);
        return;
      }
      const pt = p.route.el.getPointAtLength(p.route.len * e);
      p.g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    });

    if (finished < list.length) requestAnimationFrame(frame);
    else onAllDone();
  }
  requestAnimationFrame(frame);
}

function send() {
  if (T1.running) return;
  resetT1();
  T1.packets = buildPackets();
  renderPacketList();

  if ($('#dropOne').checked && T1.packets.length > 2) {
    const idx = 1 + Math.floor(Math.random() * (T1.packets.length - 2));
    T1.packets[idx].isLost = true;
    T1.lostNo = T1.packets[idx].no;
  }

  T1.running = true;
  sendStatus.textContent = `${T1.packets.length}個のパケットを送信中…`;
  sortBtn.disabled = true;

  animate(T1.packets, () => {
    T1.running = false;
    const lost = T1.packets.length - T1.arrived.length;
    const order = T1.arrived.map((p) => p.no).join('→');
    sendStatus.textContent = lost
      ? `届いた順番：${order}　／　${T1.lostNo}番のパケットは届きませんでした。`
      : `届いた順番：${order}　（送った順番とちがっていますね）`;
    sortBtn.disabled = false;
    if (lost) resendBtn.classList.remove('hidden');
  });
}

$('#sendBtn').addEventListener('click', send);
$('#resetBtn').addEventListener('click', () => resetT1(false));

sortBtn.addEventListener('click', () => {
  showRestore(true);
  const lost = T1.packets.length - T1.arrived.length;
  restoreStat.textContent = lost
    ? `${T1.lostNo}番が足りないので、元のデータにもどりません。→ 再送が必要です。`
    : '番号順に並べ直したので、元のデータにもどりました！';
});

resendBtn.addEventListener('click', () => {
  if (T1.running) return;
  const missing = T1.packets.filter((p) => !T1.arrived.includes(p));
  if (!missing.length) return;
  missing.forEach((p) => { p.isLost = false; p.done = false; });
  T1.running = true;
  sendStatus.textContent = `${T1.lostNo}番のパケットを再送中…`;
  animate(missing, () => {
    T1.running = false;
    sendStatus.textContent = `${T1.lostNo}番が届きました。もう一度「番号順に並べ直す」を押してみよう。`;
    resendBtn.classList.add('hidden');
  });
});

resetT1();

/* =========================================================
   体験3：通信品質のシミュレーション
   ========================================================= */
const DATA_MBIT   = 16;    // 2MB = 16Mbit
const TOTAL_PACKET = 200;  // このデータのパケット総数

const speedEl = $('#speed');
const latEl   = $('#latency');
const lossEl  = $('#loss');
const lane    = $('#lane');
const runBtn  = $('#runBtn');
const log     = [];
let   running2 = false;

let activePreset = 'normal';

function syncOutputs() {
  $('#speedOut').textContent   = `${speedEl.value} Mbps`;
  $('#latencyOut').textContent = `${latEl.value} ms`;
  $('#lossOut').textContent    = `${lossEl.value} %`;
}
[speedEl, latEl, lossEl].forEach((el) => el.addEventListener('input', () => {
  activePreset = 'custom';
  syncOutputs();
}));
syncOutputs();

const PRESETS = {
  normal: { speed: 50, latency: 20, loss: 0 },
  slow:   { speed: 4,  latency: 20, loss: 0 },
  delay:  { speed: 50, latency: 300, loss: 0 },
  lossy:  { speed: 50, latency: 20, loss: 12 }
};
$$('[data-preset]').forEach((b) => {
  b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset];
    activePreset = b.dataset.preset;
    speedEl.value = p.speed; latEl.value = p.latency; lossEl.value = p.loss;
    syncOutputs();
  });
});

/* --- 用途ごとの判定 --- */
const USES = {
  video: {
    name: '動画視聴',
    w: { speed: 0.5, lat: 0.17, loss: 0.33 },
    msg: {
      speed: '通信速度が足りず、映像が止まりやすい',
      lat:   '遅延は動画視聴にはあまり影響しない',
      loss:  'パケットロスで画質が落ちたり止まったりする',
      ok:    '高画質でもなめらかに見られそう'
    }
  },
  game: {
    name: 'オンラインゲーム',
    w: { speed: 0.25, lat: 0.375, loss: 0.375 },
    msg: {
      speed: '通信速度が足りず、画面の動きがカクつく',
      lat:   '遅延が大きく、操作の反応が遅れる',
      loss:  'パケットロスで動きが飛んだり切断されやすい',
      ok:    '反応が速く、快適に遊べそう'
    }
  },
  web: {
    name: 'Web閲覧',
    w: { speed: 0.4, lat: 0.4, loss: 0.2 },
    msg: {
      speed: '通信速度が足りず、表示に時間がかかる',
      lat:   '遅延が大きく、押してから表示までが待たされる',
      loss:  'パケットロスの再送で表示が遅くなる',
      ok:    'ページがすぐ表示されそう'
    }
  }
};

function judge(kind, speed, lat, loss) {
  const u = USES[kind];
  const s = { speed: clamp(speed / 30, 0, 1), lat: clamp(1 - lat / 300, 0, 1), loss: clamp(1 - loss / 8, 0, 1) };
  let total = u.w.speed * s.speed + u.w.lat * s.lat + u.w.loss * s.loss;
  let worst = 'speed', worstVal = -1;
  let capped = false;
  Object.keys(u.w).forEach((k) => {
    const deficit = u.w[k] * (1 - s[k]);
    if (deficit > worstVal) { worstVal = deficit; worst = k; }
    // その用途で特に大事な値が極端に悪いときは、他が良くても快適にはならない
    if (u.w[k] >= 0.3 && s[k] < 0.2) capped = true;
  });
  if (capped) total = Math.min(total, 0.5);
  const mark = total >= 0.8 ? '◎' : total >= 0.6 ? '○' : total >= 0.35 ? '△' : '×';
  const cls  = total >= 0.8 ? 'mark-good' : total >= 0.6 ? 'mark-ok' : total >= 0.35 ? 'mark-mid' : 'mark-bad';
  const text = total >= 0.8 ? u.msg.ok : u.msg[worst];
  return { mark, cls, text, total };
}

function updateUses(speed, lat, loss) {
  $$('#useGrid .use').forEach((box) => {
    const r = judge(box.dataset.kind, speed, lat, loss);
    box.classList.remove('mark-good', 'mark-ok', 'mark-mid', 'mark-bad');
    box.classList.add(r.cls);
    $('.use-mark', box).textContent = r.mark;
    $('.use-text', box).textContent = r.text;
  });
}

/* --- 記録表 --- */
function renderLog() {
  const tb = $('#logTable tbody');
  tb.innerHTML = '';
  if (!log.length) {
    tb.innerHTML = '<tr class="empty-row"><td colspan="7">まだ記録がありません。</td></tr>';
    return;
  }
  log.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${r.speed} Mbps</td><td>${r.lat} ms</td><td>${r.loss} %</td>` +
                   `<td>${r.sendSec.toFixed(2)} 秒</td><td>${r.rtt} ms</td><td>${r.lost} 個</td>`;
    tb.appendChild(tr);
  });
}
$('#clearLogBtn').addEventListener('click', () => { log.length = 0; renderLog(); });

/* --- 送信アニメーション --- */
function runQuality() {
  if (running2) return;
  running2 = true;
  runBtn.disabled = true;

  const speed = +speedEl.value, lat = +latEl.value, loss = +lossEl.value;
  const sendSec = (DATA_MBIT / speed) * (1 + loss / 100) + lat / 1000;
  const rtt     = lat * 2 + 8;
  const lostPk  = Math.round(TOTAL_PACKET * (loss / 100));

  $('#rTime').textContent = '0.00 秒';
  $('#rRtt').textContent  = '― ms';
  $('#rLost').textContent = '―';

  const animMs  = clamp(sendSec, 1.2, 4.5) * 1000;
  const travel  = clamp(600 + lat * 1.8, 600, 2000);
  const dotN    = 26;
  const lostSet = new Set();
  const lostDots = Math.round(dotN * (loss / 100));
  while (lostSet.size < lostDots) lostSet.add(Math.floor(Math.random() * dotN));

  lane.innerHTML = '<div class="lane-line"></div>';
  const dots = [];
  for (let i = 0; i < dotN; i++) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.opacity = '0';
    lane.appendChild(d);
    dots.push({
      el: d,
      start: lat + (i * (animMs * 0.8)) / dotN,
      lost: lostSet.has(i),
      lostAt: 0.35 + Math.random() * 0.35,
      done: false
    });
  }

  const t0 = performance.now();
  function frame(t) {
    const elapsed = t - t0;
    $('#rTime').textContent = `${(Math.min(elapsed / animMs, 1) * sendSec).toFixed(2)} 秒`;

    dots.forEach((d) => {
      if (d.done) return;
      const e = (elapsed - d.start) / travel;
      if (e < 0) return;
      d.el.style.opacity = '1';
      if (d.lost && e >= d.lostAt) {
        const f = (e - d.lostAt) / 0.4;
        d.el.classList.add('lost');
        d.el.style.left = `${2 + d.lostAt * 92}%`;
        d.el.style.transform = `translateY(${f * 26}px)`;
        d.el.style.opacity = String(Math.max(0, 1 - f));
        if (f >= 1) d.done = true;
        return;
      }
      if (e >= 1) { d.el.style.left = '96%'; d.el.style.opacity = '0'; d.done = true; return; }
      d.el.style.left = `${2 + e * 94}%`;
    });

    if (elapsed < animMs + travel + 200) {
      requestAnimationFrame(frame);
    } else {
      $('#rTime').textContent = `${sendSec.toFixed(2)} 秒`;
      $('#rRtt').textContent  = `${rtt} ms`;
      $('#rLost').textContent = `${lostPk} 個`;
      updateUses(speed, lat, loss);
      log.push({ speed, lat, loss, sendSec, rtt, lost: lostPk });
      renderLog();
      running2 = false;
      runBtn.disabled = false;
    }
  }
  requestAnimationFrame(frame);
}
runBtn.addEventListener('click', runQuality);
renderLog();

/* =========================================================
   3つの用途を、現在の通信条件で操作体験する
   ========================================================= */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function currentQuality() {
  return { speed: +speedEl.value, latency: +latEl.value, loss: +lossEl.value };
}

function showFeeling(kind) {
  $(`#${kind}Feeling`).classList.remove('hidden');
}

$$('.feeling-options').forEach((group) => {
  group.addEventListener('click', (event) => {
    const button = event.target.closest('.feeling-btn');
    if (!button) return;
    $$('.feeling-btn', group).forEach((b) => b.classList.toggle('is-selected', b === button));
    button.setAttribute('aria-pressed', 'true');
    $$('.feeling-btn', group).filter((b) => b !== button).forEach((b) => b.setAttribute('aria-pressed', 'false'));
  });
});

/* --- 疑似動画 --- */
const playVideoBtn = $('#playVideoBtn');
let videoRunning = false;

async function playVideoExperience() {
  if (videoRunning) return;
  videoRunning = true;
  playVideoBtn.disabled = true;
  const q = currentQuality();
  const player = $('#videoPlayer');
  const message = $('#videoMessage');
  const progress = $('#videoProgress');
  const character = $('#videoCharacter');
  $('#videoFeeling').classList.add('hidden');
  $$('.feeling-btn', $('#videoFeeling')).forEach((b) => b.classList.remove('is-selected'));
  progress.style.width = '0%';
  character.style.left = '5%';

  if (q.latency >= 100) {
    message.textContent = `再生を準備中…（遅延 ${q.latency} ms）`;
  } else {
    message.textContent = '再生を準備中…';
  }
  await wait(q.latency);
  message.textContent = '';

  const duration = 8500;
  const tick = 100;
  const stallCount = q.speed >= 25 ? 0 : q.speed >= 12 ? 1 : q.speed >= 5 ? 2 : 3;
  const stallPoints = [24, 52, 76].slice(0, stallCount);
  const glitchCount = activePreset === 'lossy'
    ? 2
    : q.loss < 5 ? 0 : q.loss < 15 ? 1 : q.loss < 25 ? 2 : 3;
  const glitchPoints = [34, 63, 84].slice(0, glitchCount);
  const usedStalls = new Set();
  const usedGlitches = new Set();
  let played = 0;

  while (played < duration) {
    await wait(tick);
    played += tick;
    const pct = Math.min(100, (played / duration) * 100);
    progress.style.width = `${pct}%`;
    character.style.left = `${5 + pct * 0.68}%`;

    const stallAt = stallPoints.find((point) => pct >= point && !usedStalls.has(point));
    if (stallAt !== undefined) {
      usedStalls.add(stallAt);
      message.textContent = '読み込み中…';
      await wait(clamp(1350 - q.speed * 30, 650, 1400));
      message.textContent = '';
    }

    const glitchAt = glitchPoints.find((point) => pct >= point && !usedGlitches.has(point));
    if (glitchAt !== undefined) {
      usedGlitches.add(glitchAt);
      player.classList.add('is-glitch');
      message.textContent = '映像が乱れました';
      await wait(420);
      player.classList.remove('is-glitch');
      message.textContent = '';
    }
  }

  message.textContent = '再生が終わりました';
  $('#videoCondition').textContent = `体験した条件：${q.speed} Mbps ／ 遅延 ${q.latency} ms ／ ロス ${q.loss}%`;
  showFeeling('video');
  playVideoBtn.textContent = '↻ もう一度再生する';
  playVideoBtn.disabled = false;
  videoRunning = false;
}
playVideoBtn.addEventListener('click', playVideoExperience);

/* --- ジャンプゲーム --- */
const jumpBtn = $('#jumpBtn');
let jumpPending = false;

async function jumpExperience() {
  if (jumpPending) return;
  jumpPending = true;
  jumpBtn.disabled = true;
  const q = currentQuality();
  const character = $('#gameCharacter');
  const obstacle = $('#gameObstacle');
  const message = $('#gameMessage');
  const delayFill = $('#gameDelayFill');
  const delayText = $('#gameDelayText');
  const stage = $('#gameStage');
  const lowBandwidth = activePreset === 'slow' || q.speed < 8;

  character.classList.remove('is-jumping', 'is-late-jump', 'is-hit');
  stage.classList.remove('packet-missed', 'low-bandwidth');
  stage.classList.toggle('low-bandwidth', lowBandwidth);
  obstacle.classList.remove('is-moving');
  void obstacle.offsetWidth;
  obstacle.classList.add('is-moving');
  delayFill.style.transitionDuration = `${Math.max(q.latency, 20)}ms`;
  delayFill.style.width = '0%';
  void delayFill.offsetWidth;
  delayFill.style.width = '100%';
  delayText.textContent = `操作を送信中… ${q.latency} ms`;
  message.textContent = 'ボタンは押されました';

  await wait(q.latency);
  const customLossChance = 1 - Math.pow(1 - q.loss / 100, 4);
  const lost = activePreset === 'lossy' ||
    (activePreset === 'custom' && q.loss > 0 && Math.random() < customLossChance);
  if (lost) {
    delayText.textContent = '操作が途中で消えた';
    message.textContent = '操作が届かなかった！ ジャンプしません';
    stage.classList.add('packet-missed');
  } else {
    delayText.textContent = `操作が到着（${q.latency} ms）`;
    character.classList.add(q.latency >= 220 ? 'is-late-jump' : 'is-jumping');
    message.textContent = q.latency >= 220
      ? 'ジャンプしたけれど、反応が遅い！'
      : lowBandwidth
        ? 'ジャンプ！ でも通信速度が低く、動きがカクつく'
        : 'すぐにジャンプ！';
  }

  await wait(Math.max(0, 850 - q.latency));
  if (lost || q.latency >= 220) {
    character.classList.remove('is-jumping', 'is-late-jump');
    character.classList.add('is-hit');
    message.textContent = lost ? '操作が届かず、障害物にぶつかった！' : '反応が遅れて、障害物にぶつかった！';
  } else {
    message.textContent = 'ジャンプ成功！ 障害物を飛び越えた！';
  }

  await wait(600);
  if (lost) {
    stage.classList.remove('packet-missed');
  }
  character.classList.remove('is-jumping', 'is-late-jump', 'is-hit');
  stage.classList.remove('low-bandwidth');
  obstacle.classList.remove('is-moving');
  delayFill.style.transitionDuration = '.15s';
  delayFill.style.width = '0%';
  delayText.textContent = `体験した遅延：${q.latency} ms ／ ロス：${q.loss}%`;
  showFeeling('game');
  jumpPending = false;
  jumpBtn.disabled = false;
}
jumpBtn.addEventListener('click', jumpExperience);

/* --- 疑似Webページ --- */
const openWebBtn = $('#openWebBtn');
let webLoading = false;

async function openWebExperience() {
  if (webLoading) return;
  webLoading = true;
  openWebBtn.disabled = true;
  const q = currentQuality();
  const heading = $('#webHeading');
  const textPart = $('#webText');
  const imagePart = $('#webImage');
  const status = $('#webStatus');
  [heading, textPart, imagePart].forEach((el) => el.classList.remove('is-loaded', 'is-failed'));
  imagePart.innerHTML = '<span>🏫</span><strong>文化祭のイメージ</strong>';
  $('#webFeeling').classList.add('hidden');
  status.textContent = q.latency >= 100 ? `サーバーの応答を待っています…（${q.latency} ms）` : 'サーバーに接続中…';
  await wait(q.latency);

  const partDelay = clamp(1500 / Math.sqrt(q.speed), 150, 1500);
  status.textContent = 'タイトルを読み込み中…';
  await wait(partDelay * .55);
  heading.classList.add('is-loaded');
  status.textContent = '文章を読み込み中…';
  await wait(partDelay);
  textPart.classList.add('is-loaded');
  status.textContent = '画像を読み込み中…';
  await wait(partDelay * 1.45);

  const customWebLossChance = 1 - Math.pow(1 - q.loss / 100, 5);
  const webLossHappened = activePreset === 'lossy' ||
    (activePreset === 'custom' && q.loss > 0 && Math.random() < customWebLossChance);
  if (webLossHappened) {
    imagePart.classList.add('is-failed');
    imagePart.innerHTML = '<span>⚠️</span><strong>画像の一部が欠けました</strong>';
    status.textContent = '欠けたデータを再送信中…';
    await wait(clamp(350 + q.latency * .2 + q.loss * 18, 350, 850));
    imagePart.classList.remove('is-failed');
    imagePart.innerHTML = '<span>🏫</span><strong>文化祭のイメージ</strong>';
    status.textContent = '再送信で画像を補いました';
    await wait(300);
  }

  imagePart.classList.add('is-loaded');
  status.textContent = 'ページを表示しました';
  await wait(650);
  status.textContent = '';
  showFeeling('web');
  openWebBtn.textContent = '↻ もう一度開く';
  openWebBtn.disabled = false;
  webLoading = false;
}
openWebBtn.addEventListener('click', openWebExperience);

/* --- 比較のヒント --- */
$('#showQualityHint').addEventListener('click', () => {
  const hints = $('#qualityHints');
  const willShow = hints.classList.contains('hidden');
  hints.classList.toggle('hidden', !willShow);
  $('#showQualityHint').textContent = willShow ? 'ヒントを閉じる' : 'ヒントを見る';
  $('#showQualityHint').setAttribute('aria-expanded', willShow ? 'true' : 'false');
});

/* 比較表：各ボタンは独立して選択・解除できる */
$$('.impact-choice').forEach((button) => {
  button.addEventListener('click', () => {
    const selected = !button.classList.contains('is-selected');
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    button.textContent = selected ? '☑ 選択中' : '□ 選ぶ';
    const row = button.closest('tr');
    const count = $$('.impact-choice.is-selected', row).length;
    $('.impact-count', row).textContent = `${count}個選択`;
  });
});

/* =========================================================
   活用：3つのネットワークから選ぶ
   ========================================================= */
const NETS = [
  { id: 'A', tag: '高速だが遅延が大きい',            speed: 80, lat: 250, loss: 0 },
  { id: 'B', tag: '速度は中程度だが遅延が小さい',    speed: 15, lat: 20,  loss: 0 },
  { id: 'C', tag: '高速だがパケットロスがある',      speed: 80, lat: 30,  loss: 8 }
];

const netCards = $('#netCards');
NETS.forEach((n) => {
  const c = document.createElement('div');
  c.className = 'net-card';
  c.innerHTML =
    `<h3>ネットワーク ${n.id}</h3><span class="net-tag">${n.tag}</span>` +
    `<dl><dt>通信速度</dt><dd>${n.speed} Mbps</dd>` +
    `<dt>遅延</dt><dd>${n.lat} ms</dd>` +
    `<dt>パケットロス</dt><dd>${n.loss} %</dd></dl>`;
  netCards.appendChild(c);
});

const QUESTIONS = [
  { key: 'game',  title: 'オンラインゲームをするなら、どのネットワーク？' },
  { key: 'video', title: '動画を見るなら、どのネットワーク？' },
  { key: 'web',   title: 'Webページをたくさん見るなら、どのネットワーク？' }
];

/* 用途ごとの授業用4段階判定。◎と○を正解として扱う。 */
const NETWORK_RATINGS = {
  video: {
    A: { mark: '◎', reason: '通信速度が速く、パケットロスもないので、動画を安定して再生しやすい。' },
    B: { mark: '○', reason: '通信速度は中程度だが、遅延が小さくパケットロスもないので、動画を見られる。' },
    C: { mark: '△', reason: '通信速度は速いが、パケットロスで映像が乱れたり止まったりする可能性がある。' }
  },
  game: {
    A: { mark: '△', reason: '通信速度は速いが、遅延が大きいため操作への反応が遅れやすい。' },
    B: { mark: '◎', reason: '遅延が小さくパケットロスもないので、操作が素早く確実に届きやすい。' },
    C: { mark: '×', reason: '遅延は小さいが、パケットロスによって操作が届かないことがある。' }
  },
  web: {
    A: { mark: '○', reason: '反応開始には少し待つが、通信速度が速く画像などを短時間で受信できる。' },
    B: { mark: '◎', reason: '遅延が小さくパケットロスもないため、ページを安定して表示しやすい。' },
    C: { mark: '○', reason: 'パケットロスで再送信が起こることはあるが、通信速度が速く遅延も小さいため、比較的快適に表示できる。' }
  }
};
const BASIS = ['通信速度', '遅延', 'パケットロス'];

const qArea = $('#questionArea');
QUESTIONS.forEach((q, qi) => {
  const box = document.createElement('div');
  box.className = 'question';
  box.dataset.kind = q.key;

  const choices = NETS.map((n) => `
    <label class="choice">
      <input type="radio" name="q${qi}" value="${n.id}">
      <span><strong>${n.id}</strong><small class="choice-mark" aria-live="polite"></small></span>
    </label>`).join('');

  const basis = BASIS.map((b) => `
    <label><input type="checkbox" class="basis" value="${b}">${b}</label>`).join('');

  box.innerHTML =
    `<p class="q-title">Q${qi + 1}　${q.title}</p>` +
    `<div class="choice-row">${choices}</div>` +
    `<p class="hint">根拠にした値（いくつでも）</p>` +
    `<div class="basis-row">${basis}</div>` +
    `<label class="field">理由<textarea rows="2" class="reason" placeholder="例：〜が〜だから"></textarea></label>` +
    `<p class="q-feedback"></p>`;
  qArea.appendChild(box);
});

qArea.addEventListener('change', (event) => {
  if (!event.target.matches('input[type=radio]')) return;
  const box = event.target.closest('.question');
  $$('.choice', box).forEach((choice) => {
    choice.classList.remove('rate-excellent', 'rate-good', 'rate-caution', 'rate-bad', 'is-answer');
    $('.choice-mark', choice).textContent = '';
  });
  $('.q-feedback', box).className = 'q-feedback';
  $('.q-feedback', box).textContent = '';
  $('#judgeStatus').textContent = '選び直しました。「判定を見る」を押してください。';
});

$('#judgeBtn').addEventListener('click', () => {
  let answered = 0;
  $$('.question', qArea).forEach((box) => {
    const kind = box.dataset.kind;
    const picked = $('input[type=radio]:checked', box);
    const fb = $('.q-feedback', box);
    fb.classList.add('show');

    if (!picked) {
      fb.textContent = 'まず A・B・C のどれかを選びましょう。';
      fb.className = 'q-feedback show feedback-warn';
      return;
    }
    answered++;
    const basisChecked = $$('.basis', box).filter((c) => c.checked).map((c) => c.value);
    $$('.choice', box).forEach((choice) => {
      const input = $('input', choice);
      const rating = NETWORK_RATINGS[kind][input.value];
      choice.classList.remove('rate-excellent', 'rate-good', 'rate-caution', 'rate-bad', 'is-answer');
      const rateClass = rating.mark === '◎' ? 'rate-excellent' : rating.mark === '○' ? 'rate-good' : rating.mark === '△' ? 'rate-caution' : 'rate-bad';
      choice.classList.add(rateClass);
      choice.classList.toggle('is-answer', input.checked);
      $('.choice-mark', choice).textContent = rating.mark;
    });
    const pickedRating = NETWORK_RATINGS[kind][picked.value];
    const isCorrect = pickedRating.mark === '◎' || pickedRating.mark === '○';
    const isClose = pickedRating.mark === '△';
    const verdictIcon = isCorrect ? '✓' : isClose ? '△' : '✕';
    const verdictText = isCorrect ? '正解です' : isClose ? '惜しいです' : '見直しましょう';
    const basisMsg = basisChecked.length
      ? `根拠：${basisChecked.join('・')}`
      : '根拠にした値にもチェックを入れましょう。';
    fb.className = `q-feedback show ${isCorrect ? 'feedback-correct' : isClose ? 'feedback-close' : 'feedback-wrong'}`;
    fb.innerHTML = `<strong class="answer-verdict">${verdictIcon} ${verdictText}：ネットワーク${picked.value} は ${pickedRating.mark}</strong>` +
      `<span>${pickedRating.reason}</span><small>${basisMsg}</small>`;
  });
  $('#judgeStatus').textContent = answered === QUESTIONS.length
    ? '3つとも判定しました。◎・○・△・×と、その理由を確かめよう。'
    : '未回答のQがあります。';
});

/* =========================================================
   Exit Ticket の言葉チェック
   ========================================================= */
const exitEl = $('#exitTicket');
exitEl.addEventListener('input', () => {
  const v = exitEl.value;
  let count = 0;
  $$('.word-chip').forEach((chip) => {
    const used = v.includes(chip.dataset.word);
    chip.classList.toggle('used', used);
    if (used) count++;
  });
  $('#wordCount').textContent = count >= 2
    ? `使った言葉：${count} / 3　よく書けています！`
    : `使った言葉：${count} / 3`;
});

/* =========================================================
   ワークシートの印刷
   ========================================================= */
function buildPrint() {
  const name = $('#studentName').value || '';
  const d = new Date();
  const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

  let rows = log.length
    ? log.map((r, i) =>
        `<tr><td>${i + 1}</td><td>${r.speed}</td><td>${r.lat}</td><td>${r.loss}</td>` +
        `<td>${r.sendSec.toFixed(2)}</td><td>${r.rtt}</td><td>${r.lost}</td></tr>`).join('')
    : '<tr><td colspan="7">（記録なし）</td></tr>';

  let answers = '';
  $$('.question', qArea).forEach((box, i) => {
    const picked = $('input[type=radio]:checked', box);
    const basis = $$('.basis', box).filter((c) => c.checked).map((c) => c.value).join('・') || '―';
    const reason = $('.reason', box).value || '';
    const rating = picked ? NETWORK_RATINGS[QUESTIONS[i].key][picked.value].mark : '―';
    answers += `<p class="p-ans"><strong>Q${i + 1} ${esc(QUESTIONS[i].title)}</strong><br>` +
               `選んだネットワーク：${picked ? picked.value : '―'}　／　判定：${rating}　／　根拠：${esc(basis)}<br>` +
               `理由：${esc(reason)}</p>`;
  });

  $('#printArea').innerHTML =
    `<h1>情報Ⅰ　パケット通信と通信品質　ワークシート</h1>` +
    `<p class="p-name">${date}　　氏名：${esc(name)}</p>` +
    `<h2>体験3　通信品質の記録</h2>` +
    `<table><thead><tr><th>回</th><th>通信速度<br>(Mbps)</th><th>遅延<br>(ms)</th><th>パケットロス<br>(%)</th>` +
    `<th>送信にかかった<br>時間(秒)</th><th>反応までの<br>時間(ms)</th><th>届かなかった<br>パケット数</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    `<h2>ペアで話したこと</h2><div class="p-box">${esc($('#pairMemo').value)}</div>` +
    `<h2>活用　どのネットワークを選ぶ？</h2>${answers}` +
    `<h2>まとめ・振り返り（Exit Ticket）</h2>` +
    `<p class="p-ans">オンライン授業で映像や音声が途切れたとき、どのような原因が考えられるか。` +
    `「通信速度」「遅延」「パケットロス」のうち2語以上を使って説明しよう。</p>` +
    `<div class="p-box">${esc(exitEl.value)}</div>`;
}

[$('#printBtn'), $('#printBtn2')].forEach((b) => b.addEventListener('click', () => {
  buildPrint();
  window.print();
}));
