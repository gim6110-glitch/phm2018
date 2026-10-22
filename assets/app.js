
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f4 = v => (v == null || !isFinite(v)) ? '—' : Number(v).toFixed(4);
const fnum = v => (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) ? '데이터 없음' : (typeof v === 'number' ? (Math.abs(v) >= 1000 ? String(Math.round(v*1000)/1000) : String(Math.round(v*10000)/10000)) : String(v));
const n0 = v => Number(v).toLocaleString('ko-KR');
const clock = () => { const d = new Date(); return d.toTimeString().slice(0,8) + '.' + String(d.getMilliseconds()).padStart(3,'0'); };
const store = { get(k){ try { return JSON.parse(localStorage.getItem('daa-classroom-v4:' + k)); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem('daa-classroom-v4:' + k, JSON.stringify(v)); } catch(e){} } };

/* ───────── 데이터 ───────── */
const META = new Set(['time','timestamp','row_id','data_role','Tool','stage','Lot','runnum','recipe','recipe_step','cycle_id','alarm','start_sensor','end_sensor','anomaly_score','reference_event','reference_window','reference_fault_name','data_source','source_tool','source_note','_t']);
const COND = ['Tool','stage','recipe','recipe_step','cycle_id','alarm','start_sensor','end_sensor'];
const S = { files: [], val: null, test: null, summary: null, bundleFiles: {}, sample: false, T1: null, T2: null, defT1: null, defT2: null, final: null, plans: { A: null, B: null }, log: [], sig: '' };

function quantile(sorted, q){ if(!sorted.length) return NaN; const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }
const judge = (s, t1, t2) => (typeof s !== 'number' || !Number.isFinite(s) || !Number.isFinite(t1) || !Number.isFinite(t2) || t1 >= t2) ? null : (s >= t2 ? 2 : s >= t1 ? 1 : 0);
const AI_NAME = ['일반 관찰','재검토','점검 요청','무효값'];

function parseCSV(text, name){
  const r = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true, transformHeader: h => h.replace(/^﻿/, '').trim() });
  const cols = r.meta.fields || [];
  const rows = r.data;
  return analyze({ name, kind: 'csv', cols, rows, parseErrors: r.errors.length });
}
function analyze(f){
  const { cols, rows } = f;
  f.timeCol = cols.includes('time') ? 'time' : cols.includes('timestamp') ? 'timestamp' : null;
  f.required = [
    { k: 'time 또는 timestamp', ok: !!f.timeCol },
    { k: 'row_id', ok: cols.includes('row_id') },
    { k: 'anomaly_score', ok: cols.includes('anomaly_score') },
    { k: 'data_role', ok: cols.includes('data_role') },
  ];
  f.sensors = cols.filter(c => !META.has(c) && rows.some(r => typeof r[c] === 'number'));
  f.conds = COND.filter(c => cols.includes(c));
  f.refs = ['reference_event','reference_window','reference_fault_name'].filter(c => cols.includes(c));
  f.missing = cols.map(c => [c, rows.reduce((a, r) => a + (r[c] === null || r[c] === undefined || r[c] === '' ? 1 : 0), 0)]).filter(x => x[1] > 0);
  const seen = new Set(); let dup = 0;
  rows.forEach(r => { const k = JSON.stringify(cols.map(c => r[c])); if (seen.has(k)) dup++; else seen.add(k); });
  f.dup = dup;
  if (f.timeCol){ const ts = rows.map(r => r[f.timeCol]).filter(v => v !== null && v !== undefined && v !== ''); f.tStart = ts[0]; f.tEnd = ts[ts.length - 1]; }
  const roles = [...new Set(rows.map(r => r.data_role).filter(Boolean))];
  f.roles = roles;
  const nm = f.name.toLowerCase();
  const bm = nm.match(/bundle[_\- ]?([abc])/i);
  if (bm) f.role = 'bundle' + bm[1].toUpperCase();
  else if (nm.includes('validation') || (roles.length === 1 && roles[0] === 'validation')) f.role = 'val';
  else if (nm.includes('test') || (roles.length === 1 && roles[0] === 'test')) f.role = 'test';
  else f.role = 'none';
  f.scores = rows.map(r => r.anomaly_score).filter(v => typeof v === 'number' && isFinite(v));
  return f;
}

function sensorStats(ds){
  const st = {};
  ds.sensors.forEach(c => { const v = ds.rows.map(r => r[c]).filter(x => typeof x === 'number' && isFinite(x)).sort((a,b) => a-b); st[c] = { p05: quantile(v, .05), p50: quantile(v, .5), p95: quantile(v, .95) }; });
  return st;
}

function applyFiles(){
  S.val = S.files.find(f => f.role === 'val') || null;
  S.test = S.files.find(f => f.role === 'test') || null;
  S.bundleFiles = {};
  S.files.filter(f => f.role.startsWith('bundle')).forEach(f => S.bundleFiles[f.role.slice(6)] = f);
  if (S.val){
    S.val.stats = sensorStats(S.val);
    const sorted = [...S.val.scores].sort((a,b) => a-b);
    S.sorted = sorted;
    const sm = S.summary;
    const dT1 = sm && Number.isFinite(sm.initial_T1) ? sm.initial_T1 : .50;
    const dT2 = sm && Number.isFinite(sm.initial_T2) ? sm.initial_T2 : .65;
    S.defT1 = dT1; S.defT2 = dT2;
    S.sig = S.val.name + '|' + S.val.rows.length + '|' + f4(dT1);
    const saved = store.get('th:' + S.sig);
    if (saved){ S.T1 = saved.T1; S.T2 = saved.T2; S.final = saved.final || null; S.plans = saved.plans || { A: null, B: null }; }
    else { S.T1 = dT1; S.T2 = dT2; S.final = null; S.plans = { A: null, B: null }; }
  } else { S.T1 = S.T2 = S.defT1 = S.defT2 = null; S.final = null; }
  buildBundles();
  renderAll();
}
function saveTh(){ if (S.sig) store.set('th:' + S.sig, { T1: S.T1, T2: S.T2, final: S.final, plans: S.plans }); }
const useT = () => S.final ? { T1: S.final.T1, T2: S.final.T2, fixed: true } : { T1: S.T1, T2: S.T2, fixed: false };

/* 9차시 묶음 — 검증 데이터의 실제 행을 자른다 (노트북 STEP 10과 같은 규칙) */
function buildBundles(){
  M.bundles = {};
  const { T1, T2 } = useT();
  ['A','B','C'].forEach(k => { const f=S.bundleFiles[k]; if(!f)return; const ss=f.scores; const ok=ss.length===f.rows.length && (k==='A'?ss.every(v=>v<T1):k==='B'?ss.some(v=>v>=T1)&&ss.every(v=>v<T2):ss.some(v=>v>=T2)&&ss.slice(0,Math.max(1,Math.floor(ss.length/3))).every(v=>v<T2)); if(ok&&f.conds.every(c=>new Set(f.rows.map(r=>r[c])).size===1))M.bundles[k]={rows:f.rows,src:'파일 '+f.name,ds:f}; });
  const src = S.val;
  if (src && T1 != null){
    const s = src.rows.map(r => r.anomaly_score);
    const n = s.length, step = n >= 180 ? 10 : 1;
    const wins = n >= 180 ? [90, 60, 30] : [Math.max(8, Math.floor(n / 4))];
    const rules = (win) => { const third = Math.max(1, Math.floor(win / 3)); return {
      A: w => w.every(v => v < T1),
      B: w => w.some(v => v >= T1) && !w.some(v => v >= T2),
      C: w => w.some(v => v >= T2) && w.slice(0, third).every(v => v < T2),
    }; };
    ['A','B','C'].forEach(k => {
      if (M.bundles[k]) return;
      for (const win of wins){
        const rule = rules(win)[k];
        for (let st = 0; st + win <= n; st += (win < 90 ? 5 : step)){
          if (rule(s.slice(st, st + win)) && src.conds.every(c=>new Set(src.rows.slice(st,st+win).map(r=>r[c])).size===1)){ M.bundles[k] = { rows: src.rows.slice(st, st + win), src: `검증 데이터 ${st}~${st + win - 1}행 (${win}행${win < 90 && n >= 180 ? ' — 90행 구간이 없어 줄임' : ''})`, ds: src }; return; }
        }
      }
      M.bundles[k] = { rows: [], src: '조건에 맞는 실제 구간이 없다 — 만들지 않음 (T1 · T2를 확인한다)', ds: src };
    });
  }
  if(S.sample && S.val){
    const demo={A:[.18,.25,.32,.38,.42,.48,.18,.25,.32,.38,.42,.48],B:[.18,.25,.32,.52,.58,.62,.18,.25,.32,.52,.58,.62],C:[.18,.25,.32,.71,.78,.66,.71,.78,.66,.71,.78,.66]};
    Object.entries(demo).forEach(([k,ss])=>{const ds=analyze({name:'가상 점수 '+k,cols:['time','row_id','data_role','anomaly_score'],rows:ss.map((s,i)=>({time:i+1,row_id:i,data_role:'validation',anomaly_score:s})),parseErrors:0});M.bundles[k]={rows:ds.rows,ds,src:'개념 연습용 가상 점수. 실측 센서 없음'};});
  }
  if (!M.playing) loadBundle(M.bundleKey, true);
}

