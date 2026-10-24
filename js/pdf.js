'use strict';
/*
 * PDF 生成（纯 JavaScript 实现，不依赖任何第三方库）
 *
 * buildPdf(pages)：纯函数，将 JPEG 图片组装为 PDF 文件（无 DOM 依赖，可单独测试）
 *   pages = [{ items: [{ jpeg: Uint8Array, w, h, x, y, dw, dh }] }]
 *   坐标单位为 PDF 点（pt），原点在页面左下角；A4 = 595.28 x 841.89
 *
 * PDF_LAYOUT：依赖 DOM 的排版模块。
 *   中文无法直接嵌入 PDF 文字（需嵌入字体文件），因此封面和每页题头
 *   均先用 canvas 绘制成图片，再以 JPEG 方式嵌入 PDF，从而完全离线可用。
 */

function buildPdf(pages) {
  var A4W = 595.28, A4H = 841.89;
  var chunks = [];
  var offset = 0;
  var offsets = [];

  function pushBytes(b) { chunks.push(b); offset += b.length; }
  function pushText(s) { pushBytes(new TextEncoder().encode(s)); }
  function fmt(n) { return String(Math.round(n * 100) / 100); }

  /* 对象编号分配：1=文档目录 2=页面树；每页 = 页对象 + 内容流 + 各图片对象 */
  var nextId = 3;
  var meta = pages.map(function (page) {
    var pageId = nextId++;
    var contentId = nextId++;
    var imageIds = page.items.map(function () { return nextId++; });
    return { pageId: pageId, contentId: contentId, imgIds: imageIds };
  });
  var total = nextId - 1;

  pushText('%PDF-1.4\n');
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); /* 二进制标记 */

  offsets[1] = offset;
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  offsets[2] = offset;
  var kids = meta.map(function (m) { return m.pageId + ' 0 R'; }).join(' ');
  pushText('2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>\nendobj\n');

  pages.forEach(function (page, i) {
    var m = meta[i];

    var content = '';
    page.items.forEach(function (it, k) {
      content += 'q ' + fmt(it.dw) + ' 0 0 ' + fmt(it.dh) + ' ' + fmt(it.x) + ' ' + fmt(it.y) + ' cm /Im' + k + ' Do Q\n';
    });

    offsets[m.contentId] = offset;
    pushText(m.contentId + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n');

    page.items.forEach(function (it, k) {
      offsets[m.imgIds[k]] = offset;
      pushText(m.imgIds[k] + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + it.w + ' /Height ' + it.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + it.jpeg.length + ' >>\nstream\n');
      pushBytes(it.jpeg);
      pushText('\nendstream\nendobj\n');
    });

    offsets[m.pageId] = offset;
    var xobjects = page.items.map(function (it, k) { return '/Im' + k + ' ' + m.imgIds[k] + ' 0 R'; }).join(' ');
    pushText(m.pageId + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(A4W) + ' ' + fmt(A4H) +
      '] /Resources << /XObject << ' + xobjects + ' >> >> /Contents ' + m.contentId + ' 0 R >>\nendobj\n');
  });

  var xrefPos = offset;
  var xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
  for (var i = 1; i <= total; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pushText(xref);
  pushText('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  return new Blob(chunks, { type: 'application/pdf' });
}

/* ================= 排版模块（依赖 DOM） ================= */
var PDF_LAYOUT = (function () {
  var A4W = 595.28, A4H = 841.89;
  var MARGIN = 28;           /* 页边距 pt */
  var GAP = 8;               /* 题头与图片间距 pt */
  var CONTENT_W = A4W - MARGIN * 2;
  var HEADER_W = 1240;       /* 题头画布像素宽度，映射为 CONTENT_W pt */
  var FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

  /* 兼容旧浏览器的 Blob -> 字节（FileReader 比 Blob.arrayBuffer 兼容性好） */
  function blobToBytes(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(new Uint8Array(fr.result)); };
      fr.onerror = function () { reject(fr.error || new Error('读取图片失败')); };
      fr.readAsArrayBuffer(blob);
    });
  }

  function dataUrlToBytes(dataUrl) {
    var bin = atob(dataUrl.split(',')[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise(function (resolve, reject) {
      var done = function (blob) {
        if (blob) {
          blobToBytes(blob).then(function (bytes) {
            resolve({ bytes: bytes, w: canvas.width, h: canvas.height });
          }, reject);
        } else {
          try {
            resolve({ bytes: dataUrlToBytes(canvas.toDataURL('image/jpeg', quality)), w: canvas.width, h: canvas.height });
          } catch (e) { reject(e); }
        }
      };
      if (canvas.toBlob) canvas.toBlob(done, 'image/jpeg', quality);
      else done(null);
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------- 封面 ---------------- */
  function renderCover(subject, rangeText, count) {
    var W = 1240, H = 1754;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#4263eb';
    ctx.lineWidth = 4;
    roundRectPath(ctx, 56, 56, W - 112, H - 112, 22);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#4263eb';
    ctx.font = '600 44px ' + FONT;
    ctx.fillText('错 题 本', W / 2, 520);

    ctx.fillStyle = '#1f2430';
    ctx.font = '700 118px ' + FONT;
    ctx.fillText(subject + '错题集', W / 2, 686);

    ctx.strokeStyle = '#dde2f0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 150, 762);
    ctx.lineTo(W / 2 + 150, 762);
    ctx.stroke();

    ctx.fillStyle = '#5b6472';
    ctx.font = '400 46px ' + FONT;
    ctx.fillText(rangeText, W / 2, 852);
    ctx.fillText('共 ' + count + ' 题', W / 2, 936);

    var d = new Date();
    ctx.fillStyle = '#9aa1ae';
    ctx.font = '400 32px ' + FONT;
    ctx.fillText('生成日期 ' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日', W / 2, H - 130);

    return c;
  }

  /* 按字符换行（中文友好），超出 maxLines 截断加省略号 */
  function wrapLines(ctx, text, maxW, maxLines) {
    var lines = [];
    var cur = '';
    var truncated = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (cur && ctx.measureText(cur + ch).width > maxW) {
        lines.push(cur);
        cur = ch;
        if (lines.length >= maxLines) { truncated = true; break; }
      } else {
        cur += ch;
      }
    }
    if (truncated) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
    } else if (cur) {
      lines.push(cur);
    }
    return lines;
  }

  /* ---------------- 每题页眉 ---------------- */
  function renderHeader(subject, num, date, note) {
    var W = HEADER_W, PADX = 8;
    var measure = document.createElement('canvas').getContext('2d');
    measure.font = '400 34px ' + FONT;
    var noteLines = [];
    if (note) noteLines = wrapLines(measure, '备注：' + note, W - PADX * 2, 3);

    var LINE1_H = 68, NOTE_LH = 46;
    var H = 16 + LINE1_H + (noteLines.length ? 8 + noteLines.length * NOTE_LH : 0) + 22;

    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    var y1 = 16 + 48;
    ctx.textBaseline = 'alphabetic';

    ctx.textAlign = 'left';
    ctx.font = '700 46px ' + FONT;
    ctx.fillStyle = '#1f2430';
    ctx.fillText(subject + ' · 第 ' + num + ' 题', PADX, y1);

    ctx.textAlign = 'right';
    ctx.font = '400 36px ' + FONT;
    ctx.fillStyle = '#9aa1ae';
    ctx.fillText(date.replace(/-/g, '/'), W - PADX, y1);

    if (noteLines.length) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b6472';
      ctx.font = '400 34px ' + FONT;
      for (var i = 0; i < noteLines.length; i++) {
        ctx.fillText(noteLines[i], PADX, 16 + LINE1_H + 8 + 36 + i * NOTE_LH);
      }
    }

    ctx.strokeStyle = '#d8dce6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - 7);
    ctx.lineTo(W, H - 7);
    ctx.stroke();

    return c;
  }

  /* ---------------- 单题排版 ---------------- */
  function processQuestion(subject, num, q) {
    var hj = null;
    return canvasToJpeg(renderHeader(subject, num, q.date, q.note), 0.95)
      .then(function (r) {
        hj = r;
        return blobToBytes(q.imgData);
      })
      .then(function (imgBytes) {
        var headerDh = CONTENT_W * hj.h / hj.w;
        var headerY = A4H - MARGIN - headerDh;      /* 题头贴着上边距 */
        var areaTop = headerY - GAP;                 /* 图片区域上界 */
        var areaBottom = MARGIN;                     /* 图片区域下界 */
        var availW = CONTENT_W;
        var availH = areaTop - areaBottom;
        var scale = Math.min(availW / q.w, availH / q.h);
        var dw = q.w * scale;
        var dh = q.h * scale;
        return [
          { jpeg: hj.bytes, w: hj.w, h: hj.h, x: MARGIN, y: headerY, dw: CONTENT_W, dh: headerDh },
          { jpeg: imgBytes, w: q.w, h: q.h, x: MARGIN + (availW - dw) / 2, y: areaBottom + (availH - dh) / 2, dw: dw, dh: dh }
        ];
      });
  }

  /* ---------------- 组装整本错题 PDF ----------------
   * questions: [{ imgData: Blob, w, h, date, note }]（已按日期升序）
   */
  function buildQuestionPdf(subject, questions, rangeText) {
    var pages = [];
    var cover = renderCover(subject, rangeText, questions.length);
    var coverJ = null;

    return canvasToJpeg(cover, 0.95)
      .then(function (cj) {
        coverJ = cj;
        pages.push({ items: [{ jpeg: cj.bytes, w: cj.w, h: cj.h, x: 0, y: 0, dw: A4W, dh: A4H }] });

        var chain = Promise.resolve();
        questions.forEach(function (q, idx) {
          chain = chain.then(function () {
            return processQuestion(subject, idx + 1, q).then(function (items) {
              pages.push({ items: items });
            });
          });
        });
        return chain;
      })
      .then(function () {
        return buildPdf(pages);
      });
  }

  return { buildQuestionPdf: buildQuestionPdf };
})();
