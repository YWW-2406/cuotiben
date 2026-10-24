'use strict';

/* ================= 科目配置 ================= */
var SUBJECTS = [
  { name: '语文', color: '#E8590C' },
  { name: '数学', color: '#1C7ED6' },
  { name: '英语', color: '#2F9E44' },
  { name: '道法', color: '#F76707' },
  { name: '历史', color: '#9C36B5' },
  { name: '物理', color: '#0CA678' },
  { name: '化学', color: '#E03131' }
];

var state = {
  addSubject: '',                                  /* 录入页当前选中科目 */
  pending: [],                                     /* 待保存照片 [{blob,w,h,url}] */
  filter: { subject: '全部', from: '', to: '' },   /* 错题本筛选条件 */
  exportSubject: '',                               /* 导出弹窗选中科目 */
  questions: []                                    /* 全部错题缓存 */
};
var urlCache = {}; /* 错题 id -> 缩略图 objectURL，避免重复生成 */

var SVG_X = '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
var SVG_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 7h16M10 7V5h4v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var SVG_EMPTY = '<svg viewBox="0 0 24 24" width="56" height="56" fill="none"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5 17a3 3 0 0 1 3-3h11" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 8h6M9 11h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
var SVG_ERASER = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M15.2 3.8l5 5L10.4 18.6H6.2l-2.6-2.6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M11.2 7.8l5 5M6 21h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function $(id) { return document.getElementById(id); }

/* ================= 通用工具 ================= */
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

var toastTimer = null;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
}

function confirmDialog(title, text) {
  return new Promise(function (resolve) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    var mask = $('confirmModal');
    mask.hidden = false;
    function done(v) {
      mask.hidden = true;
      $('confirmYes').onclick = null;
      $('confirmNo').onclick = null;
      mask.onclick = null;
      resolve(v);
    }
    $('confirmYes').onclick = function () { done(true); };
    $('confirmNo').onclick = function () { done(false); };
    mask.onclick = function (e) { if (e.target === mask) done(false); };
  });
}

/* ================= 图片处理 ================= */
function loadImage(url) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('图片无法读取')); };
    img.src = url;
  });
}

/* 压缩至最长边 1600px / JPEG 85%，兼顾清晰度与存储空间 */
var MAX_DIM = 1600;
function processFile(file) {
  var url = URL.createObjectURL(file);
  return loadImage(url).then(function (img) {
    var scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    var w = Math.max(1, Math.round(img.naturalWidth * scale));
    var h = Math.max(1, Math.round(img.naturalHeight * scale));
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve({ blob: blob, w: w, h: h });
        else reject(new Error('图片处理失败'));
      }, 'image/jpeg', 0.85);
    });
  }, function (err) {
    URL.revokeObjectURL(url);
    throw err;
  });
}

/* ================= 视图切换 ================= */
function switchView(name) {
  $('viewAdd').hidden = name !== 'add';
  $('viewList').hidden = name !== 'list';
  var items = document.querySelectorAll('.nav-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle('active', items[i].getAttribute('data-view') === name);
  }
  window.scrollTo(0, 0);
  if (name === 'list') renderList();
}

/* ================= 录入页 ================= */
function renderAddSubjects() {
  var wrap = $('addSubjects');
  wrap.innerHTML = '';
  SUBJECTS.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'subject-chip' + (state.addSubject === s.name ? ' active' : '');
    b.textContent = s.name;
    if (state.addSubject === s.name) {
      b.style.background = s.color;
      b.style.borderColor = s.color;
    }
    b.onclick = function () {
      state.addSubject = state.addSubject === s.name ? '' : s.name;
      renderAddSubjects();
      updateSaveBtn();
    };
    wrap.appendChild(b);
  });
}

function renderPending() {
  var grid = $('previewGrid');
  grid.innerHTML = '';
  state.pending.forEach(function (p, i) {
    var item = document.createElement('div');
    item.className = 'preview-item';
    item.onclick = function () { openEditor(i); };

    var img = document.createElement('img');
    img.src = p.url;
    img.alt = '待保存照片，点击可擦除手写';

    var badge = document.createElement('div');
    badge.className = 'preview-edit';
    badge.innerHTML = SVG_ERASER + '<span>擦除手写</span>';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preview-remove';
    btn.setAttribute('aria-label', '移除照片');
    btn.innerHTML = SVG_X;
    btn.onclick = function (e) {
      e.stopPropagation();
      URL.revokeObjectURL(p.url);
      state.pending.splice(i, 1);
      renderPending();
      updateSaveBtn();
    };
    item.appendChild(img);
    item.appendChild(badge);
    item.appendChild(btn);
    grid.appendChild(item);
  });
  grid.hidden = state.pending.length === 0;
  $('previewTip').hidden = state.pending.length === 0;
}

