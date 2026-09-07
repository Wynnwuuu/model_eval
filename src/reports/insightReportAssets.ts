export const reportStyles = String.raw`
:root{color-scheme:light;--ink:#202a36;--muted:#526174;--line:#dce3e9;--paper:#fff;--blue:#2674bf;--purple:#8661c5;--gray:#8994a3}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f5f7f9;color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}
a{color:#175eaa;text-underline-offset:3px;overflow-wrap:anywhere}button,input,select{font:inherit;color:inherit}button,select,input{min-height:40px;border:1px solid #b7c3cf;border-radius:4px;background:white;padding:7px 12px}button{cursor:pointer}button:hover{background:#edf3f8}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #257bb8;outline-offset:3px}
h1,h2,h3,p{margin:0}h1{font-size:30px;line-height:1.35;overflow-wrap:anywhere}h2{font-size:22px;margin-bottom:16px}h3{font-size:17px;margin-bottom:10px}p+p{margin-top:10px}.muted,small{color:var(--muted)}small{font-size:13px}.eyebrow{font-size:12px;font-weight:700;color:#526174;margin-bottom:10px}
header{background:#fff;border-bottom:1px solid var(--line)}.container{max-width:1280px;margin:auto;padding:32px}.report-meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:18px;color:var(--muted);font-size:14px}.report-meta span{overflow-wrap:anywhere}
nav{display:flex;flex-wrap:wrap;gap:6px 24px;padding-top:20px}nav a{font-size:14px;font-weight:600;text-decoration:none}section{scroll-margin-top:18px;padding:30px 0;border-bottom:1px solid var(--line)}.section-heading{display:flex;justify-content:space-between;gap:16px;align-items:baseline;flex-wrap:wrap}
.conclusion{border-left:4px solid var(--blue);padding:2px 0 2px 20px}.conclusion h2{font-size:28px;margin-bottom:12px}.basis{font-size:19px;font-weight:600;margin-bottom:8px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:24px;margin-top:28px}.metric{border-top:2px solid #b8c8d8;padding-top:13px;min-width:0}.metric strong{font-size:24px;line-height:1.4;display:block;margin:6px 0;overflow-wrap:anywhere}.metric a{font-size:12px}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 36px}.chart{min-width:0}.wide{grid-column:1/-1}.chart>p{font-size:13px;color:var(--muted);margin-bottom:16px}.bar-row{margin:14px 0}.bar-label{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px}.bar-label span{overflow-wrap:anywhere}.bar-row svg,.stacked svg,.ci-row svg,.trend svg{display:block;width:100%;height:auto}.bar-row svg{height:12px;margin-top:7px}.stacked svg{height:28px;margin:16px 0}.legend{display:flex;gap:10px 24px;flex-wrap:wrap;font-size:14px}.legend span:before{content:"";display:inline-block;width:10px;height:10px;margin-right:8px;background:var(--key-color)}.ci-row{margin:18px 0}.ci-row svg{max-height:70px}.axis{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.table-wrap{overflow-x:auto;max-width:100%;margin:16px 0}table{border-collapse:collapse;width:100%;font-size:14px;background:white}th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}th{background:#eef2f5;color:#354357;font-weight:600}thead{display:table-header-group}td.number{text-align:right;font-variant-numeric:tabular-nums}.matrix{min-width:480px}.matrix td{min-width:100px;text-align:center}.matrix small{display:block}.notice{border-left:3px solid #bd861b;background:#fff8e7;padding:12px 16px;margin:16px 0;font-size:14px}.empty{padding:24px;border:1px dashed #bbc7d2;color:var(--muted)}
.case-toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:16px 0 22px}.case-toolbar label{display:flex;flex-direction:column;gap:5px;font-size:13px;flex:1 1 190px;min-width:0}.case-toolbar input,.case-toolbar select{width:100%;min-width:0;max-width:100%}#case-count{font-size:13px;color:var(--muted);margin-bottom:15px}
.case-report{background:var(--paper);border:1px solid var(--line);border-radius:4px;padding:24px;margin:20px 0;min-width:0}.case-report>header{display:flex;justify-content:space-between;align-items:start;gap:20px;margin-bottom:18px;padding-bottom:12px}.case-report h3{font-size:18px;overflow-wrap:anywhere}.case-result{font-size:14px;text-align:right;max-width:55%;overflow-wrap:anywhere}.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.chip{font-size:12px;background:#eef2f6;padding:3px 8px;border-radius:3px;overflow-wrap:anywhere}.prompt{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;margin:12px 0}.outputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:20px;margin-top:20px}.output{min-width:0;max-width:100%}.output-title{font-weight:600;margin-bottom:8px;overflow-wrap:anywhere}.output-note{font-size:13px;color:var(--muted);margin-bottom:8px}
figure{margin:0}.media-frame{border:1px solid var(--line);border-radius:4px;overflow:hidden;background:#f1f4f6}.media-stage{position:relative;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;min-width:0}.media-stage img,.media-stage video{width:100%;height:100%;position:absolute;inset:0;object-fit:contain}.media-stage audio{width:100%}.media-stage button[data-zoom]{position:absolute;bottom:8px;right:8px;min-height:32px;padding:3px 10px;background:white}.media-frame figcaption{padding:10px 12px;font-size:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:white}.media-status{color:var(--muted)}.media-frame[data-media-state="error"] .media-status{color:#a64032}button[data-retry]{min-height:30px;font-size:12px;padding:3px 8px}.text-output{white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;background:#f3f5f7;padding:16px;font-family:inherit;font-size:14px;line-height:1.6}.case-metrics{display:flex;gap:12px 24px;flex-wrap:wrap;font-size:13px;margin-top:14px}
.media-frame:not([data-media-state="ready"]) [data-src]{visibility:hidden}.media-placeholder{color:#637588;font-size:14px}.media-frame[data-media-state="ready"] .media-placeholder{display:none}.media-frame[data-media-state="error"] [data-zoom]{display:none}
details{margin-top:16px}summary{cursor:pointer;font-weight:600;font-size:14px;overflow-wrap:anywhere}.review-list{padding:0;list-style:none}.review-list li{padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.review-list p{white-space:pre-wrap;font-size:14px;margin-top:6px}.reference-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px;margin-top:12px}
.method-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.method{font-size:14px;min-width:0;scroll-margin-top:20px}.method dl{display:grid;grid-template-columns:minmax(80px,1fr) 2fr;gap:6px 12px;margin:12px 0}.method dt{color:var(--muted)}.method dd{margin:0;overflow-wrap:anywhere}
dialog{border:1px solid #bbc7d2;border-radius:4px;width:min(1100px,94vw);max-height:94vh;padding:16px}dialog::backdrop{background:rgba(15,24,35,.72)}dialog img{display:block;max-width:100%;max-height:78vh;margin:12px auto;object-fit:contain}dialog button{float:right}.print-link{display:none}footer{padding:26px 0;color:var(--muted);font-size:12px}
@media(max-width:650px){.container{padding:20px 16px}h1{font-size:24px}.conclusion h2{font-size:23px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 16px}.metric strong{font-size:21px}.charts,.method-grid{grid-template-columns:1fr}.case-report{padding:16px}.case-report>header{display:block}.case-result{max-width:100%;text-align:left;margin-top:8px}nav{gap:8px 18px}.basis{font-size:17px}th,td{padding:9px}section{padding:24px 0}.report-meta{gap:6px 16px}}
@media print{@page{size:A4;margin:14mm}body{background:white;font-size:10pt}.container{max-width:none;padding:0}nav,.case-toolbar,#case-count,button,dialog,.media-status,noscript{display:none!important}section{padding:18px 0}.case-report[hidden]{display:block!important}.case-report{margin:16px 0;padding:14px;break-inside:auto}.case-report>header,h2,h3{break-after:avoid}.chart,figure,.metric,tr{break-inside:avoid}details>*{display:block!important}.prompt-preview{display:none}.prompt-full{display:block!important}.text-output{max-height:none;overflow:visible}.table-wrap{overflow:visible}table{font-size:9pt}th{background:#eee!important}svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}.matrix td{print-color-adjust:exact}.print-link{display:block!important;word-break:break-all;font-size:8pt}.media-frame figcaption>a{display:none}.media-stage{max-height:180px}.outputs{grid-template-columns:repeat(2,minmax(0,1fr))}.metrics{gap:16px}.metric strong{font-size:17pt}a{color:inherit}footer{font-size:8pt}}
`;

