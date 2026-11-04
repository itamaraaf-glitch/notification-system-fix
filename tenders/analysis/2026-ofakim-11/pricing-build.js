// תמחור המרכזייה – אופקים 11/2026 (מסמך פנימי). הנתונים מהמודל הכלכלי.
// הרצה: python3 pricing-extract.py <model.xlsx> <p.json> && node pricing-build.js <p.json> <out.docx>
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, PageOrientation, BorderStyle, Footer, PageNumber,
} = require('docx');
const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const A = D.a;
const FONT = 'Arial';
const thin = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const nf = (v, d = 0) => (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const ils = (v, d = 0) => (v === null || v === undefined) ? '—' : (v < 0 ? '(' + nf(-v, d) + ') ₪' : nf(v, d) + ' ₪');
const p = (text, o = {}) => new Paragraph({
  bidirectional: !o.ltr, alignment: o.align || AlignmentType.RIGHT,
  spacing: { before: o.before ?? 0, after: o.after ?? 50 }, keepNext: !!o.keepNext,
  children: [new TextRun({ text, font: FONT, size: o.size || 19, bold: !!o.bold, color: o.color, rightToLeft: !o.ltr })],
});
const h = t => p(t, { bold: true, size: 26, color: '1F4E79', before: 220, after: 100, keepNext: true });
function table(head, rows, widths, o = {}) {
  const numCols = o.num || [];
  const cell = (t, i, fill, bold, color) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 45, bottom: 45, left: 80, right: 80 },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    children: String(t).split('\n').map(x => p(x, { bold, color, ltr: numCols.includes(i) && !fill, align: numCols.includes(i) ? AlignmentType.CENTER : AlignmentType.RIGHT })),
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, visuallyRightToLeft: true,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, '1F4E79', true, 'FFFFFF')) }),
      ...rows.map((r, k) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, (o.total && k === rows.length - 1) ? 'D9E2F3' : (o.red && o.red(k, i) ? 'F8CBAD' : undefined), (o.total && k === rows.length - 1) || i === 0)) })),
    ],
  });
}

// 1. סעיפים בשקלול
const W1 = [400, 3000, 800, 1100, 1100, 700, 900, 1200, 1250, 1300, 1300, 1788];
let sr = 0, sc = 0, sp = 0;
const rows1 = D.items.map(([n, name, unit, mn, mx, w, q36, qopt, our, cost, rev, c36, prof]) => {
  sr += rev; sc += c36; sp += prof;
  return [n, name, unit, ils(mn), ils(mx), w + '%', nf(q36), ils(our), ils(cost), ils(rev), ils(c36), ils(prof)];
});
rows1.push(['', 'סה"כ סעיפים בשקלול (36 חודשים)', '', '', '', '100%', '', '', '', ils(sr), ils(sc), ils(sp)]);

// 2. פירוק העלות של סעיף 1
const mCloud = A['28'] * A['8'];
const mIns = (Number(A['13']) + Number(A['14'])) / 12;
const W2 = [5500, 2000, 2000, 5338];
const rows2 = [
  ['מרכזייה מקומית (300, הרחבה עד 500) + Call Center מקומי – ציוד ורישוי', ils(A['4']), 'חד-פעמי', 'הבהרות 57, 58, 70, 93'],
  ['הקמה, התקנה, ממשקי CRM / AD / דוא"ל, הסבה והדרכה', ils(A['5']), 'חד-פעמי', 'הבהרות 8, 48, 80, 104–107'],
  ['פלטפורמת ענן – ' + nf(A['28']) + ' שלוחות ברישוי כפול × ' + ils(A['8'], 2), ils(mCloud), 'לחודש', 'הבהרות 57, 60'],
  ['רישוי Call Center – שני מוקדים × 30 שלוחות', ils(A['9']), 'לחודש', 'הבהרות 93, 111–113'],
  ['תמיכה, תחזוקה ו-SLA (כוח אדם)', ils(A['10']), 'לחודש', 'מפרט 6'],
  ['צירים – 300 ערוצי SIP', ils(A['29']), 'לחודש', 'הבהרות 61, 100'],
  ['קו תמסורת בין המרכזייה המקומית לענן', ils(A['30']), 'לחודש', 'הבהרות 55, 94'],
  ['ערבויות, ביטוח וקנסות SLA צפויים', ils(mIns), 'לחודש', 'הבהרות 79, 81, 85'],
  ['סה"כ עלות שוטפת', ils(A['25']), 'לחודש', '× 36 = ' + ils(36 * A['25'])],
  ['סה"כ עלות סעיף 1 ל-36 חודשים', ils(D.items[0][9]), '', 'מול מחיר 100,000–122,000 ₪'],
];