function updateSaveBtn() {
  $('saveBtn').disabled = !(state.addSubject && state.pending.length);
}

function saveQuestions() {
  if (!state.addSubject) { toast('请先选择科目'); return; }
  if (!state.pending.length) { toast('请先添加错题照片'); return; }
  var btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = '保存中…';
  var date = $('addDate').value || todayStr();
  var note = $('addNote').value.trim();
  var subject = state.addSubject;
  var count = state.pending.length;
  var tasks = state.pending.map(function (p) {
    return DB.add({ subject: subject, date: date, note: note, imgData: p.blob, w: p.w, h: p.h, created: Date.now() });
  });
  Promise.all(tasks)
    .then(function () {
      toast('已保存 ' + count + ' 道错题');
      state.pending.forEach(function (p) { URL.revokeObjectURL(p.url); });
      state.pending = [];
      $('addNote').value = '';
      renderPending();
      return refreshQuestions();
    })
    .catch(function (err) {
      console.error(err);
      toast('保存失败：' + (err && err.message ? err.message : '请重试'));
    })
    .then(function () {
      btn.textContent = '保存错题';
      updateSaveBtn();
    });
}

/* ================= 数据与统计 ================= */
function refreshQuestions() {
  return DB.getAll().then(function (list) {
    state.questions = list;
    updateCounts();
    if (!$('viewList').hidden) renderList();
  }, function (err) {
    console.error(err);
    toast('读取错题失败：' + (err && err.message ? err.message : ''));
  });
}

function updateCounts() {
  var n = state.questions.length;
  var hc = $('headerCount');
  hc.textContent = '共 ' + n + ' 题';
  hc.hidden = n === 0;
  var badge = $('navBadge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n === 0;
}

/* ================= 错题本页 ================= */
function getFiltered() {
  var f = state.filter;
  return state.questions.filter(function (q) {
    if (f.subject !== '全部' && q.subject !== f.subject) return false;
    if (f.from && q.date < f.from) return false;
    if (f.to && q.date > f.to) return false;
    return true;
  });
}

function subjectStyle(name) {
  for (var i = 0; i < SUBJECTS.length; i++) {
    if (SUBJECTS[i].name === name) return SUBJECTS[i];
  }
  return { name: name, color: '#667085' };
}

function thumbUrl(q) {
  if (!urlCache[q.id]) urlCache[q.id] = URL.createObjectURL(q.imgData);
  return urlCache[q.id];
}

function renderFilterChips() {
  var wrap = $('filterSubjects');
  wrap.innerHTML = '';
  var names = ['全部'].concat(SUBJECTS.map(function (s) { return s.name; }));
  names.forEach(function (name) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill' + (state.filter.subject === name ? ' active' : '');
    b.textContent = name;
    b.onclick = function () {
      state.filter.subject = name;
      renderList();
    };
    wrap.appendChild(b);
  });
}

function renderList() {
  renderFilterChips();
  var f = state.filter;
  var active = f.subject !== '全部' || f.from || f.to;
  var list = getFiltered().slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; /* 日期降序，新的在前 */
    return b.id - a.id;
  });

  $('listCount').textContent = active
    ? '筛选出 ' + list.length + ' 题 / 共 ' + state.questions.length + ' 题'
    : '共 ' + list.length + ' 题';

  var body = $('listBody');
  body.innerHTML = '';
  $('listTip').hidden = list.length === 0;
  if (!list.length) {
    body.appendChild(buildEmpty());
    return;
  }
  list.forEach(function (q) { body.appendChild(buildCard(q)); });
}

function buildEmpty() {
  var div = document.createElement('div');
  div.className = 'empty-state';
  var icon = document.createElement('div');
  icon.innerHTML = SVG_EMPTY;
  var title = document.createElement('div');
  title.className = 'empty-title';
  var sub = document.createElement('div');
  sub.className = 'empty-sub';
  if (state.questions.length === 0) {
    title.textContent = '还没有错题';
    sub.textContent = '点击下方「录入」开始添加吧';
  } else {
    title.textContent = '没有符合条件的错题';
    sub.textContent = '试试调整科目或日期筛选';
  }
  div.appendChild(icon);
  div.appendChild(title);
  div.appendChild(sub);
  return div;
}