/* ───────── 로그 ───────── */
function log(area, event, memo = ''){
  const e = { t: clock(), area, row: M.idx >= 0 && M.rows.length ? (M.rows[M.idx]?.row_id ?? M.idx) : '', score: M.idx >= 0 && M.rows[M.idx] ? f4(M.rows[M.idx].anomaly_score) : '', ai: area === '관제' ? (M.ai == null ? '' : M.ai) : '', safe: area === '관제' ? M.safety : '', state: area === '관제' ? M.state : '', event, memo };
  S.log.push(e);
  if (S.log.length > 2000) S.log.shift();
  store.set('log', S.log.slice(-600));
  renderMiniLog();
  if (!$('#p-log').hidden) renderLog();
}
function logCSV(){
  const head = ['시각','영역','행','이상점수','AI_STATUS','SAFETY_OK','설비 상태','조작 · 사건','메모'];
  const q = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [head.join(','), ...S.log.map(e => [e.t, e.area, e.row, e.score, e.ai, e.safe, e.state, e.event, e.memo].map(q).join(','))].join('\n');
}

/* ───────── 파일 저장 ───────── */
async function saveFile(filename, text, msgEl){
  let dl = null;
  try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch(e){ dl = null; }
  if (dl){
    try { await dl.save({ filename, data: text }); msgEl.textContent = '저장했다: ' + filename; return; }
    catch(e){ if (e && e.code === 'declined'){ msgEl.textContent = '저장을 취소했다.'; return; } }
  }
  if (!window.claude){
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); msgEl.textContent = '저장했다: ' + filename; return; } catch(e){}
  }
  $('#modal-title').textContent = filename;
  $('#modal-text').value = text;
  $('#modal-msg').textContent = '';
  $('#modal').hidden = false;
}
$('#modal-close').onclick = () => { $('#modal').hidden = true; };
$('#modal-copy').onclick = async () => {
  const ta = $('#modal-text');
  try { await navigator.clipboard.writeText(ta.value); $('#modal-msg').textContent = '복사했다.'; }
  catch(e){ ta.focus(); ta.select(); $('#modal-msg').textContent = '전체 선택했다. Ctrl+C로 복사한다.'; }
};

/* ───────── 탭 ───────── */
const TABS = ['intake','threshold','case','main','log'];
function showTab(id){
  TABS.forEach(t => { $('#tab-' + t).setAttribute('aria-selected', t === id); $('#p-' + t).hidden = t !== id; });
  store.set('tab', id);
  if (id === 'log') renderLog();
  if (id === 'case') renderCase();
  if (id === 'threshold') renderTh();
  if (id === 'main') renderMain(true);
}
TABS.forEach(t => $('#tab-' + t).onclick = () => { showTab(t); try { history.replaceState(null, '', '#' + t); } catch(e){} });
$('nav.tabs').addEventListener('keydown', e => {
  const i = TABS.findIndex(t => $('#tab-' + t).getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){ const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length; showTab(TABS[j]); $('#tab-' + TABS[j]).focus(); }
});

