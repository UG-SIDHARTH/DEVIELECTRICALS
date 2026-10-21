/**
 * Converts Indian currency amounts in paise into official words.
 * Standard format: "Rupees Twelve Thousand Five Hundred Only"
 * With paise: "Rupees Twelve Thousand Five Hundred and Fifty Paise Only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertBelowThousand(n) {
  let str = '';
  if (n >= 100) {
    str += ONES[Math.floor(n / 100)] + ' Hundred ';
    n %= 100;
  }
  if (n >= 20) {
    str += TENS[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ONES[n % 10] : '');
  } else if (n > 0) {
    str += ONES[n];
  }
  return str.trim();
}

/**
 * Converts integer rupees into Indian words (Crore, Lakh, Thousand, Hundred).
 */
function rupeesToWords(rupees) {
  if (rupees === 0) return 'Zero';

  let str = '';
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;

  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;

  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;

  const remainder = rupees;

  if (crore > 0) {
    str += convertBelowThousand(crore) + ' Crore ';
  }
  if (lakh > 0) {
    str += convertBelowThousand(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    str += convertBelowThousand(thousand) + ' Thousand ';
  }
  if (remainder > 0) {
    str += convertBelowThousand(remainder) + ' ';
  }

  return str.trim();
}

/**
 * Converts paise into full Indian currency wording.
 *
 * @param {number|bigint} amountPaise - Amount in integer paise
 * @returns {string} Currency in words
 */
export function amountInWords(amountPaise) {
  const totalPaise = Math.round(Number(amountPaise) || 0);
  if (totalPaise === 0) {
    return 'Rupees Zero Only';
  }

  const isNegative = totalPaise < 0;
  const absPaise = Math.abs(totalPaise);

  const rupees = Math.floor(absPaise / 100);
  const paise = absPaise % 100;

  let words = (isNegative ? 'Minus ' : '') + 'Rupees ' + rupeesToWords(rupees);

  if (paise > 0) {
    words += ' and ' + convertBelowThousand(paise) + ' Paise';
  }

  return words + ' Only';
}

export default amountInWords;