function buildCard(q) {
  var s = subjectStyle(q.subject);
  var card = document.createElement('div');
  card.className = 'q-card card';
  card.onclick = function () { openSavedEditor(q); };

  var thumbWrap = document.createElement('div');
  thumbWrap.className = 'q-thumb-wrap';
  var img = document.createElement('img');
  img.className = 'q-thumb';
  img.src = thumbUrl(q);
  img.alt = q.subject + '错题，点击擦除手写';
  var editBadge = document.createElement('div');
  editBadge.className = 'q-edit-badge';
  editBadge.innerHTML = SVG_ERASER;
  thumbWrap.appendChild(img);
  thumbWrap.appendChild(editBadge);

  var bodyEl = document.createElement('div');
  bodyEl.className = 'q-body';

  var top = document.createElement('div');
  top.className = 'q-top';
  var badge = document.createElement('span');
  badge.className = 'q-badge';
  badge.textContent = q.subject;
  badge.style.color = s.color;
  badge.style.background = s.color + '1A';
  var date = document.createElement('span');
  date.className = 'q-date';
  date.textContent = q.date.replace(/-/g, '/');
  top.appendChild(badge);
  top.appendChild(date);

  var note = document.createElement('div');
  note.className = 'q-note';
  note.textContent = q.note || '—';

  bodyEl.appendChild(top);
  bodyEl.appendChild(note);

  var del = document.createElement('button');
  del.type = 'button';
  del.className = 'q-del';
  del.setAttribute('aria-label', '删除这道错题');
  del.innerHTML = SVG_TRASH;
  del.onclick = function (e) {
    e.stopPropagation();
    deleteQuestion(q);
  };

  card.appendChild(thumbWrap);
  card.appendChild(bodyEl);
  card.appendChild(del);
  return card;
}

function deleteQuestion(q) {
  confirmDialog('删除错题', '确定删除 ' + q.date.replace(/-/g, '/') + ' 的这道' + q.subject + '错题吗？删除后无法恢复。')
    .then(function (ok) {
      if (!ok) return null;
      return DB.remove(q.id).then(function () {
        if (urlCache[q.id]) {
          URL.revokeObjectURL(urlCache[q.id]);
          delete urlCache[q.id];
        }
        toast('已删除');
        return refreshQuestions();
      });
    })
    .catch(function (err) {
      console.error(err);
      toast('删除失败，请重试');
    });
}

/* ================= 导出 PDF ================= */
function openExport() {
  state.exportSubject = state.filter.subject !== '全部' ? state.filter.subject : '';
  $('exportFrom').value = state.filter.from;
  $('exportTo').value = state.filter.to;
  renderExportChips();
  updateExportSummary();
  $('exportModal').hidden = false;
}

function renderExportChips() {
  var wrap = $('exportSubjects');
  wrap.innerHTML = '';
  SUBJECTS.forEach(function (s) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill' + (state.exportSubject === s.name ? ' active-subject' : '');
    if (state.exportSubject === s.name) {
      b.style.background = s.color;
      b.style.borderColor = s.color;
    }
    b.textContent = s.name;
    b.onclick = function () {
      state.exportSubject = s.name;
      renderExportChips();
      updateExportSummary();
    };
    wrap.appendChild(b);
  });
}

function getExportList() {
  var subject = state.exportSubject;
  var from = $('exportFrom').value;
  var to = $('exportTo').value;
  return state.questions.filter(function (q) {
    if (q.subject !== subject) return false;
    if (from && q.date < from) return false;
    if (to && q.date > to) return false;
    return true;
  }).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1; /* 日期升序，像一本作业本 */
    return a.id - b.id;
  });
}

function updateExportSummary() {
  var el = $('exportSummary');
  var btn = $('exportBtn');
  if (!state.exportSubject) {
    el.textContent = '请选择要导出的科目';
    btn.disabled = true;
    return;
  }
  var list = getExportList();
  el.textContent = '符合条件：' + list.length + ' 道错题';
  btn.disabled = list.length === 0;
}

