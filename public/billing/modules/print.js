import { formatMoney, formatQty, formatDate } from './ui.js';
import { getState } from './state.js';
import { amountInWords } from '../../services/words.js';

export function printDocument(doc) {
  const container = document.getElementById('print-sheet-container');
  if (!container) return;

  const settings = getState().storeSettings || {
    businessName: 'Devi Electrical',
    address: 'Tc1/3885, Devi Building, opp. Krishna Theatre, Bypass Junction, Kazhakkoottam, Thiruvananthapuram, Kerala 695582',
    phone: '094472 20411',
    stateCode: '32',
    stateName: 'Kerala',
    gstRegistered: false
  };

  const isQuotation = doc.doc_type === 'quotation';
  const isChallan = doc.doc_type === 'challan';
  const isGst = settings.gstRegistered;

  let title = 'Cash Bill';
  if (isQuotation) title = 'QUOTATION / ESTIMATE';
  else if (isChallan) title = 'DELIVERY CHALLAN';
  else if (isGst) title = doc.customer_snapshot?.gstin ? 'TAX INVOICE' : 'RETAIL INVOICE';

  const words = amountInWords(doc.grand_total);

  container.innerHTML = `
    <div class="p-8 max-w-[210mm] mx-auto bg-white text-navy font-sans text-xs leading-normal">
      <!-- Header -->
      <div class="flex justify-between items-start pb-4 border-b-2 border-navy">
        <div>
          <h1 class="text-2xl font-black text-navy uppercase tracking-tight">${settings.businessName}</h1>
          <p class="text-xs text-navy-700 max-w-sm mt-1">${settings.address}</p>
          <p class="text-xs font-semibold text-navy mt-1">Phone: ${settings.phone}</p>
          ${settings.gstin ? `<p class="text-xs font-mono font-bold text-navy">GSTIN: ${settings.gstin}</p>` : ''}
          <p class="text-[11px] text-navy-600">State: ${settings.stateName} (Code: ${settings.stateCode})</p>
        </div>
        <div class="text-right">
          <span class="text-lg font-black uppercase tracking-wider block text-navy">${title}</span>
          <p class="text-xs font-bold font-mono mt-1">${doc.doc_number || '(DRAFT)'}</p>
          <p class="text-xs text-navy-600 mt-1">Date: ${formatDate(doc.doc_date)}</p>
          ${doc.due_date ? `<p class="text-xs text-navy-600">Due: ${formatDate(doc.due_date)}</p>` : ''}
        </div>
      </div>

      <!-- Bill To & Place of Supply -->
      <div class="grid grid-cols-2 gap-4 py-4 border-b border-navy-200 text-xs">
        <div>
          <span class="font-bold uppercase text-[10px] text-navy-500 block mb-1">Billed To:</span>
          <span class="font-bold text-sm block">${doc.customer_snapshot?.name || doc.customer_name || 'Walk-in Customer'}</span>
          ${doc.customer_snapshot?.address ? `<p class="text-navy-600">${doc.customer_snapshot.address}</p>` : ''}
          ${doc.customer_snapshot?.phone ? `<p class="text-navy-600">Phone: ${doc.customer_snapshot.phone}</p>` : ''}
          ${doc.customer_snapshot?.gstin ? `<p class="font-mono font-bold text-navy">GSTIN: ${doc.customer_snapshot.gstin}</p>` : ''}
        </div>
        <div class="text-right">
          <span class="font-bold uppercase text-[10px] text-navy-500 block mb-1">Dispatch / Supply Details:</span>
          <p class="text-navy-700"><span class="font-semibold">Place of Supply:</span> State Code ${doc.place_of_supply}</p>
          <p class="text-navy-700"><span class="font-semibold">Nature of Supply:</span> ${doc.is_interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</p>
        </div>
      </div>

      <!-- Items Table -->
      <table class="w-full text-left my-4 text-xs border-collapse">
        <thead>
          <tr class="border-b-2 border-navy text-navy font-bold uppercase text-[10px]">
            <th class="py-2 px-1 w-6">#</th>
            <th class="py-2 px-2">Description of Goods</th>
            <th class="py-2 px-2 w-16">HSN</th>
            <th class="py-2 px-2 w-16 text-right">Qty</th>
            <th class="py-2 px-2 w-16 text-right">Rate</th>
            <th class="py-2 px-2 w-14 text-right">Disc</th>
            <th class="py-2 px-2 w-16 text-right">Taxable</th>
            ${isGst ? '<th class="py-2 px-2 w-12 text-center">GST</th>' : ''}
            <th class="py-2 px-2 w-20 text-right">Total</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-navy-100">
          ${doc.lines.map((l, i) => `
            <tr>
              <td class="py-1.5 px-1 text-navy-400">${i + 1}</td>
              <td class="py-1.5 px-2 font-bold">${l.description}</td>
              <td class="py-1.5 px-2 font-mono text-navy-500">${l.hsn || '-'}</td>
              <td class="py-1.5 px-2 text-right font-medium">${formatQty(l.qty, l.unit)}</td>
              <td class="py-1.5 px-2 text-right">${formatMoney(l.rate)}</td>
              <td class="py-1.5 px-2 text-right text-navy-500">${formatMoney(l.discount_amount)}</td>
              <td class="py-1.5 px-2 text-right font-medium">${formatMoney(l.taxable_amount)}</td>
              ${isGst ? `<td class="py-1.5 px-2 text-center">${l.gst_rate}%</td>` : ''}
              <td class="py-1.5 px-2 text-right font-bold">${formatMoney(l.line_total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- Totals & Words -->
      <div class="border-t-2 border-navy pt-3 grid grid-cols-12 gap-4">
        <div class="col-span-7 space-y-3">
          <div>
            <span class="font-bold uppercase text-[10px] text-navy-500 block">Amount in Words:</span>
            <p class="font-bold text-xs text-navy italic">${words}</p>
          </div>

          <!-- Bank & UPI Details -->
          ${settings.bankAccount || settings.upiId ? `
            <div class="pt-2 text-[11px] text-navy-700 bg-navy-50 p-3 rounded-lg border border-navy-200">
              <span class="font-bold uppercase text-[10px] text-navy-600 block mb-1">Bank & Payment Details:</span>
              ${settings.bankName ? `<p>Bank: ${settings.bankName} • A/C: ${settings.bankAccount}</p>` : ''}
              ${settings.bankIfsc ? `<p>IFSC: ${settings.bankIfsc} • Branch: ${settings.bankBranch || 'Kazhakkoottam'}</p>` : ''}
              ${settings.upiId ? `<p class="font-semibold text-navy">UPI ID: ${settings.upiId}</p>` : ''}
            </div>
          ` : ''}

          <!-- Terms -->
          <div class="text-[10px] text-navy-500 pt-2">
            <span class="font-bold uppercase block">Terms & Conditions:</span>
            <p>${doc.terms || settings.termsAndConditions || 'Goods once sold are covered under manufacturer warranty.'}</p>
          </div>
        </div>

        <div class="col-span-5 space-y-1.5 text-right text-xs">
          <div class="flex justify-between">
            <span class="text-navy-600">Taxable Amount:</span>
            <span class="font-bold">${formatMoney(doc.taxable_amount)}</span>
          </div>
          ${doc.cgst_amount > 0 ? `
            <div class="flex justify-between">
              <span class="text-navy-600">CGST:</span>
              <span class="font-bold">${formatMoney(doc.cgst_amount)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-navy-600">SGST:</span>
              <span class="font-bold">${formatMoney(doc.sgst_amount)}</span>
            </div>
          ` : ''}
          ${doc.igst_amount > 0 ? `
            <div class="flex justify-between">
              <span class="text-navy-600">IGST:</span>
              <span class="font-bold">${formatMoney(doc.igst_amount)}</span>
            </div>
          ` : ''}
          ${doc.extra_charges > 0 ? `
            <div class="flex justify-between">
              <span class="text-navy-600">Extra Charges:</span>
              <span class="font-bold">${formatMoney(doc.extra_charges)}</span>
            </div>
          ` : ''}
          ${doc.round_off !== 0 ? `
            <div class="flex justify-between">
              <span class="text-navy-600">Round Off:</span>
              <span class="font-bold">${formatMoney(doc.round_off)}</span>
            </div>
          ` : ''}
          <div class="flex justify-between text-base font-black text-navy pt-2 border-t border-navy-300">
            <span>Grand Total:</span>
            <span>${formatMoney(doc.grand_total)}</span>
          </div>
        </div>
      </div>

      <!-- Signatures Footer -->
      <div class="flex justify-between items-end pt-12 mt-6 border-t border-navy-200">
        <div class="text-[10px] text-navy-400">
          This is a computer-generated document.
        </div>
        <div class="text-center w-48">
          <div class="h-10 border-b border-navy-400 mb-1"></div>
          <span class="font-bold text-[10px] uppercase text-navy">Authorised Signatory</span>
          <span class="block text-[9px] text-navy-500 font-semibold">${settings.businessName}</span>
        </div>
      </div>
    </div>
  `;

  window.print();
}

export default {
  printDocument
};