// 3. תוספות שאינן בשקלול
const W3 = [400, 5200, 1400, 1400, 1700, 1500, 1500, 1738];
const rows3 = D.opts.map(([n, name, mn, mx, our, cost, qty, prof]) =>
  [n, name, mn === null ? '—' : ils(mn), mx === null ? '—' : ils(mx), ils(our, our < 1 ? 3 : 0), ils(cost, cost < 1 ? 3 : 0), nf(qty, 1), ils(prof)]);
rows3.push(['', 'סה"כ רווח חודשי צפוי מתוספות', '', '', '', '', '', ils(D.optm)]);

const ft = t => new TextRun({ text: t, font: FONT, size: 16, rightToLeft: true });
const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 19 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 800, bottom: 800, left: 900, right: 900 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [
      ft('פנימי – לא להגשה | עמוד '), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }), ft(' מתוך '), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 })] })] }) },
    children: [
      p('מסמך פנימי – לא להגשה', { bold: true, color: 'C00000', align: AlignmentType.CENTER }),
      p('תמחור המרכזייה – מכרז 11/2026 עיריית אופקים', { bold: true, size: 30, align: AlignmentType.CENTER, after: 40 }),
      p('לפי המודל הכלכלי, מעודכן למסמך ההבהרות (22.10.2026)  |  הגשה: 10.11.2026 עד 12:00', { size: 18, color: '595959', align: AlignmentType.CENTER, after: 120 }),
      p('העלויות במסמך הן הערכות של המודל – לא עלויות HOT בפועל. לפני ההגשה יש להחליף אותן בנתונים מהמחלקות (טלפוניה, רשת, תמיכה).', { bold: true, color: 'C00000', after: 120 }),

      h('1. סעיפי המחיר בשקלול (נספח ה\')'),
      p('ניקוד כל סעיף = משקל × (ההצעה הנמוכה ÷ ההצעה הנבחנת), והסך מוכפל ב-0.7. מחיר מחוץ לטווח המינימום–מקסימום פוסל את ההצעה. בטבלה – ברירת המחדל במודל: כל הסעיפים במחיר המינימום.', { after: 80 }),
      table(['#', 'סעיף', 'יחידה', 'מינימום', 'מקסימום', 'משקל', 'כמות ב-36 ח\'', 'המחיר המוצע', 'עלות ליחידה', 'הכנסה 36 ח\'', 'עלות 36 ח\'', 'רווח 36 ח\''], rows1, W1,
        { num: [3, 4, 5, 6, 7, 8, 9, 10, 11], total: true, red: (k, i) => i === 11 && D.items[k] && D.items[k][12] < 0 }),
      p('טלפונים – כמות 0: העירייה לא יודעת אם תרכוש בכלל (הבהרה 98); המחיר עדיין נכנס לניקוד. שירות שנה רביעית – רק בשנות האופציה.', { size: 17, color: '595959', before: 60 }),

      h('2. מה כלול בסעיף 1 – ופירוק העלות'),
      p('סעיף 1 (קומפלט, 65% מציון המחיר) כולל: מרכזייה מקומית ראשית 300 שלוחות (עד 500), מרכזייה בענן 20 שלוחות בסנכרון מלא, Call Center מקומי ובענן – 30 שלוחות כל אחד, 36 חודשי שירות, וכל מה שנדרש להפעלה: התקנה, VDOM, שרתים, קו תמסורת וניוד מספרים – בלי תמחור נפרד (הבהרות 57, 93, 94, 104–107). ענן בלבד – נדחה (91).', { after: 80 }),
      table(['רכיב', 'עלות', 'תדירות', 'מקור'], rows2, W2, { num: [1], total: true }),
      p('בנוסף: ניוד 451 מספרים – ' + ils(A['31']) + ' חד-פעמי (הבהרה 47), נספר בתזרים.', { size: 17, color: '595959', before: 60 }),

      h('3. תוספות שאינן בשקלול'),
      p('אין להן השפעה על הניקוד – ההמלצה: המחיר המרבי. סעיף שלא ימולא יחויב בממוצע בין המינימום למקסימום.', { after: 80 }),
      table(['#', 'סעיף', 'מינימום', 'מקסימום', 'המחיר המוצע', 'עלות ליחידה', 'כמות לחודש', 'רווח לחודש'], rows3, W3, { num: [2, 3, 4, 5, 6, 7], total: true }),

      h('4. שורה תחתונה'),
      table(['מדד', 'ערך', 'הסבר'], [
        ['הכנסה ל-36 חודשים', ils(D.rev36), 'כל הסעיפים + תוספות'],
        ['עלות ל-36 חודשים', ils(D.cost36), 'כולל ניוד והכנת הצעה'],
        ['רווח ל-36 חודשים', ils(D.profit36), 'בהנחות ברירת המחדל'],
        ['רווח לכל התקופה (עם אופציות)', ils(D.total), ''],
        ['סעיף 1 במחיר המרבי (122,000 ₪)', ils(D.profit36 + 22000), 'רווח ל-36 חודשים – עדיין הפסד'],
        ['עלות חודשית מרבית לאיזון', ils(D.be), 'מול עלות שוטפת של ' + ils(A['25'])],
        ['פער ניקוד מחיר מרבי בין המציעים', nf(D.pmax, 1) + ' נקודות', 'מול 30 נקודות איכות ומצגת'],
        ['₪ לנקודת מחיר בסעיף 1', ils(D.tpoint[0]), 'הסעיף הזול ביותר לקנות בו ניקוד'],
        ['מחיר לשלוחה לחודש שמגולם בסעיף 1', ils(D.ext, 2), '100,000 ₪ ÷ 36 ÷ 300 – כולל חומרה ושני מוקדים'],
      ], [4200, 2400, 8238], { num: [1], red: (k, i) => i === 1 && [2, 3, 4].includes(k) }),

      h('5. המלצת תמחור'),
      p('• תוספות – במחיר המרבי (לא משפיעות על הניקוד).'),
      p('• סעיף 1 – 65% מציון המחיר. נקודה בסעיף הזה עולה כ-' + ils(D.tpoint[0]) + ' בלבד, ולכן הוא המקום לרדת במחיר – אבל רק אם העלות השוטפת בפועל יורדת לכיוון ' + ils(D.be) + ' לחודש.'),
      p('• בנק הדקות – במחיר המינימום (1,200 ₪) אין מרווח בעלות של 3 אג\' לדקה. אם עלות הדקה בפועל נמוכה יותר (On-Net) – יש כאן רווח.'),
      p('• החלטה: בהנחות הנוכחיות המכרז מפסיד גם במחיר המרבי. להגיש רק אם עלויות HOT בפועל (מרכזייה מקומית, צירים, תמיכה) נמוכות בהרבה, או אם יש ערך אסטרטגי (בתי ספר וגנים – הבהרה 59, רשויות שכנות).'),
    ],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[3], b); console.log('written'); });