function exportPdf() {
  var list = getExportList();
  if (!state.exportSubject || !list.length) return;
  var btn = $('exportBtn');
  btn.disabled = true;
  btn.textContent = '正在生成 PDF…';

  var from = $('exportFrom').value;
  var to = $('exportTo').value;
  var rangeText, fileRange;
  if (from || to) {
    rangeText = (from ? from.replace(/-/g, '/') : '最初') + ' 至 ' + (to ? to.replace(/-/g, '/') : '今天');
    fileRange = [from, to].filter(Boolean).map(function (s) { return s.replace(/-/g, ''); }).join('-');
  } else {
    rangeText = '全部错题';
    fileRange = '全部';
  }

  PDF_LAYOUT.buildQuestionPdf(state.exportSubject, list, rangeText)
    .then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = state.exportSubject + '错题本_' + fileRange + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 20000);
      $('exportModal').hidden = true;
      toast('PDF 已生成，开始下载');
    })
    .catch(function (err) {
      console.error(err);
      toast('生成失败：' + (err && err.message ? err.message : '请重试'));
    })
    .then(function () {
      btn.textContent = '生成 PDF';
      updateExportSummary();
    });
}

/* ================= 擦除手写编辑器 =================
 * 原理：涂抹处用「笔刷周围纸底颜色」覆盖（在笔刷外圈采样8点、
 * 取各通道70%分位，自动适应白纸/泛黄/灰底），而非简单涂白。
 * 撤销采用笔迹重放：只记录触点序列，内存占用极小。
 */
var editor = {
  target: null,     /* 正在编辑的对象：{type:'pending', idx} 或 {type:'saved', record} */
  img: null,        /* 原始图片对象（用于重放） */
  ctx: null,
  strokes: [],      /* 已完成笔迹 [{size, points:[{x,y,color}]}] */
  current: null,    /* 进行中的笔迹 */
  mode: 'erase',    /* erase=擦除 pan=移动（滚动查看） */
  brush: 'm',
  zoom: 1
};

function brushSizePx() {
  var c = $('editorCanvas');
  var base = Math.max(c.width, c.height);
  if (editor.brush === 's') return Math.max(6, base * 0.012);
  if (editor.brush === 'l') return base * 0.08;
  return base * 0.032;
}

/* 编辑录入页待保存的照片 */
function openEditor(i) {
  var p = state.pending[i];
  if (!p) return;
  startEditor(p.blob, { type: 'pending', idx: i });
}

/* 编辑已保存的错题 */
function openSavedEditor(q) {
  if (!q || !q.imgData) return;
  startEditor(q.imgData, { type: 'saved', record: q });
}

function startEditor(blob, target) {
  var url = URL.createObjectURL(blob);
  loadImage(url).then(function (img) {
    URL.revokeObjectURL(url);
    editor.target = target;
    editor.img = img;
    editor.strokes = [];
    editor.current = null;
    editor.mode = 'erase';
    editor.brush = 'm';
    editor.zoom = 1;
    var c = $('editorCanvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    editor.ctx = c.getContext('2d');
    editor.ctx.drawImage(img, 0, 0);
    updateEditorUI();
    $('editor').hidden = false;
    document.body.style.overflow = 'hidden';
    applyEditorZoom();
  }, function () {
    URL.revokeObjectURL(url);
    toast('图片读取失败');
  });
}

function closeEditor() {
  $('editor').hidden = true;
  document.body.style.overflow = '';
  editor.target = null;
  editor.img = null;
  editor.current = null;
}

function setSegActive(id, attr, val) {
  var btns = $(id).querySelectorAll('.seg-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('active', btns[i].getAttribute(attr) === val);
  }
}

function updateEditorUI() {
  var c = $('editorCanvas');
  c.className = editor.mode === 'erase' ? 'erase-mode' : '';
  setSegActive('editorModeSeg', 'data-mode', editor.mode);
  setSegActive('editorBrushSeg', 'data-brush', editor.brush);
  setSegActive('editorZoomSeg', 'data-zoom', String(editor.zoom));
  $('editorUndo').disabled = editor.strokes.length === 0;
}

/* 缩放：1x 整页显示，2x/3x 放大后可在「移动」模式下滚动查看 */
function applyEditorZoom() {
  if ($('editor').hidden) return;
  var wrap = $('editorWrap');
  var c = $('editorCanvas');
  var availW = wrap.clientWidth - 24;
  var availH = wrap.clientHeight - 24;
  if (availW <= 0) availW = 320;
  if (availH <= 0) availH = 420;
  var fit = Math.min(availW / c.width, availH / c.height);
  c.style.width = Math.round(c.width * fit * editor.zoom) + 'px';
  c.style.height = Math.round(c.height * fit * editor.zoom) + 'px';
}

function editorCanvasPos(e) {
  var c = $('editorCanvas');
  var r = c.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * c.width / r.width,
    y: (e.clientY - r.top) * c.height / r.height
  };
}