/* ───────── ① 데이터 접수실 ───────── */
const ROLE_NAME = { val: '검증(validation) — 기준 비교', test: '시험(test) — 마지막 확인', bundleA: '묶음 A', bundleB: '묶음 B', bundleC: '묶음 C', none: '사용 안 함' };
function renderIntake(){
  $('#sample-banner').hidden = !S.sample;
  const box = $('#file-cards');
  box.innerHTML = S.files.length ? '' : '<p class="small">아직 넣은 파일이 없다.</p>';
  S.files.forEach((f, i) => {
    const el = document.createElement('div'); el.className = 'filecard';
    const allOk = f.required.every(r => r.ok);
    el.innerHTML = `<header><b class="mono" style="overflow-wrap:anywhere">${esc(f.name)}</b>
      <select aria-label="파일 역할" data-i="${i}">${Object.entries(ROLE_NAME).map(([k, v]) => `<option value="${k}" ${k === f.role ? 'selected' : ''}>${v}</option>`).join('')}</select></header>
      <div class="chk">${f.required.map(r => `<span class="tag ${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✕'} ${esc(r.k)}</span>`).join('')}</div>
      ${allOk ? '' : '<div class="callout bad">필수 열이 없다. 없는 값을 채우거나 만들지 않는다 — AI LAB v2로 다시 저장했는지 확인한다.</div>'}
      <dl class="kv">
        <dt>행 · 열</dt><dd class="mono">${n0(f.rows.length)}행 · ${f.cols.length}열</dd>
        <dt>시간 범위</dt><dd class="mono">${f.timeCol ? esc(fnum(f.tStart)) + ' ~ ' + esc(fnum(f.tEnd)) + (S.sample ? ' (가상 순서)' : '') : '시간 열 없음'}</dd>
        <dt>결측</dt><dd>${f.missing.length ? f.missing.map(([c, n]) => `<span class="mono">${esc(c)}</span> ${n}칸`).join(' · ') : '없음'}</dd>
        <dt>완전 중복 행</dt><dd class="mono">${f.dup}건</dd>
        <dt>센서 (자동 인식)</dt><dd>${f.sensors.length ? f.sensors.map(c => `<span class="mono">${esc(c)}</span>`).join(', ') : '없음'}</dd>
        <dt>운전조건</dt><dd>${f.conds.length ? f.conds.map(c => `<span class="mono">${esc(c)}</span>`).join(', ') : '없음'}</dd>
        <dt>참고 표시</dt><dd>${f.refs.length ? f.refs.map(c => `<span class="mono">${esc(c)}</span>`).join(', ') + ' — 회색 점선으로만 표시' : '없음'}</dd>
      </dl>`;
    box.appendChild(el);
  });
  box.querySelectorAll('select').forEach(s => s.onchange = () => { const f = S.files[+s.dataset.i]; const old = f.role; if (s.value !== 'none') S.files.forEach(g => { if (g !== f && g.role === s.value) g.role = 'none'; }); f.role = s.value; log('접수', `역할 변경: ${f.name} ${ROLE_NAME[old]} → ${ROLE_NAME[f.role]}`); applyFiles(); });
  const mc = $('#model-card'); const sm = S.summary;
  if(S.sample){mc.innerHTML = '<h3>가상 점수 연습 안내</h3><p>활동지의 점수 12개로 기준선의 뜻을 연습합니다. 실제 센서값이나 학습된 모델의 성능을 나타내지 않습니다.</p><p class="small">기준 A: 0.50 / 0.65 · 기준 B: 0.60 / 0.70. 실제 장비 기록은 위의 실제 자료 불러오기를 선택하세요.</p>';}
  else if (sm){
    const L = [['1_data_source','데이터 출처'],['2_features','입력 변수'],['3_train_interval','학습 구간'],['4_preprocessing','전처리'],['5_algorithm','알고리즘'],['6_score_direction','점수 방향'],['7_known_limits','알려진 한계'],['8_version','버전']];
    mc.innerHTML = `<h3>모델 카드 (model_summary.json)</h3><dl class="kv">${L.map(([k, n]) => `<dt>${n}</dt><dd>${esc(Array.isArray(sm[k]) ? sm[k].join(', ') + ` (${sm[k].length}개)` : sm[k] ?? '데이터 없음')}</dd>`).join('')}
      <dt>초기 T1 · T2</dt><dd class="mono">${f4(sm.initial_T1)} · ${f4(sm.initial_T2)}</dd></dl>`;
  } else mc.innerHTML = '<h3>모델 카드</h3><p class="small">model_summary.json을 넣으면 모델 카드 8칸이 여기에 보인다. v4 모델 카드를 함께 넣는다. 카드가 없을 때의 0.50/0.65는 수동 연습값이며 실제 자료 기준으로 사용하기 전에 교사가 확인한다.</p>';
}
async function readFiles(list){
  try { await readFilesInner(list); } catch(e){ $('#intake-err').hidden = false; $('#intake-err').textContent = '파일을 읽는 중 문제가 생겼다: ' + (e && e.message || e); }
}
async function readFilesInner(list){
  const err = []; let added = 0;
  if (S.sample){ S.files = []; S.summary = null; S.sample = false; }
  for (const file of list){
    if(file.size>10*1024*1024){err.push(file.name+': 10MB 이하의 점수 파일을 선택하세요.');continue;}
    const text = await file.text();
    if (/\.json$/i.test(file.name)){
      try { const j = JSON.parse(text); if (Number.isFinite(j.initial_T1) && Number.isFinite(j.initial_T2) && j.initial_T1 < j.initial_T2){ S.summary = j; added++; log('접수', '모델 카드 불러옴: ' + file.name); } else err.push(file.name + ': model_summary 형식이 아니다'); }
      catch(e){ err.push(file.name + ': JSON을 읽을 수 없다'); }
    } else if (/\.csv$/i.test(file.name)){
      const f = parseCSV(text, file.name);
      if (!f.rows.length){ err.push(file.name + ': 행이 없다'); continue; }
      if(f.required.some(r=>!r.ok)||f.scores.length!==f.rows.length){err.push(file.name+': 필수 열 또는 유효한 이상점수가 없습니다. AI LAB의 결과 CSV를 선택하세요.');continue;}
      S.files = S.files.filter(g => g.name !== f.name);
      if (f.role !== 'none') S.files.forEach(g => { if (g.role === f.role) g.role = 'none'; });
      S.files.push(f); added++;
      log('접수', `불러옴: ${f.name} (${f.rows.length}행 · ${ROLE_NAME[f.role]})`);
    } else err.push(file.name + ': CSV 또는 JSON만 받는다');
  }
  $('#intake-err').hidden = !err.length; $('#intake-err').textContent = err.join(' / ');
  applyFiles();
}
$('#file-in').onchange = e => { readFiles([...e.target.files]); e.target.value = ''; };
const drop = $('#drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); readFiles([...e.dataTransfer.files]); });
function loadSample(){
  S.sample = true;
  S.files = [ parseCSV($('#sample-val').textContent.trim(), 'school_score_validation.csv (리허설 예시)'), parseCSV($('#sample-test').textContent.trim(), 'school_score_test.csv (리허설 예시)') ];
  S.files[0].role = 'val'; S.files[1].role = 'test';
  try { S.summary = JSON.parse($('#sample-summary').textContent); } catch(e){ S.summary = null; }
  applyFiles();
}
$('#btn-sample').onclick = () => { loadSample(); log('접수', '리허설 예시 불러옴 (합성 데이터 · 실측 아님)'); };

/* ───────── 차트 ───────── */
function scaleLin(d0, d1, r0, r1){ const k = (r1 - r0) / ((d1 - d0) || 1); return v => r0 + (v - d0) * k; }
function ticks(a, b, n){ const out = []; for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n); return out; }
function drawHist(svg, scores, T1, T2){
  const W = 640, H = 220, L = 44, R = 14, T = 22, B = 30;
  if (!scores.length){ svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle">검증 데이터가 없다</text>`; return; }
  const mn = Math.min(...scores, T1), mx = Math.max(...scores, T2), pad = (mx - mn) * 0.02 || 0.01;
  const a = mn - pad, b = mx + pad, nb = 40, bw = (b - a) / nb;
  const bins = new Array(nb).fill(0); scores.forEach(s => bins[Math.min(nb - 1, Math.floor((s - a) / bw))]++);
  const ym = Math.max(...bins), x = scaleLin(a, b, L, W - R), y = scaleLin(0, ym, H - B, T);
  let g = '';
  ticks(0, ym, 4).forEach(v => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; });
  bins.forEach((c, i) => { const c0 = a + (i + .5) * bw, z = c0 >= T2 ? 2 : c0 >= T1 ? 1 : 0; if (c) g += `<rect class="b${z}" x="${x(a + i * bw) + .5}" y="${y(c)}" width="${Math.max(1, x(a + bw) - x(a) - 1)}" height="${H - B - y(c)}"/>`; });
  ticks(a, b, 4).forEach(v => { g += `<text x="${x(v)}" y="${H - 10}" text-anchor="middle">${v.toFixed(3)}</text>`; });
  g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  const x1 = x(T1), x2 = x(T2), near = Math.abs(x2 - x1) < 70;
  g += `<line class="t1" x1="${x1}" x2="${x1}" y1="${T - 6}" y2="${H - B}"/><line class="t2" x1="${x2}" x2="${x2}" y1="${T - 6}" y2="${H - B}"/>`;
  g += `<text class="lt1" x="${x1 - 4}" y="${T - 8}" text-anchor="end">T1 ${T1.toFixed(4)}</text><text class="lt2" x="${x2 + 4}" y="${near ? T + 6 : T - 8}" text-anchor="start">T2 ${T2.toFixed(4)}</text>`;
  svg.innerHTML = g;
}
function drawLine(svg, rows, T1, T2, o = {}){
  const W = 640, H = o.h || 220, L = 44, R = 14, T = 16, B = 26;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const key = o.key || 'anomaly_score';
  const vals = rows.map(r => r[key]);
  const fin = vals.filter(v => typeof v === 'number' && isFinite(v));
  if (!fin.length){ svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle">${o.empty || '표시할 데이터가 없다'}</text>`; return; }
  let mn = Math.min(...fin), mx = Math.max(...fin);
  if (o.thr){ mn = Math.min(mn, T1); mx = Math.max(mx, T2); }
  if (o.band){ mn = Math.min(mn, o.band[0]); mx = Math.max(mx, o.band[1]); }
  const pad = (mx - mn) * 0.08 || 0.01; mn -= pad; mx += pad;
  const n = rows.length, x = scaleLin(0, Math.max(1, n - 1), L, W - R), y = scaleLin(mn, mx, H - B, T);
  let g = '';
  ticks(mn, mx, 3).forEach(v => { g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)}</text>`; });
  if (o.thr){ g += `<rect class="zone2" x="${L}" y="${T}" width="${W - R - L}" height="${Math.max(0, y(T2) - T)}"/><rect class="zone1" x="${L}" y="${y(T2)}" width="${W - R - L}" height="${Math.max(0, y(T1) - y(T2))}"/>`; }
  if (o.band) g += `<rect class="band" x="${L}" y="${y(o.band[1])}" width="${W - R - L}" height="${Math.max(0, y(o.band[0]) - y(o.band[1]))}"/>`;
  if (o.refs) rows.forEach((r, i) => { if (r.reference_event === 1) g += `<line class="ref" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/>`; });
  if (o.thr) g += `<line class="t1" x1="${L}" x2="${W - R}" y1="${y(T1)}" y2="${y(T1)}"/><line class="t2" x1="${L}" x2="${W - R}" y1="${y(T2)}" y2="${y(T2)}"/><text class="lt1" x="${W - R}" y="${y(T1) + 13}" text-anchor="end">T1</text><text class="lt2" x="${W - R}" y="${y(T2) - 4}" text-anchor="end">T2</text>`;
  const pts = (a, b) => { const p = []; for (let i = a; i <= b; i++){ const v = vals[i]; if (typeof v === 'number' && isFinite(v)) p.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); } return p.join(' '); };
  g += `<polyline class="${o.cls || 'ln'}" points="${pts(0, n - 1)}"/>`;
  if (o.played != null && o.played >= 0) g += `<polyline class="lnp" points="${pts(0, Math.min(o.played, n - 1))}"/>`;
  if (o.thr && n <= 1600) vals.forEach((v, i) => { if (isFinite(v) && v >= T1) g += `<circle class="d${v >= T2 ? 2 : 1}" cx="${x(i)}" cy="${y(v)}" r="${n > 400 ? 2 : 3}"/>`; });
  if (o.cursor != null && o.cursor >= 0){ g += `<line class="cur" x1="${x(o.cursor)}" x2="${x(o.cursor)}" y1="${T}" y2="${H - B}"/>`; const v = vals[o.cursor]; if (isFinite(v)) g += `<circle class="sel" cx="${x(o.cursor)}" cy="${y(v)}" r="5"/>`; }
  g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><text x="${L}" y="${H - 8}">${esc(o.xl0 || '0')}</text><text x="${W - R}" y="${H - 8}" text-anchor="end">${esc(o.xl1 || String(n - 1))}</text>`;
  if (o.title) g += `<text x="${L}" y="${T - 4}">${esc(o.title)}</text>`;
  svg.innerHTML = g;
}

/* ───────── ② 판정기준실 ───────── */
const counts = (scores, t1, t2) => { const c = [0,0,0]; scores.forEach(s => c[judge(s, t1, t2)]++); return c; };
let thLogTimer = null, thFrom = null;
function setT(which, v, src){
  if (S.final){ $('#th-msg').textContent = '확정된 상태다. 바꾸려면 아래에서 “확정 풀기”를 누른다.'; renderTh(); return; }
  v = Math.round(v * 10000) / 10000;
  if (!isFinite(v)) return;
  if (thFrom == null) thFrom = { T1: S.T1, T2: S.T2 };
  let msg = '';
  if (which === 't1'){ if (v >= S.T2){ v = Math.round((S.T2 - 0.0001) * 10000) / 10000; msg = 'T1은 T2보다 작아야 한다.'; } S.T1 = v; }
  else { if (v <= S.T1){ v = Math.round((S.T1 + 0.0001) * 10000) / 10000; msg = 'T2는 T1보다 커야 한다.'; } S.T2 = v; }
  $('#th-msg').textContent = msg;
  saveTh(); renderTh(src); buildBundles(); renderStrip();
  clearTimeout(thLogTimer);
  thLogTimer = setTimeout(() => { if (!thFrom) return; const c = counts(S.val.scores, S.T1, S.T2); log('기준', `T1 ${f4(thFrom.T1)}→${f4(S.T1)} · T2 ${f4(thFrom.T2)}→${f4(S.T2)} → N ${c[0]} · R ${c[1]} · A ${c[2]}`); thFrom = null; }, 900);
}
function renderTh(src){
  const has = !!S.val && S.val.scores.length;
  $('#th-body').style.display = has ? '' : 'none';
  let ph = $('#th-empty');
  if (!has){ if (!ph){ ph = document.createElement('p'); ph.id = 'th-empty'; ph.className = 'callout warn'; $('#p-threshold').appendChild(ph); } ph.textContent = '검증(validation) 파일이 없다. 데이터 접수실에서 score_validation.csv를 넣는다.'; return; }
  if (ph) ph.remove();
  const sc = S.val.scores, mn = Math.min(...sc,S.T1,S.final?.T1 ?? S.T1), mx = Math.max(...sc,S.T2,S.final?.T2 ?? S.T2);
  const { T1, T2 } = S.final ? S.final : S;
  [['t1', T1], ['t2', T2]].forEach(([k, v]) => {
    const r = $('#r-' + k), nIn = $('#n-' + k);
    r.min = mn; r.max = mx; r.step = 0.0001; if (src !== 'r-' + k) r.value = v; if (src !== 'n-' + k) nIn.value = v.toFixed(4);
    r.disabled = nIn.disabled = !!S.final;
  });
  $$('[data-nudge]').forEach(b => b.disabled = !!S.final);
  $('#btn-default').disabled = !!S.final;
  const c = counts(sc, T1, T2), d = counts(sc, S.defT1, S.defT2);
  ['N','R','A'].forEach((k, i) => { $('#c-' + k).textContent = n0(c[i]); const dd = c[i] - d[i]; $('#d-' + k).textContent = dd === 0 ? '기본값과 같음' : `기본값보다 ${dd > 0 ? '+' : ''}${dd}`; });
  $('#c-total').textContent = `검증 데이터 ${n0(sc.length)}건 · 기본값 T1 ${f4(S.defT1)} / T2 ${f4(S.defT2)} → N ${d[0]} · R ${d[1]} · A ${d[2]} · 점수 범위 ${f4(Math.min(...sc))} ~ ${f4(Math.max(...sc))}`;
  $('#slider-card').classList.toggle('locked', !!S.final);
  drawHist($('#hist'), sc, T1, T2);
  const tc = S.val.timeCol;
  drawLine($('#tline'), S.val.rows, T1, T2, { thr: true, refs: true, xl0: tc ? fnum(S.val.tStart) : '0', xl1: tc ? fnum(S.val.tEnd) : '' });
  // 안 비교
  const row = (name, p) => { if (!p) return `<tr><td><b>${name}</b></td><td colspan="6" class="small">아직 저장하지 않았다</td></tr>`; const q = counts(sc, p.T1, p.T2); return `<tr><td><b>${name}</b></td><td class="num">${f4(p.T1)}</td><td class="num">${f4(p.T2)}</td><td class="num">${q[0]}</td><td class="num">${q[1]}</td><td class="num">${q[2]}</td><td>${p.memo ? esc(p.memo) : ''}</td></tr>`; };
  $('#plan-tbl').innerHTML = `<tr><th>안</th><th class="num">T1</th><th class="num">T2</th><th class="num">NORMAL</th><th class="num">REVIEW</th><th class="num">ACTION</th><th>목적</th></tr>` +
    row('기본값', { T1: S.defT1, T2: S.defT2, memo: S.summary?.threshold_source?.startsWith('held-out') ? '학습에서 분리한 정상 추정 참조 후보' : S.summary?.threshold_source || '수동 연습 기준 · 교사 확인 필요' }) + row('안 A', S.plans.A) + row('안 B', S.plans.B) + row('지금', { T1, T2, memo: S.final ? '최종 확정' : '조정 중' });
  // 최종
  $('#btn-final').hidden = !!S.final; $('#btn-unfinal').hidden = !S.final;
  $('#final-msg').textContent = S.final ? `확정: T1 ${f4(S.final.T1)} · T2 ${f4(S.final.T2)} (${S.final.at}) — 관제 메인과 9차시 묶음이 이 값을 쓴다.` : '확정하면 관제 메인과 9차시 묶음이 이 값을 쓴다.';
  const why = $('#sub-why');
  if (!why.dataset.touched) why.value = `“T1 / T2를 ${f4(T1)} / ${f4(T2)}로 설정했다. 검증 데이터에서 ( 무엇이 몇 건 → 몇 건 )이(가) 변했고, (   ) 위험과 (   ) 업무량을 고려했다. 따라서 안 (   )를 최종안으로 선택했다.”`;
  const tb = $('#test-box');
  if (!S.test) tb.innerHTML = '시험(test) 파일이 없어 최종 확인을 할 수 없다.';
  else if (!S.final) tb.innerHTML = '<b>시험 데이터는 마지막에만.</b> 기준선을 확정한 뒤에 시험 데이터 결과가 열린다. 시험 결과를 보고 기준을 다시 고치지 않는다.';
  else { const t = counts(S.test.scores, S.final.T1, S.final.T2); tb.innerHTML = `<b>시험(test) 데이터 최종 확인</b> — ${n0(S.test.scores.length)}건: NORMAL ${t[0]} · REVIEW ${t[1]} · ACTION ${t[2]}. 이 결과를 보고 기준선을 다시 고치지 않는다(데이터 누출 방지).`; }
}
['A','B'].forEach(k=>$('#preset-'+k).onclick=()=>{
 if(!S.val||S.final)return;
 const p=S.summary?.['preset_'+k] || (k==='A'?{T1:.50,T2:.65}:{T1:.60,T2:.70});
 S.T1=p.T1;S.T2=p.T2;S.plans[k]={...p,memo:'교사 제공 비교 기준'};
 saveTh();renderTh();buildBundles();renderStrip();log('기준','준비된 '+k+' 선택',JSON.stringify(p));
});
['t1','t2'].forEach(k => {
  $('#r-' + k).addEventListener('input', e => setT(k, +e.target.value, 'r-' + k));
  $('#n-' + k).addEventListener('change', e => setT(k, +e.target.value, 'n-' + k));
});
$$('[data-nudge]').forEach(b => b.onclick = () => { const k = b.dataset.nudge; setT(k, (k === 't1' ? S.T1 : S.T2) + (+b.dataset.d)); });
$('#btn-default').onclick = () => { if (S.final) return; clearTimeout(thLogTimer); thFrom = { T1: S.T1, T2: S.T2 }; S.T1 = S.defT1; S.T2 = S.defT2; saveTh(); renderTh(); buildBundles(); renderStrip(); log('기준', `기본값으로 되돌림 T1 ${f4(S.T1)} · T2 ${f4(S.T2)}`); thFrom = null; };
['A','B'].forEach(k => $('#save-' + k).onclick = () => { const { T1, T2 } = S.final || S; S.plans[k] = { T1, T2, memo: k === 'A' ? '놓치지 않기' : '경보 줄이기' }; saveTh(); renderTh(); const c = counts(S.val.scores, T1, T2); log('기준', `안 ${k} 저장: T1 ${f4(T1)} · T2 ${f4(T2)} → N ${c[0]} · R ${c[1]} · A ${c[2]}`); });
$('#btn-final').onclick = () => { S.final = { T1: S.T1, T2: S.T2, at: clock().slice(0, 8) }; saveTh(); const c = counts(S.val.scores, S.T1, S.T2); log('기준', `최종 확정: T1 ${f4(S.T1)} · T2 ${f4(S.T2)} → N ${c[0]} · R ${c[1]} · A ${c[2]}`); buildBundles(); renderTh(); renderStrip(); };
$('#btn-unfinal').onclick = () => { log('기준', `확정 풀기 (이전 T1 ${f4(S.final.T1)} · T2 ${f4(S.final.T2)})`); S.final = null; saveTh(); buildBundles(); renderTh(); renderStrip(); };
$('#sub-why').addEventListener('input', e => e.target.dataset.touched = '1');
$('#btn-submit').onclick = () => {
  const { T1, T2 } = S.final || S; const c = counts(S.val.scores, T1, T2);
  const out = { team: $('#sub-team').value, '1_T1_T2': { T1, T2, fixed: !!S.final }, '2_metrics_validation': { NORMAL: c[0], REVIEW: c[1], ACTION: c[2], total: S.val.scores.length }, '3_reason': $('#sub-why').value, '4_uncertainty': $('#sub-unc').value, '5_version': $('#sub-ver').value, data_file: S.val.name, sample_data: S.sample, note: '이상점수는 확률이 아니다 · 기준은 검증 데이터로 정했다', saved_at: new Date().toISOString() };
  log('기준', '제출 파일 저장 요청', $('#sub-team').value);
  saveFile(`DAA_threshold_${($('#sub-team').value || 'team').replace(/[^A-Za-z0-9-]/g, '') || 'team'}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2), $('#sub-msg'));
};

/* ───────── ③ 사례 상세보기 ───────── */
let caseFilter = 'all', caseSel = null, caseSensor = null;
function renderCase(){
  const list = $('#case-list'), det = $('#case-detail');
  if (!S.val){ list.innerHTML = '<tr><td class="small">검증 파일이 없다.</td></tr>'; det.innerHTML = ''; return; }
  const { T1, T2 } = S.final || S, rows = S.val.rows, tc = S.val.timeCol;
  const items = rows.map((r, i) => ({ i, r, z: judge(r.anomaly_score, T1, T2) })).filter(o => o.z >= 1 && (caseFilter === 'all' || String(o.z) === caseFilter));
  list.innerHTML = `<tr><th>행</th><th>${tc ? esc(tc) : '시각'}</th><th class="num">이상점수</th><th>판정</th>${S.val.conds.includes('stage') ? '<th>stage</th>' : ''}</tr>` +
    (items.length ? items.map(o => `<tr class="click ${caseSel === o.i ? 'sel' : ''}" data-i="${o.i}" tabindex="0"><td class="num">${esc(o.r.row_id ?? o.i)}</td><td class="mono">${esc(fnum(tc ? o.r[tc] : ''))}</td><td class="num">${f4(o.r.anomaly_score)}</td><td><span class="tag ${o.z === 2 ? 'A' : 'R'}">${AI_NAME[o.z]}</span></td>${S.val.conds.includes('stage') ? `<td class="mono">${esc(fnum(o.r.stage))}</td>` : ''}</tr>`).join('') : '<tr><td colspan="5" class="small">현재 기준에서 검토 대상이 없다.</td></tr>');
  list.querySelectorAll('tr.click').forEach(tr => { const go = () => { caseSel = +tr.dataset.i; renderCase(); }; tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  if (caseSel == null || !rows[caseSel]){ det.innerHTML = '<h3>사례를 고른다</h3><p class="small">왼쪽 목록에서 REVIEW · ACTION 사례를 누르면 앞뒤 30행의 추세, 다른 센서 값, 운전조건이 보인다.</p>'; return; }
  const i = caseSel, r = rows[i], a = Math.max(0, i - 30), b = Math.min(rows.length - 1, i + 30), win = rows.slice(a, b + 1);
  if (!caseSensor || !S.val.sensors.includes(caseSensor)) caseSensor = S.val.sensors[0];
  const z = judge(r.anomaly_score, T1, T2), stt = S.val.stats[caseSensor];
  det.innerHTML = `<div class="row" style="justify-content:space-between"><h3 style="margin:0">행 ${esc(r.row_id ?? i)} · 이상점수 <span class="mono">${f4(r.anomaly_score)}</span> <span class="tag ${z === 2 ? 'A' : 'R'}">${AI_NAME[z]}</span></h3><span class="tiny mono">${tc ? esc(tc) + ' ' + esc(fnum(r[tc])) : ''}</span></div>
    <svg class="chart" id="cs-score" role="img" aria-label="선택 사례 앞뒤 이상점수"></svg>
    <div class="row"><label class="small" for="cs-sel">센서</label><select id="cs-sel">${S.val.sensors.map(c => `<option ${c === caseSensor ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><span class="tiny">파란 띠 = 검증 데이터의 자료 분포(5 ~ 95 %)</span></div>
    <svg class="chart" id="cs-sensor" role="img" aria-label="선택 센서 원값"></svg>
    <div class="tbl-wrap">${sensorTable(r, S.val)}</div>
    ${condBlock(r, S.val)}
    <label class="f">운영자 메모<textarea id="cs-memo" rows="2" placeholder="무엇을 보고 판단했는지 한 줄"></textarea></label>
    <div class="row"><button class="btn ok" data-cs="관찰 유지">관찰 유지</button><button class="btn warn" data-cs="점검 요청">점검 요청</button><button class="btn bad" data-cs="이상 대응">이상 대응</button><span class="small" id="cs-msg"></span></div>`;
  drawLine($('#cs-score'), win, T1, T2, { thr: true, refs: true, cursor: i - a, h: 180, xl0: '행 ' + (rows[a].row_id ?? a), xl1: '행 ' + (rows[b].row_id ?? b), title: '이상점수 · 앞뒤 30행' });
  drawLine($('#cs-sensor'), win, T1, T2, { key: caseSensor, cursor: i - a, h: 160, cls: 'ln2', band: [stt.p05, stt.p95], refs: true, xl0: '행 ' + (rows[a].row_id ?? a), xl1: '행 ' + (rows[b].row_id ?? b), title: caseSensor + ' 원값', empty: '이 센서 값이 없다' });
  $('#cs-sel').onchange = e => { caseSensor = e.target.value; renderCase(); };
  det.querySelectorAll('[data-cs]').forEach(bt => bt.onclick = () => { const memo = $('#cs-memo').value.trim(); log('검토', `행 ${r.row_id ?? i} (점수 ${f4(r.anomaly_score)} · ${AI_NAME[z]}) → ${bt.dataset.cs}`, memo); $('#cs-msg').textContent = `기록했다: ${bt.dataset.cs}`; });
}
$$('#case-filter button').forEach(b => b.onclick = () => { caseFilter = b.dataset.f; $$('#case-filter button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderCase(); });
function sensorTable(r, ds){
  const st = ds.stats || sensorStats(ds);
  return `<table><tr><th>센서</th><th class="num">지금 값</th><th class="num">자료 분포 (검증 5~95%, 정상 기준 아님)</th><th>비교</th></tr>${ds.sensors.map(c => { const v = r[c], s = st[c]; const ok = typeof v === 'number' && isFinite(v); const out = ok && (v < s.p05 || v > s.p95); return `<tr><td class="mono">${esc(c)}</td><td class="num">${ok ? esc(fnum(v)) : '데이터 없음'}</td><td class="num">${esc(fnum(s.p05))} ~ ${esc(fnum(s.p95))}</td><td>${!ok ? '' : out ? `<span class="tag R">자료 분포 밖 ${v > s.p95 ? '↑' : '↓'}</span>` : '<span class="tag N">범위 안</span>'}</td></tr>`; }).join('')}</table>`;
}
function condBlock(r, ds){
  if (!ds.conds.length) return '<p class="tiny">운전조건 열이 없다.</p>';
  return `<dl class="kv">${ds.conds.map(c => `<dt>${esc(c)}</dt><dd class="mono">${esc(fnum(r[c]))}</dd>`).join('')}</dl>`;
}

/* ───────── ④ 관제 메인 — PC + PLC 모의 ───────── */
const M = { bundles: {}, bundleKey: 'A', rows: [], ds: null, idx: -1, playing: false, speed: 1, nextAt: 0,
  safety: 1, state: 'READY', latched: false, checkHold: false, suppress: false, ai: null,
  buzzer: 'off', acked: false, pulseUntil: 0, alive: 0, aliveAt: Date.now(), commLost: false,
  inject: 0, outHist: [], shownOut: null, rs: { s1: false, s2: false, s3: false }, preReset: null, sound: false };
const STATE_DESC = { READY: '운전 대기 · 허가를 확인한 뒤 별도 START', RUN: '운전 · 정상 관찰', WARNING: '경고 · 운전 유지, 2차 검토', CHECK: '점검 요청 · 새 시작 불가', STOP: '모의 정지 · RESET 절차로만 해제 (래치)', RESET: '복구 확인 중 · 4단계' };
function say(t){ $('#say').textContent = t; }
function loadBundle(k, quiet){
  M.bundleKey = k; const b = M.bundles[k];
  M.rows = b ? b.rows : []; M.ds = b ? b.ds : null; M.idx = M.rows.length ? 0 : -1; M.playing = false; const t=useT(); M.ai=M.rows.length ? judge(M.rows[0].anomaly_score,t.T1,t.T2) : null; if(!['STOP','RESET','CHECK'].includes(M.state)) M.state='READY';
  $$('#bundle-seg button').forEach(x => x.setAttribute('aria-pressed', x.dataset.b === k));
  if (!quiet) log('관제', `묶음 ${k} 준비 (${M.rows.length}행)`);
  renderMain(true);
}
function scan(cause){
  if (M.ai !== 2) M.suppress = false;
  if (!M.safety){ if (M.state !== 'STOP') enterStop(cause || 'R1 · SAFETY_OK = 0'); return; }
  if (M.state === 'STOP' || M.state === 'RESET') return;
  if (M.checkHold){ setState('CHECK'); return; }
  if (M.commLost){ enterCheck('R2 · 통신 이상 (PC_ALIVE 3초 무변화)'); return; }
  if (M.ai == null){ enterCheck('현재 유효한 이상점수 없음'); return; }
  if (M.ai === 3){ enterCheck('R2 · AI 무효값 11'); return; }
  if (M.ai === 2 && !M.suppress){ enterCheck('R2 · AI_STATUS = 2'); return; }
  setState(!M.playing ? 'READY' : M.ai === 1 || M.ai === 2 ? 'WARNING' : 'RUN', M.ai === 2 ? 'R3 · 관찰 유지 중 (ACTION 구간)' : M.ai === 1 ? 'R3 · AI_STATUS = 1' : 'R4');
}
function setState(s, why){
  if (M.state === s) return;
  const prev = M.state; M.state = s;
  if (s !== 'STOP') M.acked = false;
  log('관제', `${prev} → ${s}${why ? ' · ' + why : ''}`);
  if (s === 'WARNING') say('YELLOW — 2차 검토 패널이 열렸다. 다른 센서와 운전조건을 본다.');
  if (s === 'RUN' && prev === 'WARNING') say('GREEN으로 돌아왔다.');
}
function enterCheck(why){
  M.playing = false; M.checkHold = true; const prev = M.state; M.state = 'CHECK';
  M.buzzer = 'pulse'; M.pulseUntil = Date.now() + 700; M.acked = false; beep(0.35);
  log('관제', `${prev} → CHECK · ${why}`); log('관제', 'BUZZER = 단속 1회 · PERMIT = 제한');
  say('CHECK — 2차 검토 결과를 기록해야 풀린다. ACK는 부저만 끈다.');
}
function enterStop(why){
  const prev = M.state; M.latched = true; M.checkHold = false; M.state = 'STOP'; M.buzzer = 'cont'; M.acked = false;
  if (M.playing){ M.playing = false; }
  M.rs = { s1: false, s2: false, s3: false };
  log('관제', `${prev} → STOP · ${why}`); log('관제', 'BUZZER = 연속 · PERMIT = 차단 · 재생 정지(모의 정지)');
  say(M.safety ? 'STOP — 운영자 이상 대응으로 모의 정지했다. RESET 절차로만 풀린다.' : 'STOP — R1 안전 우선. AI 판정과 상관없이 멈춘다.');
}
function canStart(){ return ['READY','RUN','WARNING'].includes(M.state) && M.safety===1 && !M.latched && !M.checkHold && !M.commLost && Number.isInteger(M.ai) && M.ai>=0 && M.ai<=1 && M.rows.length>0; }
function outputs(){
  const s = M.state, now = Date.now();
  const lamp = s === 'RUN' ? { g: 'on' } : s === 'WARNING' ? { y: 'on' } : s === 'CHECK' ? { y: 'blink' } : s === 'STOP' ? { r: 'on' } : s === 'READY' ? {} : { g: 'blink' };
  let bz = 'off';
  if (s === 'STOP') bz = M.acked ? 'ack' : 'cont';
  else if (now < M.pulseUntil) bz = 'pulse';
  const pm = s === 'READY' ? (canStart() ? 'ON' : '차단') : s === 'RUN' ? 'ON' : s === 'WARNING' ? '유지' : s === 'CHECK' ? '제한' : '차단';
  return { s, lamp, bz, pm };
}
const outKey = o => JSON.stringify(o);
function tick(){
  const now = Date.now();
  // PC_ALIVE 하트비트 (0.5초마다 토글) — INJECT 01이면 멈춘다
  if (M.inject !== 1 && now - M.aliveAt >= 1000){ M.alive ^= 1; M.aliveAt = now; }
  // PLC 통신 감시: 3초 동안 바뀌지 않으면 통신 이상
  if (!M.commLost && now - M.aliveAt > 3000){ M.commLost = true; log('관제', 'COMM_LOSS · PC_ALIVE 3초 무변화'); scan(); }
  // 재생
  if (M.playing && !M.commLost && now >= M.nextAt){ advance(); M.nextAt = now + 1000 / M.speed; }
  // PLC 출력 (INJECT 02: 1초 늦게 반영)
  const o = outputs(), k = outKey(o);
  if (!M.outHist.length || M.outHist[M.outHist.length - 1].k !== k) M.outHist.push({ t: now, o, k });
  let shown = M.outHist[M.outHist.length - 1];
  if (M.inject === 2){ for (let i = M.outHist.length - 1; i >= 0; i--){ if (M.outHist[i].t <= now - 1000){ shown = M.outHist[i]; break; } if (i === 0) shown = M.outHist[0]; } }
  if (M.outHist.length > 40) M.outHist.splice(0, M.outHist.length - 40);
  if (!M.shownOut || M.shownOut.k !== shown.k){ if (M.inject === 2 && M.shownOut) log('관제', `PLC 출력 반영 (${((now - shown.t) / 1000).toFixed(1)}초 늦음) → ${shown.o.s}`); M.shownOut = shown; }
  if (M.buzzer === 'cont' && !M.acked && M.state === 'STOP' && M.sound && now % 1000 < 100) beep(0.25);
  paintPLC(shown.o);
  paintPC();
}
function advance(){
  if (M.idx >= M.rows.length - 1){ M.playing = false; scan(); log('관제', '<END> 묶음 재생 끝'); say('재생이 끝났다.'); renderMain(); return; }
  M.idx++;
  const r = M.rows[M.idx], t = useT();
  M.ai = M.inject === 4 ? 3 : judge(r.anomaly_score, t.T1, t.T2);
  if (M.ai == null){ enterCheck('현재 점수 없음 — 시작 차단'); renderMain(); return; }
  if (M.idx % 15 === 0) log('관제', '주기 기록');
  scan();
  renderMain();
}
function paintPLC(o){
  ['r','y','g'].forEach(c => { const el = $('#L-' + c), v = o.lamp[c]; el.classList.toggle('on', !!v); el.classList.toggle('blink', v === 'blink'); });
  $('#state-big').textContent = o.s; $('#state-desc').textContent = STATE_DESC[o.s] + (M.inject === 2 ? ' · 표시 지연 중' : '');
  const bz = { off: ['무음', ''], pulse: ['단속 1회', 'y'], cont: ['연속', 'r flash'], ack: ['무음 (ACK) · 상태는 STOP', ''] }[o.bz];
  $('#bz').textContent = bz[0]; $('#bz-dot').className = 'dot ' + bz[1];
  $('#pm').textContent = o.pm; $('#pm-dot').className = 'dot ' + (o.pm === 'ON' || o.pm === '유지' ? 'g' : o.pm === '제한' ? 'y' : 'r');
  const pill = $('#st-state'); pill.className = 'pill ' + o.s; pill.querySelector('span').textContent = o.s;
  $$('#rules tr[data-r]').forEach(tr => tr.classList.toggle('on', tr.dataset.r === ({ STOP: 'R1', CHECK: 'R2', WARNING: 'R3', RUN: 'R4', RESET: 'RS' })[o.s]));
  // 버튼
  const permitOK = canStart();
  $('#btn-start').disabled = !permitOK || !M.rows.length || M.playing || M.commLost || M.idx >= M.rows.length - 1;
  $('#btn-pause').disabled = !M.playing;
  $('#btn-init').disabled = ['STOP','RESET','CHECK'].includes(M.state) || M.playing;
  $('#btn-reset').disabled = !(M.state === 'STOP' || M.state === 'CHECK');
  $$('#bundle-seg button').forEach(b => b.disabled = ['STOP','RESET','CHECK'].includes(M.state) || M.playing);
  $('#btn-start').title = permitOK ? '' : 'PERMIT ' + o.pm + ' — 새 시작 불가';
}
function paintPC(){
  const al = $('#alive'); al.className = 'alive ' + (M.commLost ? 'lost' : M.alive ? 'b' : '');
  al.querySelector('span').textContent = M.inject === 1 ? 'PC_ALIVE 멈춤' : 'PC_ALIVE';
  const lostFor = M.inject === 1 && !M.commLost ? ((Date.now() - M.aliveAt) / 1000).toFixed(1) : null;
  const cb = $('#comm-box');
  if (M.commLost){ cb.className = 'callout bad'; cb.textContent = '통신 이상 — PLC가 PC 신호를 3초 넘게 받지 못했다. 재생이 멈췄고 CHECK로 갔다.' + (M.inject === 1 ? ' [주입 복구]로 신호를 되살린다.' : ''); }
  else if (lostFor){ cb.className = 'callout warn'; cb.textContent = `PC 신호가 끊겼다 — ${lostFor}초 경과. 3초가 되면 PLC가 통신 이상으로 본다.`; }
  else { cb.className = 'callout info'; cb.textContent = '통신 정상 · PC_ALIVE가 3초 동안 바뀌지 않으면 PLC는 통신 이상으로 보고 CHECK로 간다.'; }
}
function renderMain(full){
  const b = M.bundles[M.bundleKey]; const t = useT();
  $('#bundle-info').textContent = b ? `묶음 ${M.bundleKey}: ${b.src} · 판정에 쓰는 T1 ${f4(t.T1)} / T2 ${f4(t.T2)}${t.fixed ? ' (최종 확정값)' : ' (아직 확정 전 — 판정기준실 현재값)'}` : '검증자료에서 묶음을 만든다. 데이터 접수실에서 score_validation.csv를 넣는다.';
  const r = M.idx >= 0 ? M.rows[M.idx] : null;
  $('#pc-score').textContent = r ? f4(r.anomaly_score) : '—';
  const ai = M.ai;
  $('#pc-ai').innerHTML = ai == null ? '<span class="small">대기 (다음 행)</span>' : `<span class="tag ${ai === 2 ? 'A' : ai === 1 ? 'R' : ai === 3 ? 'A' : 'N'}">${ai} · ${AI_NAME[ai]}</span>`;
  const bits = ai == null ? [0, 0] : [ai >> 1 & 1, ai & 1];
  $('#b1').textContent = bits[0]; $('#b0').textContent = bits[1]; $('#b1').classList.toggle('on', !!bits[0]); $('#b0').classList.toggle('on', !!bits[1]);
  $('#pc-row').textContent = `행 ${M.idx + 1} / ${M.rows.length}` + (r && r.row_id != null ? ` · row_id ${r.row_id}` : '');
  const tc = M.ds && M.ds.timeCol; $('#pc-t').textContent = r && tc ? `${tc} ${fnum(r[tc])}` : '';
  $('#prog').style.width = M.rows.length ? ((M.idx + 1) / M.rows.length * 100) + '%' : '0';
  drawLine($('#trend'), M.rows, t.T1 ?? 0, t.T2 ?? 1, { thr: t.T1 != null, played: M.idx, cursor: M.idx, h: 200, xl0: '1행', xl1: M.rows.length + '행', empty: '재생할 묶음이 없다' });
  // 2차 검토 패널
  const rv = $('#review-panel'); const showRv = (M.state === 'WARNING' && r) || M.state === 'CHECK';
  rv.hidden = !showRv;
  if (showRv){
    $('#rv-why').textContent = M.state === 'CHECK' ? 'CHECK — 결과를 기록해야 풀린다. 관찰 유지 / 점검 요청 / 이상 대응 중 하나를 고른다.' : 'WARNING — 운전은 유지된다. 지금 행의 다른 센서와 운전조건을 확인한다.';
    $('#rv-tbl').innerHTML = r && M.ds ? sensorTable(r, S.val && S.val.sensors.join() === M.ds.sensors.join() ? S.val : M.ds) + `<p class="tiny" style="margin-top:6px">이 범위는 혼합 검증자료의 분포이며 정상 한계값이 아니다. 같은 운전조건인지 먼저 확인한다. 운전조건: ${M.ds.conds.map(c => esc(c) + ' ' + esc(fnum(r[c]))).join(' · ') || '없음'}</p>` : '<p class="small">재생 중인 행이 없다 — 신호 이상(통신 · 무효값)으로 들어온 CHECK다.</p>';
  }
  // RESET 패널
  const rp = $('#reset-panel'); rp.hidden = M.state !== 'RESET';
  if (M.state === 'RESET'){
    $('#rs1').classList.toggle('done', M.rs.s1); $('#rs2').classList.toggle('done', M.rs.s2); $('#rs3').classList.toggle('done', M.rs.s3);
    $('#rs2-btn').disabled = !M.rs.s1; $('#rs3-btn').disabled = !(M.rs.s1 && M.rs.s2); $('#rs4-btn').disabled = !M.rs.s3;
  }
  // 고장 주입
  $$('[data-inj]').forEach(bt => { const k = +bt.dataset.inj; bt.setAttribute('aria-pressed', M.inject === k); bt.disabled = M.inject !== 0 && M.inject !== k; });
  $('#inj-clear').disabled = !M.inject;
  // 스위치
  const sw = $('#sw-safe'); sw.setAttribute('aria-checked', !!M.safety); $('#sw-txt').textContent = M.safety ? '1' : '0';
  $('#sw-desc').textContent = M.safety ? '1 = 비상정지 b접점 닫힘 · 도어 닫힘 (안전 영역)' : '0 = 비상정지 눌림 · 단선 · 도어 열림 (안전 위반)';
  paintPLC(M.shownOut ? M.shownOut.o : outputs());
}
$$('#bundle-seg button').forEach(b => b.onclick = () => loadBundle(b.dataset.b));
$$('#speed-seg button').forEach(b => b.onclick = () => { M.speed = +b.dataset.s; $$('#speed-seg button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
$('#btn-start').onclick = () => { scan(); if (!canStart()) { renderMain(); return; } M.playing = true; scan(); M.nextAt = 0; log('관제', `[시작] 묶음 ${M.bundleKey} 재생 (${M.speed}×)`); say(''); renderMain(); };
$('#btn-pause').onclick = () => { M.playing = false; scan(); log('관제', '[멈춤]'); renderMain(); };
$('#btn-init').onclick = () => { loadBundle(M.bundleKey, true); log('관제', `[초기화] 묶음 ${M.bundleKey} 처음으로`); };
$('#sw-safe').onclick = () => { setSafety(M.safety ? 0 : 1, '스위치'); };
function setSafety(v, by){
  M.safety = v; log('관제', `SAFETY_OK → ${v} (${by})`);
  if (!v) scan(M.state === 'RESET' ? 'RESET 중 SAFETY_OK = 0' : by.startsWith('INJECT') ? 'R1 · INJECT 03 안전 위반' : 'R1 · SAFETY_OK = 0');
  else if (M.state === 'STOP') say('SAFETY_OK가 1로 돌아왔지만 STOP은 그대로다(래치). RESET 4단계를 진행한다.');
  else scan();
  renderMain();
}
$('#btn-ack').onclick = () => {
  if (M.state === 'STOP' && !M.acked){ M.acked = true; log('관제', 'ACK — 부저만 정지 · 램프와 STOP은 그대로'); say('ACK는 부저만 끈다. 상태는 여전히 STOP이다.'); }
  else { log('관제', 'ACK — 울리고 있는 부저가 없다'); say('지금 울리는 부저가 없다.'); }
  renderMain();
};
$('#btn-reset').onclick = () => {
  if (!(M.state === 'STOP' || M.state === 'CHECK')) return;
  M.preReset = { state: M.state, latched: M.latched, checkHold: M.checkHold };
  M.rs = { s1: false, s2: false, s3: false }; M.playing = false;
  const prev = M.state; M.state = 'RESET'; log('관제', `${prev} → RESET · 복구 확인 시작`);
  $('#rs-msg').textContent = ''; $('#rs2-memo').value = '';
  say('RESET — 아래 4단계를 순서대로 진행한다.');
  renderMain();
  const rp = $('#reset-panel'); rp.classList.remove('flashbox'); void rp.offsetWidth; rp.classList.add('flashbox'); rp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#rs1-btn').onclick = () => { if (!M.safety){ $('#rs-msg').textContent = 'SAFETY_OK가 0이다. 스위치를 1로 돌린 뒤 확인한다.'; log('관제', 'RESET ① 실패 — SAFETY_OK = 0'); return; } M.rs.s1 = true; $('#rs-msg').textContent = ''; log('관제', 'RESET ① SAFETY_OK = 1 확인'); renderMain(); };
$('#rs2-btn').onclick = () => { const m = $('#rs2-memo').value.trim(); if (m.length < 2){ $('#rs-msg').textContent = '원인 메모를 한 줄 적는다.'; return; } M.rs.s2 = true; M.rsMemo = m; $('#rs-msg').textContent = ''; log('관제', 'RESET ② 원인 메모', m); renderMain(); };
$('#rs3-btn').onclick = () => { if(M.state!=='RESET'||!M.rs.s1||!M.rs.s2||M.rs.s3)return; M.buzzer='off'; M.rs.s3=true; log('관제','RESET ③ 복구 확인 준비',M.rsMemo||''); renderMain(); };
$('#rs4-btn').onclick = () => {
  if(M.state!=='RESET'||!M.rs.s1||!M.rs.s2||!M.rs.s3)return;
  if(!M.safety){enterStop('RESET 완료 시 안전조건 미충족');renderMain();return;}
  M.playing=false; M.latched=false; M.checkHold=false; M.suppress=false; M.state='READY';
  // Keep the current score: never reset AI to null or skip an unresolved ACTION.
  scan(); log('관제','RESET 완료 · 현재 조건 재확인 · '+M.state);
  say(M.state==='READY'?'운전 대기입니다. 시작하려면 별도 START를 누릅니다.':'점검 또는 신호 조건이 남았습니다. 시작을 차단합니다.');renderMain();
};
$('#rs-cancel').onclick = () => { const p = M.preReset; if (!p) return; M.state = p.state; M.latched = p.latched; M.checkHold = p.checkHold; if (p.state === 'STOP'){ M.buzzer = 'cont'; } log('관제', `RESET 취소 → ${p.state}`); renderMain(); };
$$('[data-rv]').forEach(bt => bt.onclick = () => {
  const memo = $('#rv-memo').value.trim(), k = bt.dataset.rv;
  if (k === 'keep'){
    log('관제', 'REVIEW = 관찰 유지', memo);
    if(M.state==='CHECK'){ if(memo.length<2||M.ai==null||M.ai>=2||M.commLost){say('현재 점검·신호 조건을 먼저 해결하고 확인 근거를 기록합니다. ACTION이 남으면 시작할 수 없습니다.');return;} M.checkHold=false;M.suppress=false;scan(); }
    say(M.commLost ? '통신이 아직 끊겨 있어 CHECK가 유지된다.' : '관찰 유지를 기록했다.');
  } else if (k === 'check'){ log('관제', 'REVIEW = 점검 요청', memo); if (M.state !== 'CHECK') enterCheck('운영자 점검 요청'); }
  else { log('관제', 'REVIEW = 이상 대응', memo); enterStop('운영자 이상 대응 (모의 정지)'); }
  $('#rv-memo').value = ''; renderMain();
});
$$('[data-inj]').forEach(bt => bt.onclick = () => {
  const k = +bt.dataset.inj; if (M.inject) return;
  M.inject = k;
  if (k === 1){ log('관제', 'INJECT 01 — PC 신호 끊기 (PC_ALIVE 멈춤)'); say('PC 신호를 끊었다. 3초를 세어 본다.'); }
  if (k === 2){ const o = outputs(); M.outHist = [{ t: Date.now() - 1000, o, k: outKey(o) }]; log('관제', 'INJECT 02 — PLC 응답 지연 1초'); say('이제 표시등이 화면 판정보다 1초 늦게 따라온다.'); }
  if (k === 3){ log('관제', 'INJECT 03 — SAFETY_OK = 0'); setSafety(0, 'INJECT 03'); }
  if (k === 4){ log('관제', '추가 실험 — AI 무효값 11 보내기'); M.ai = 3; scan(); say('PC가 11을 보낸다. 11은 위험도가 아니라 잘못된 신호다.'); }
  renderMain();
});
$('#inj-clear').onclick = () => {
  const k = M.inject; M.inject = 0;
  if (k === 1){ M.aliveAt = Date.now(); if (M.commLost){ M.commLost = false; log('관제', 'COMM_OK · PC_ALIVE 복구 — CHECK는 검토 기록 전까지 유지'); } else log('관제', 'INJECT 01 복구 (3초 전에 복구)'); }
  if (k === 2) log('관제', 'INJECT 02 복구 — 지연 없음');
  if (k === 3){ log('관제', 'INJECT 03 복구'); setSafety(1, 'INJECT 03 복구'); }
  if (k === 4){ log('관제', '무효값 실험 복구'); if (M.idx >= 0){ const t = useT(); M.ai = judge(M.rows[M.idx].anomaly_score, t.T1, t.T2); } else M.ai = null; }
  renderMain();
};
/* 소리 (선택) */
let actx = null;
function beep(sec){ if (!M.sound) return; try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = 0.05; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + sec); } catch(e){} }
$('#btn-sound').onclick = e => { M.sound = !M.sound; e.currentTarget.setAttribute('aria-pressed', M.sound); e.currentTarget.textContent = M.sound ? '소리 끄기' : '소리 켜기'; if (M.sound) beep(0.08); };

function renderMiniLog(){
  const L = S.log.filter(e => e.area === '관제').slice(-14);
  const el = $('#minilog'); el.textContent = L.length ? L.map(e => `${e.t}  ${e.ai !== '' ? 'AI=' + e.ai + ' ' : ''}SAFE=${e.safe} ${e.state}  ${e.event}${e.memo ? ' · ' + e.memo : ''}`).join('\n') : '아직 기록이 없다.';
  el.scrollTop = el.scrollHeight;
}

/* ───────── ⑤ 활동 로그 ───────── */
let logFilter = 'all', clearArm = false;
function renderLog(){
  const L = S.log.filter(e => logFilter === 'all' || e.area === logFilter);
  $('#log-tbl').innerHTML = `<tr><th>시각</th><th>영역</th><th class="num">행</th><th class="num">이상점수</th><th class="num">AI</th><th class="num">SAFE</th><th>설비 상태</th><th>조작 · 사건</th><th>메모</th></tr>` +
    (L.length ? L.slice(-400).reverse().map(e => `<tr><td class="mono">${e.t}</td><td>${e.area}</td><td class="num">${esc(e.row)}</td><td class="num">${esc(e.score)}</td><td class="num">${esc(e.ai)}</td><td class="num">${esc(e.safe)}</td><td class="mono">${esc(e.state)}</td><td>${esc(e.event)}</td><td>${esc(e.memo)}</td></tr>`).join('') : '<tr><td colspan="9" class="small">아직 기록이 없다.</td></tr>');
}
$$('#log-filter button').forEach(b => b.onclick = () => { logFilter = b.dataset.f; $$('#log-filter button').forEach(x => x.setAttribute('aria-pressed', x === b)); renderLog(); });
$('#log-save').onclick = () => saveFile(`DAA_control_room_log_${new Date().toISOString().slice(0, 10)}.csv`, logCSV(), $('#log-msg'));
$('#log-clear').onclick = e => {
  if (!clearArm){ clearArm = true; e.currentTarget.textContent = '정말 비우기'; $('#log-msg').textContent = '한 번 더 누르면 지운다. 저장했는지 확인한다.'; setTimeout(() => { clearArm = false; $('#log-clear').textContent = '로그 비우기'; $('#log-msg').textContent = ''; }, 4000); return; }
  S.log = []; store.set('log', []); clearArm = false; e.currentTarget.textContent = '로그 비우기'; $('#log-msg').textContent = '비웠다.'; renderLog(); renderMiniLog();
};

/* ───────── 상단 띠 ───────── */
function renderStrip(){
  const used = S.files.filter(f => f.role !== 'none');
  $('#st-src').innerHTML = S.sample ? '<span class="src-sample">리허설용 합성 예시 · 실측 아님</span>' : used.length ? esc(used[0].name) + (used.length > 1 ? ` 외 ${used.length - 1}개` : '') : '파일 없음';
  const t = useT(); $('#st-t').textContent = t.T1 == null ? '—' : `T1 ${f4(t.T1)} · T2 ${f4(t.T2)}${t.fixed ? ' · 확정' : ' · 조정 중'}`;
}
function renderAll(){ renderStrip(); renderIntake(); renderTh(); renderCase(); renderMain(true); renderMiniLog(); }


$('#quick-5').onclick=()=>{showTab('threshold');$('#tab-threshold').scrollIntoView({behavior:'smooth',block:'start'});};
$('#quick-9').onclick=()=>{loadSample();showTab('main');$('#tab-main').scrollIntoView({behavior:'smooth',block:'start'});log('안내','9차시 가상 점수 연습으로 전환');};
$('#btn-real').onclick=async()=>{
 const b=$('#btn-real'),m=$('#real-msg');b.disabled=true;m.textContent='실제 결과를 불러오고 있습니다…';
 try{
  const names=['score_validation.csv','score_test.csv','model_summary.json','bundle_A_normal.csv','bundle_B_review.csv'];
  const files=await Promise.all(names.map(async name=>{const r=await fetch('assets/data/'+name);if(!r.ok)throw Error(name+' 파일을 불러오지 못했습니다.');return new File([await r.text()],name);}));
  S.files=[];S.summary=null;S.sample=false;await readFiles(files);
  m.textContent='실제 과거자료 준비 완료. 기준 A는 1313·8·0건, B는 1321·0·0건입니다. 실제 C 사례는 없습니다.';
  log('접수','실제 PHM 과거자료 불러오기');
 }catch(e){m.textContent='자료를 불러오지 못했습니다. 배포 폴더의 assets/data를 확인하거나 AI LAB 결과 파일을 직접 선택하세요. '+e.message;}
 finally{b.disabled=false;}
};

/* ───────── 시작 ───────── */
S.log = store.get('log') || [];
loadSample();
const h = (location.hash || '').slice(1), saved = store.get('tab');
showTab(TABS.includes(h) ? h : TABS.includes(saved) ? saved : 'intake');
setInterval(tick, 100);
})();
