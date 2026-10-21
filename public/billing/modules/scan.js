import api from './api.js';
import { formatMoney, formatQty, showToast } from './ui.js';
import { setRoute } from './state.js';

let tesseractWorker = null;

export function renderScan(container) {
  container.innerHTML = `
    <div class="space-y-6">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 class="text-2xl font-black text-navy tracking-tight">Material List Photo-Scan (OCR)</h2>
          <p class="text-xs text-navy-500 font-medium">Capture or paste handwritten electrician lists to generate draft bills</p>
        </div>
      </div>

      <!-- Input Tabs: Photo / Upload / Paste -->
      <div class="bg-white rounded-2xl border border-surface-border p-6 shadow-card space-y-6">
        <div class="flex flex-wrap gap-2 border-b border-navy-100 pb-3">
          <button id="tab-btn-camera" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-navy text-white shadow-card flex items-center gap-1.5">
            <span>📷</span> Take Photo
          </button>
          <button id="tab-btn-upload" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white text-navy-700 border border-navy-200 hover:bg-navy-50 flex items-center gap-1.5">
            <span>📁</span> Upload Image
          </button>
          <button id="tab-btn-paste" class="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white text-navy-700 border border-navy-200 hover:bg-navy-50 flex items-center gap-1.5">
            <span>📝</span> Type / Paste List
          </button>
        </div>

        <!-- Hidden File Inputs -->
        <input type="file" id="scan-camera-input" accept="image/*" capture="environment" class="hidden">
        <input type="file" id="scan-file-input" accept="image/jpeg,image/png,image/webp" class="hidden">

        <!-- Image Preview & Canvas Controls Area -->
        <div id="scan-image-preview-area" class="hidden space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-navy">Captured Material Image</span>
            <div class="flex gap-2">
              <button id="btn-rotate-img" class="px-3 py-1 bg-navy-100 rounded-lg text-xs font-bold">↻ Rotate</button>
              <button id="btn-enhance-img" class="px-3 py-1 bg-navy-100 rounded-lg text-xs font-bold">✨ Enhance Contrast</button>
            </div>
          </div>
          <div class="max-h-96 overflow-hidden rounded-xl border border-navy-200 flex items-center justify-center bg-navy-950/5">
            <canvas id="scan-canvas" class="max-h-96 max-w-full object-contain"></canvas>
          </div>
          <button id="btn-start-ocr" class="w-full bg-navy text-white font-bold py-3 rounded-xl shadow-card">
            Run On-Device OCR Scan
          </button>
        </div>

        <!-- Progress Bar -->
        <div id="ocr-progress-container" class="hidden space-y-2">
          <div class="flex justify-between text-xs font-bold text-navy">
            <span id="ocr-progress-status">Initializing OCR Engine...</span>
            <span id="ocr-progress-pct">0%</span>
          </div>
          <div class="w-full bg-navy-100 h-2.5 rounded-full overflow-hidden">
            <div id="ocr-progress-bar" class="bg-amber h-full w-0 transition-all duration-200"></div>
          </div>
          <button id="btn-cancel-ocr" class="text-xs text-rose-600 font-bold hover:underline">Cancel OCR</button>
        </div>

        <!-- Recognized / Editable Text Area -->
        <div id="scan-text-area" class="space-y-3">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-bold text-navy-700">Scanned Items (Editable Text)</label>
            <span class="text-[11px] text-navy-500">Edit lines before matching</span>
          </div>
          <textarea id="raw-ocr-textarea" rows="6" placeholder="e.g.&#10;2 coil 1.5 sqmm wire&#10;10 nos 6A switch&#10;MCB 32A (5)" class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-navy-200 font-mono"></textarea>
          <div class="p-3 bg-amber-light/30 border border-amber/30 rounded-xl text-navy text-[11px] font-medium">
            ⚠️ Note: Handwritten lists or low-light photos may need small corrections. Always review recognized lines before finalizing.
          </div>
          <button id="btn-parse-match" class="w-full bg-emerald-dark hover:bg-emerald text-white font-bold py-3 rounded-xl shadow-card flex items-center justify-center gap-2">
            <span>⚡</span> Parse & Match with Catalog Products
          </button>
        </div>
      </div>

      <!-- Match Review Screen -->
      <div id="scan-review-container" class="hidden bg-white rounded-2xl border border-surface-border p-6 shadow-card space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-navy-100">
          <div>
            <h3 class="text-lg font-bold text-navy">Review & Match Verification</h3>
            <span class="text-xs text-navy-500">Verify matched catalog items, electrical specs, and billing quantities</span>
          </div>
          <div class="flex items-center gap-2">
            <button id="btn-add-to-quote" class="px-3.5 py-2 rounded-xl border border-navy-200 font-bold text-navy hover:bg-navy-50 text-xs">
              Add to Quotation Draft
            </button>
            <button id="btn-add-to-invoice" class="px-4 py-2 rounded-xl bg-navy text-white font-bold text-xs shadow-card">
              Add to Invoice Draft
            </button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs" id="review-table">
            <thead class="bg-navy-50 text-navy-700 uppercase font-bold text-[10px] tracking-wider border-b border-navy-200">
              <tr>
                <th class="py-3 px-3">Scanned Text</th>
                <th class="py-3 px-4">Matched Product</th>
                <th class="py-3 px-3 text-center">Confidence</th>
                <th class="py-3 px-3 text-right">Qty</th>
                <th class="py-3 px-3">Unit</th>
                <th class="py-3 px-3 text-right">Selling Rate</th>
                <th class="py-3 px-3 text-right">Available Stock</th>
                <th class="py-3 px-2 text-center"></th>
              </tr>
            </thead>
            <tbody id="review-tbody" class="divide-y divide-navy-100"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#scan-canvas');
  const ctx = canvas.getContext('2d');
  let currentImage = null;
  let rotationDeg = 0;
  let isEnhanced = false;
  let reviewItems = [];

  // Tab Listeners
  const cameraInput = container.querySelector('#scan-camera-input');
  const fileInput = container.querySelector('#scan-file-input');

  container.querySelector('#tab-btn-camera').addEventListener('click', () => cameraInput.click());
  container.querySelector('#tab-btn-upload').addEventListener('click', () => fileInput.click());

  function handleImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        rotationDeg = 0;
        isEnhanced = false;
        container.querySelector('#scan-image-preview-area').classList.remove('hidden');
        drawImage();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  cameraInput.addEventListener('change', (e) => handleImageFile(e.target.files[0]));
  fileInput.addEventListener('change', (e) => handleImageFile(e.target.files[0]));

  function drawImage() {
    if (!currentImage) return;

    // Downscale if image exceeds 2000px
    let w = currentImage.width;
    let h = currentImage.height;
    const maxDim = 2000;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    if (rotationDeg % 180 === 90) {
      canvas.width = h;
      canvas.height = w;
    } else {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    if (rotationDeg % 180 === 90) {
      ctx.drawImage(currentImage, -h / 2, -w / 2, h, w);
    } else {
      ctx.drawImage(currentImage, -w / 2, -h / 2, w, h);
    }
    ctx.restore();

    if (isEnhanced) {
      // Apply grayscale and contrast stretch via canvas pixel manipulation
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        // Luminance grayscale
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        // High contrast curve
        const factor = 1.3;
        const enhanced = Math.min(255, Math.max(0, factor * (v - 128) + 128));
        d[i] = enhanced;
        d[i + 1] = enhanced;
        d[i + 2] = enhanced;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  }

  container.querySelector('#btn-rotate-img').addEventListener('click', () => {
    rotationDeg = (rotationDeg + 90) % 360;
    drawImage();
  });

  container.querySelector('#btn-enhance-img').addEventListener('click', () => {
    isEnhanced = !isEnhanced;
    drawImage();
  });

  // Self-Hosted Tesseract OCR Execution
  container.querySelector('#btn-start-ocr').addEventListener('click', async () => {
    const progressContainer = container.querySelector('#ocr-progress-container');
    const progressBar = container.querySelector('#ocr-progress-bar');
    const progressStatus = container.querySelector('#ocr-progress-status');
    const progressPct = container.querySelector('#ocr-progress-pct');

    progressContainer.classList.remove('hidden');

    try {
      if (typeof Tesseract === 'undefined') {
        throw new Error('Self-hosted Tesseract library not loaded. Type or paste your material list below.');
      }

      progressStatus.textContent = 'Loading local English language model...';
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/tesseract-core.wasm.js',
        langPath: '/vendor/tesseract',
        logger: (m) => {
          if (m.status === 'recognizing text') {
            const pct = Math.round((m.progress || 0) * 100);
            progressBar.style.width = `${pct}%`;
            progressPct.textContent = `${pct}%`;
            progressStatus.textContent = 'Recognizing electrician handwriting...';
          }
        }
      });

      tesseractWorker = worker;

      const { data: { text } } = await worker.recognize(canvas);
      await worker.terminate();
      tesseractWorker = null;

      progressContainer.classList.add('hidden');
      const textarea = container.querySelector('#raw-ocr-textarea');
      textarea.value = text;
      showToast('OCR recognized text successfully', 'success');
    } catch (err) {
      progressContainer.classList.add('hidden');
      showToast(`OCR Notice: ${err.message}`, 'warning');
    }
  });

  container.querySelector('#btn-cancel-ocr')?.addEventListener('click', () => {
    if (tesseractWorker) {
      tesseractWorker.terminate();
      tesseractWorker = null;
    }
    container.querySelector('#ocr-progress-container').classList.add('hidden');
    showToast('OCR operation cancelled', 'info');
  });

  // Parse & Match Button
  container.querySelector('#btn-parse-match').addEventListener('click', async () => {
    const rawText = container.querySelector('#raw-ocr-textarea').value.trim();
    if (!rawText) {
      showToast('Please type or scan some text first', 'warning');
      return;
    }

    try {
      const res = await api.post('/api/scan/parse', { rawText });
      reviewItems = res.items || [];
      renderReviewScreen();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  function renderReviewScreen() {
    const reviewWrapper = container.querySelector('#scan-review-container');
    const tbody = container.querySelector('#review-tbody');
    reviewWrapper.classList.remove('hidden');

    tbody.innerHTML = reviewItems.map((itm, idx) => {
      let badge = '<span class="px-2 py-0.5 rounded font-bold uppercase text-[9px] bg-rose-100 text-rose-700">Not Found</span>';
      if (itm.confidence === 'matched') {
        badge = '<span class="px-2 py-0.5 rounded font-bold uppercase text-[9px] bg-emerald/10 text-emerald-dark">Matched</span>';
      } else if (itm.confidence === 'check') {
        badge = '<span class="px-2 py-0.5 rounded font-bold uppercase text-[9px] bg-amber-light text-navy">Check</span>';
      }

      return `
        <tr class="hover:bg-navy-50/50">
          <td class="py-2.5 px-3 font-medium text-navy-600">${itm.originalText}</td>
          <td class="py-2.5 px-4">
            <span class="font-bold text-navy block">${itm.matchedProduct ? itm.matchedProduct.name : itm.description}</span>
            ${itm.suggestions && itm.suggestions.length > 1 ? `
              <select class="alt-select mt-1 text-[11px] p-1 rounded border border-navy-200 bg-white" data-idx="${idx}">
                <option value="">Switch to alternative (${itm.suggestions.length} options)...</option>
                ${itm.suggestions.map(s => `<option value="${s.id}">${s.name} (₹${(s.sellingPrice / 100).toFixed(2)}) - ${s.score}%</option>`).join('')}
              </select>
            ` : ''}
          </td>
          <td class="py-2.5 px-3 text-center">${badge}</td>
          <td class="py-2.5 px-3 text-right">
            <input type="number" step="any" min="0.001" class="rev-qty w-16 text-right px-2 py-1 rounded border border-navy-200" value="${itm.qty}">
          </td>
          <td class="py-2.5 px-3">${itm.unit}</td>
          <td class="py-2.5 px-3 text-right font-medium text-navy">${formatMoney(itm.matchedProduct?.sellingPrice || 0)}</td>
          <td class="py-2.5 px-3 text-right font-bold ${itm.matchedProduct && itm.matchedProduct.currentStock <= 0 ? 'text-rose-600' : 'text-navy'}">
            ${itm.matchedProduct ? formatQty(itm.matchedProduct.currentStock, itm.matchedProduct.unit) : '-'}
          </td>
          <td class="py-2.5 px-2 text-center">
            <button class="btn-del-review text-navy-400 hover:text-rose-600 font-bold" data-idx="${idx}">✕</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.rev-qty').forEach((inp, i) => {
      inp.addEventListener('input', () => { reviewItems[i].qty = parseFloat(inp.value) || 1; });
    });
    tbody.querySelectorAll('.btn-del-review').forEach(btn => {
      btn.addEventListener('click', () => {
        reviewItems.splice(parseInt(btn.dataset.idx, 10), 1);
        renderReviewScreen();
      });
    });
  }

  // Add All to Draft (Quotation or Invoice)
  function handoffToDocument(docType) {
    if (reviewItems.length === 0) {
      showToast('No items to add', 'warning');
      return;
    }

    // Open normal editor as unsaved DRAFT
    setRoute('documents', {
      mode: 'create',
      docType,
      initialLines: reviewItems.map(itm => ({
        productId: itm.matchedProduct?.id || null,
        description: itm.matchedProduct ? itm.matchedProduct.name : itm.description,
        qty: itm.qty,
        unit: itm.unit,
        rate: itm.matchedProduct?.sellingPrice || 0,
        gstRate: itm.matchedProduct?.gstRate || 18
      }))
    });
  }

  container.querySelector('#btn-add-to-quote')?.addEventListener('click', () => handoffToDocument('quotation'));
  container.querySelector('#btn-add-to-invoice')?.addEventListener('click', () => handoffToDocument('invoice'));
}

export default {
  renderScan
};