/* 在笔刷外圈环形采样，取偏亮的颜色作为覆盖色（纸底通常比笔迹亮） */
function sampleEraseColor(x, y) {
  var c = $('editorCanvas');
  var radius = brushSizePx() / 2 + Math.max(8, c.width * 0.008);
  var rs = [], gs = [], bs = [];
  for (var i = 0; i < 8; i++) {
    var ang = Math.PI * 2 * i / 8 + 0.35;
    var sx = Math.round(x + Math.cos(ang) * radius);
    var sy = Math.round(y + Math.sin(ang) * radius);
    if (sx < 0 || sy < 0 || sx >= c.width || sy >= c.height) continue;
    var d = editor.ctx.getImageData(sx, sy, 1, 1).data;
    rs.push(d[0]);
    gs.push(d[1]);
    bs.push(d[2]);
  }
  if (!rs.length) return '#ffffff';
  rs.sort(function (a, b) { return a - b; });
  gs.sort(function (a, b) { return a - b; });
  bs.sort(function (a, b) { return a - b; });
  var idx = Math.min(rs.length - 1, Math.ceil(rs.length * 0.7) - 1);
  return 'rgb(' + rs[idx] + ',' + gs[idx] + ',' + bs[idx] + ')';
}

function drawEditorDot(p, size, color) {
  var ctx = editor.ctx;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawEditorSeg(p1, p2, size, color) {
  var ctx = editor.ctx;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
}

function redrawEditor() {
  var c = $('editorCanvas');
  editor.ctx.clearRect(0, 0, c.width, c.height);
  editor.ctx.drawImage(editor.img, 0, 0);
  editor.strokes.forEach(function (st) {
    for (var i = 0; i < st.points.length; i++) {
      if (i === 0) drawEditorDot(st.points[i], st.size, st.points[i].color);
      else drawEditorSeg(st.points[i - 1], st.points[i], st.size, st.points[i].color);
    }
  });
}

function bindSeg(id, attr, onChange) {
  var btns = $(id).querySelectorAll('.seg-btn');
  for (var i = 0; i < btns.length; i++) {
    (function (btn) {
      btn.onclick = function () { onChange(btn.getAttribute(attr)); };
    })(btns[i]);
  }
}

function bindEditorEvents() {
  var c = $('editorCanvas');

  c.addEventListener('pointerdown', function (e) {
    if ($('editor').hidden || editor.mode !== 'erase') return;
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    if (c.setPointerCapture) {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    }
    var pos = editorCanvasPos(e);
    var size = brushSizePx();
    var color = sampleEraseColor(pos.x, pos.y);
    editor.current = { size: size, points: [{ x: pos.x, y: pos.y, color: color }] };
    drawEditorDot(pos, size, color);
  });

  c.addEventListener('pointermove', function (e) {
    if (!editor.current) return;
    e.preventDefault();
    var pos = editorCanvasPos(e);
    var pts = editor.current.points;
    var prev = pts[pts.length - 1];
    if (Math.abs(pos.x - prev.x) < 1.5 && Math.abs(pos.y - prev.y) < 1.5) return;
    var color = sampleEraseColor(pos.x, pos.y);
    var p = { x: pos.x, y: pos.y, color: color };
    drawEditorSeg(prev, p, editor.current.size, color);
    pts.push(p);
  });

  function finishStroke() {
    if (!editor.current) return;
    editor.strokes.push(editor.current);
    editor.current = null;
    updateEditorUI();
  }
  c.addEventListener('pointerup', finishStroke);
  c.addEventListener('pointercancel', finishStroke);
  c.addEventListener('pointerleave', finishStroke);

  $('editorClose').onclick = function () {
    if (editor.strokes.length) {
      confirmDialog('放弃修改', '已做的擦除将不会保存，确定放弃吗？').then(function (ok) {
        if (ok) closeEditor();
      });
    } else {
      closeEditor();
    }
  };

  $('editorUndo').onclick = function () {
    if (!editor.strokes.length) return;
    editor.strokes.pop();
    redrawEditor();
    updateEditorUI();
  };

  $('editorReset').onclick = function () {
    if (!editor.strokes.length) return;
    confirmDialog('恢复原图', '将撤销全部擦除操作，恢复到原始照片，确定吗？').then(function (ok) {
      if (!ok) return;
      editor.strokes = [];
      redrawEditor();
      updateEditorUI();
    });
  };

  $('editorDone').onclick = function () {
    var t = editor.target;
    if (!t) return;
    if (!editor.strokes.length) { closeEditor(); return; } /* 无修改不重复压缩 */
    var cnv = $('editorCanvas');
    cnv.toBlob(function (blob) {
      if (!blob) { toast('保存失败，请重试'); return; }

      if (t.type === 'pending') {
        /* 录入页：替换待保存照片 */
        var p = state.pending[t.idx];
        if (p) {
          URL.revokeObjectURL(p.url);
          p.blob = blob;
          p.w = cnv.width;
          p.h = cnv.height;
          p.url = URL.createObjectURL(blob);
        }
        closeEditor();
        renderPending();
        toast('已应用擦除效果');
      } else {
        /* 错题本页：更新已保存的错题记录 */
        var q = t.record;
        var rec = {
          id: q.id,
          subject: q.subject,
          date: q.date,
          note: q.note,
          imgData: blob,
          w: cnv.width,
          h: cnv.height,
          created: q.created
        };
        DB.update(rec).then(function () {
          if (urlCache[q.id]) {
            URL.revokeObjectURL(urlCache[q.id]);
            delete urlCache[q.id];
          }
          closeEditor();
          return refreshQuestions();
        }).then(function () {
          toast('已更新错题照片');
        }, function (err) {
          console.error(err);
          toast('保存失败，请重试');
        });
      }
    }, 'image/jpeg', 0.85);
  };

  bindSeg('editorModeSeg', 'data-mode', function (v) {
    editor.mode = v;
    updateEditorUI();
  });
  bindSeg('editorBrushSeg', 'data-brush', function (v) {
    editor.brush = v;
    updateEditorUI();
  });
  bindSeg('editorZoomSeg', 'data-zoom', function (v) {
    editor.zoom = parseInt(v, 10) || 1;
    updateEditorUI();
    applyEditorZoom();
  });
}

/* ================= 事件绑定与初始化 ================= */
function bindEvents() {
  var navItems = document.querySelectorAll('.nav-item');
  for (var i = 0; i < navItems.length; i++) {
    (function (btn) {
      btn.onclick = function () { switchView(btn.getAttribute('data-view')); };
    })(navItems[i]);
  }

  $('uploadZone').onclick = function () { $('fileInput').click(); };
  $('uploadZone').onkeydown = function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('fileInput').click();
    }
  };

  $('fileInput').onchange = function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = ''; /* 允许重复选择同一张图 */
    if (!files.length) return;
    toast('正在处理图片…');
    var ok = 0, fail = 0;
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () {
        if (!f.type || f.type.indexOf('image/') !== 0) { fail++; return null; }
        return processFile(f).then(function (r) {
          ok++;
          state.pending.push({ blob: r.blob, w: r.w, h: r.h, url: URL.createObjectURL(r.blob) });
        }, function () { fail++; });
      });
    });
    chain.then(function () {
      renderPending();
      updateSaveBtn();
      if (fail) toast(ok ? '已添加 ' + ok + ' 张，' + fail + ' 张无法处理' : '所选文件不是图片，请重新选择');
      else if (ok) toast('已添加 ' + ok + ' 张照片');
    });
  };

  $('saveBtn').onclick = saveQuestions;

  $('filterFrom').oninput = function () { state.filter.from = this.value; renderList(); };
  $('filterTo').oninput = function () { state.filter.to = this.value; renderList(); };
  $('filterReset').onclick = function () {
    state.filter = { subject: '全部', from: '', to: '' };
    $('filterFrom').value = '';
    $('filterTo').value = '';
    renderList();
  };

  $('openExport').onclick = openExport;
  $('exportCancel').onclick = function () { $('exportModal').hidden = true; };
  $('exportModal').onclick = function (e) { if (e.target === this) this.hidden = true; };
  $('exportFrom').oninput = updateExportSummary;
  $('exportTo').oninput = updateExportSummary;
  $('exportBtn').onclick = exportPdf;

  window.addEventListener('resize', function () {
    if (!$('editor').hidden) applyEditorZoom();
  });

  bindEditorEvents();
}

function init() {
  $('addDate').value = todayStr();
  renderAddSubjects();
  renderPending();
  bindEvents();
  DB.open()
    .then(refreshQuestions)
    .catch(function (err) {
      console.error(err);
      toast('本地存储不可用，无法保存错题（请勿使用无痕窗口）');
    });

  /* 离线缓存：仅在线上 https 或本机 localhost 时启用 */
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 不影响正常使用 */ });
  }
}

document.addEventListener('DOMContentLoaded', init);
