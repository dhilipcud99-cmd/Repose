(function(){
  // ---------- Skeleton drawing helper (signature motif) ----------
  function skeletonSVG(pose, colorJoint, colorBone){
    // pose: array of [x1,y1,x2,y2] bone segments + joints derived from endpoints
    const bones = pose.map(([x1,y1,x2,y2]) =>
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colorBone}" stroke-width="3" stroke-linecap="round"/>`
    ).join('');
    const pts = new Set();
    pose.forEach(([x1,y1,x2,y2]) => { pts.add(x1+','+y1); pts.add(x2+','+y2); });
    const joints = Array.from(pts).map(p => {
      const [x,y] = p.split(',');
      return `<circle cx="${x}" cy="${y}" r="4.5" fill="${colorJoint}"/>`;
    }).join('');
    return bones + joints;
  }

  const poseA = [ // neutral standing
    [100,40, 100,90],[100,60,70,80],[100,60,130,80],[100,90,80,140],[100,90,120,140],[80,140,75,190],[120,140,125,190]
  ];
  const poseB = [ // arms raised / dynamic
    [100,40, 100,90],[100,55,60,40],[100,55,140,40],[100,90,75,135],[100,90,125,135],[75,135,60,185],[125,135,140,185]
  ];

  function mountSkeleton(elId, jointColor, boneColor, animate){
    const g = document.getElementById(elId);
    if(!g) return;
    g.innerHTML = skeletonSVG(poseA, jointColor, boneColor);
    if(!animate) return;
    let toggled = false;
    setInterval(() => {
      toggled = !toggled;
      g.innerHTML = skeletonSVG(toggled ? poseB : poseA, jointColor, boneColor);
    }, 1400);
  }
  mountSkeleton('hero-skeleton', '#FF5A3C', '#3a3a46', true);
  mountSkeleton('empty-skeleton', '#34D1BF', '#3a3a46', true);
  mountSkeleton('loading-skeleton-g', '#FF5A3C', '#4a4a58', true);

  // ---------- State ----------
  const state = { sourceFile:null, sourceURL:null, refFile:null, afterURL:null };

  // ---------- Dropzone wiring ----------
  function wireDropzone(zoneId, inputId, onFile){
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    // Prevent the click event on input from bubbling up to the zone, which triggers an infinite click loop
    input.addEventListener('click', (e) => e.stopPropagation());
    zone.addEventListener('click', (e) => { if(!e.target.closest('.remove')) input.click(); });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag');
      if(e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if(input.files[0]) onFile(input.files[0]); });
  }

  function showPreviewInZone(zoneId, file){
    const zone = document.getElementById(zoneId);
    const url = URL.createObjectURL(file);
    zone.querySelector('.dz-content')?.remove();
    zone.querySelectorAll('img,.remove').forEach(n => n.remove());
    const img = document.createElement('img');
    img.src = url;
    const btn = document.createElement('button');
    btn.className = 'remove'; btn.type='button'; btn.innerHTML = '&times;';
    zone.appendChild(img);
    zone.appendChild(btn);
    return url;
  }

  function resetZone(zoneId, hintHTML){
    const zone = document.getElementById(zoneId);
    zone.querySelectorAll('img,.remove').forEach(n => n.remove());
    if(!zone.querySelector('.dz-content')){
      const div = document.createElement('div');
      div.className = 'dz-content';
      div.innerHTML = hintHTML;
      zone.appendChild(div);
    }
  }

  const sourceHint = `<svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><div class="hint"><b>Click to upload</b> or drag a photo<br>JPG, PNG, WEBP · up to 10MB</div>`;
  const refHint = `<svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg><div class="hint">Upload a photo of the exact pose to copy — used instead of, or alongside, the text description</div>`;

  wireDropzone('dz-source', 'input-source', (file) => {
    if(!file.type.startsWith('image/')) return showError('Please upload an image file.');
    if(file.size > 10*1024*1024) return showError('Image is larger than 10MB.');
    state.sourceFile = file;
    state.sourceURL = showPreviewInZone('dz-source', file);
    document.getElementById('dz-source').querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation(); state.sourceFile = null; state.sourceURL = null;
      resetZone('dz-source', sourceHint); updateGenerateState();
    });
    updateGenerateState();
  });

  wireDropzone('dz-ref', 'input-ref', (file) => {
    if(!file.type.startsWith('image/')) return showError('Please upload an image file.');
    state.refFile = file;
    showPreviewInZone('dz-ref', file);
    document.getElementById('dz-ref').querySelector('.remove').addEventListener('click', (e) => {
      e.stopPropagation(); state.refFile = null; resetZone('dz-ref', refHint);
    });
  });

  document.getElementById('input-prompt').addEventListener('input', updateGenerateState);
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('input-prompt').value = chip.dataset.fill;
      updateGenerateState();
    });
  });

  const strengthInput = document.getElementById('input-strength');
  strengthInput.addEventListener('input', () => {
    document.getElementById('strength-val').textContent = strengthInput.value + '%';
  });

  function updateGenerateState(){
    const promptFilled = document.getElementById('input-prompt').value.trim().length > 0;
    document.getElementById('btn-generate').disabled = !(state.sourceFile && (promptFilled || state.refFile));
  }

  function showError(msg){
    const box = document.getElementById('error-box');
    box.textContent = msg; box.classList.add('show');
    setTimeout(() => box.classList.remove('show'), 5000);
  }

  // ---------- Tabs ----------
  document.getElementById('tab-compare').addEventListener('click', () => setTab('compare'));
  document.getElementById('tab-after').addEventListener('click', () => setTab('after'));
  function setTab(which){
    document.getElementById('tab-compare').classList.toggle('active', which==='compare');
    document.getElementById('tab-after').classList.toggle('active', which==='after');
    document.getElementById('compare-wrap').classList.toggle('active', which==='compare' && !!state.afterURL);
    document.getElementById('single-after').classList.toggle('active', which==='after' && !!state.afterURL);
  }

  // ---------- Compare slider ----------
  const range = document.getElementById('compare-range');
  const afterClip = document.getElementById('after-clip');
  const handle = document.getElementById('compare-handle');
  range.addEventListener('input', () => {
    const v = range.value;
    afterClip.style.clipPath = `polygon(0 0, ${v}% 0, ${v}% 100%, 0 100%)`;
    handle.style.left = v + '%';
  });

  // ---------- Generate ----------
  const loadingMessages = ['ANALYZING JOINTS...', 'MAPPING SKELETON...', 'REPOSING BODY...', 'RESTORING FACE & OUTFIT...', 'FINALIZING FRAME...'];
  document.getElementById('btn-generate').addEventListener('click', async () => {
    const btn = document.getElementById('btn-generate');
    btn.disabled = true;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('loading-state').classList.add('active');

    let msgIdx = 0;
    const loadingTextEl = document.getElementById('loading-text');
    const msgTimer = setInterval(() => {
      msgIdx = (msgIdx + 1) % loadingMessages.length;
      loadingTextEl.textContent = loadingMessages[msgIdx];
    }, 1100);

    try {
      const formData = new FormData();
      formData.append('image', state.sourceFile);
      formData.append('prompt', document.getElementById('input-prompt').value.trim());
      formData.append('strength', strengthInput.value);
      if(state.refFile) formData.append('reference_pose', state.refFile);

      // Determine backend URL (relative for local, absolute for Render deployment)
      const host = window.location.hostname;
      const backendBase = (host === 'localhost' || host === '127.0.0.1') ? '' : 'https://repose-jlz4.onrender.com';
      const res = await fetch(`${backendBase}/api/generate-pose`, { method: 'POST', body: formData });
      if(!res.ok){
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || 'Generation failed. Please try again.');
      }
      const data = await res.json();
      state.afterURL = data.imageUrl; // backend returns a URL or base64 data URI

      document.getElementById('img-before').src = state.sourceURL;
      document.getElementById('img-after').src = state.afterURL;
      document.getElementById('img-after-solo').src = state.afterURL;
      document.getElementById('btn-download').disabled = false;
      setTab('compare');
      range.value = 50;
      afterClip.style.clipPath = `polygon(0 0, 50% 0, 50% 100%, 0 100%)`;
      handle.style.left = '50%';
    } catch(err){
      showError(err.message || 'Something went wrong while generating the image.');
      document.getElementById('empty-state').style.display = 'block';
    } finally {
      clearInterval(msgTimer);
      document.getElementById('loading-state').classList.remove('active');
      btn.disabled = false;
    }
  });

  // ---------- Download ----------
  document.getElementById('btn-download').addEventListener('click', async () => {
    if(!state.afterURL) return;
    const a = document.createElement('a');
    a.href = state.afterURL;
    a.download = 'repose-result.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
})();