// Enhancement only: report content and chart values are already present in the document.
export const reportScript = String.raw`
(() => {
  const cases = Array.from(document.querySelectorAll('#cases article.case-report'));
  const search = document.getElementById('case-search');
  const outcome = document.getElementById('case-outcome');
  const dimension = document.getElementById('case-dimension');
  const count = document.getElementById('case-count');
  const updateCases = () => {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    cases.forEach(entry => {
      const dimensions = JSON.parse(entry.dataset.dimensions || '[]');
      entry.hidden = !(entry.dataset.search.includes(query) && (!outcome.value || entry.dataset.outcome === outcome.value) && (!dimension.value || dimensions.includes(dimension.value)));
      if (!entry.hidden) visible++;
    });
    count.textContent = '显示 ' + visible + ' / ' + cases.length + ' 条案例；上方统计保持导出时范围。';
  };
  search.addEventListener('input', updateCases);
  outcome.addEventListener('change', updateCases);
  dimension.addEventListener('change', updateCases);
  document.getElementById('reset-cases').addEventListener('click', () => {
    search.value = ''; outcome.value = ''; dimension.value = ''; updateCases();
  });
  const queue = [];
  let active = 0;
  const pump = () => {
    while (active < 6 && queue.length) {
      const frame = queue.shift();
      if (frame.dataset.mediaState !== 'queued') continue;
      const media = frame.querySelector('[data-src]');
      active++;
      frame.dataset.mediaState = 'loading';
      frame.querySelector('.media-status').textContent = '加载中';
      let finished = false;
      const done = success => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        media.removeEventListener('load', loaded);
        media.removeEventListener('loadedmetadata', loaded);
        media.removeEventListener('error', failed);
        frame.dataset.mediaState = success ? 'ready' : 'error';
        frame.querySelector('.media-placeholder').textContent = success ? '' : '预览暂不可用';
        frame.querySelector('.media-status').textContent = success ? '可预览' : '媒体不可用，可能已过期、受权限限制或网络不可达';
        frame.querySelector('[data-retry]').hidden = success;
        if (!success) { media.removeAttribute('src'); if (media.load) media.load(); }
        active--; pump();
      };
      const loaded = () => done(true);
      const failed = () => done(false);
      const timer = setTimeout(failed, 20000);
      media.addEventListener('load', loaded);
      media.addEventListener('loadedmetadata', loaded);
      media.addEventListener('error', failed);
      media.src = media.dataset.src;
      if (media.load) media.load();
    }
  };
  const enqueue = frame => {
    if (!['idle','error'].includes(frame.dataset.mediaState)) return;
    frame.dataset.mediaState = 'queued'; queue.push(frame); pump();
  };
  const frames = Array.from(document.querySelectorAll('figure.media-frame[data-media-state]'));
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) { enqueue(entry.target); observer.unobserve(entry.target); } });
  }, {rootMargin: '200px'}) : null;
  frames.forEach(frame => {
    frame.querySelector('[data-retry]').addEventListener('click', () => enqueue(frame));
    if (observer) observer.observe(frame); else enqueue(frame);
  });
  const dialog = document.getElementById('media-dialog');
  let trigger;
  document.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => {
    trigger = button;
    const source = button.closest('figure').querySelector('img[data-src]');
    dialog.querySelector('img').src = source.dataset.src;
    dialog.querySelector('img').alt = source.alt;
    dialog.showModal();
  }));
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.querySelector('img').removeAttribute('src'); if (trigger) trigger.focus(); });
  let printState;
  window.addEventListener('beforeprint', () => {
    if (printState) return;
    printState = {hidden: cases.map(entry => entry.hidden), details: Array.from(document.querySelectorAll('details')).map(entry => [entry, entry.open])};
    cases.forEach(entry => entry.hidden = false);
    printState.details.forEach(([entry]) => entry.open = true);
  });
  window.addEventListener('afterprint', () => {
    if (!printState) return;
    cases.forEach((entry, index) => entry.hidden = printState.hidden[index]);
    printState.details.forEach(([entry, open]) => entry.open = open);
    printState = null;
  });
})();
`;
