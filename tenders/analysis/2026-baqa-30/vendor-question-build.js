// שאלות לספק Fortinet – עיריית באקה אלגרבייה, מכרז 30/2026 (עם עמודה לתשובת הספק)
// הרצה: node vendor-question-build.js <out.docx>
// לא לכלול מחירים מרביים של המכרז או מרווחים שלנו.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, BorderStyle, PageOrientation,
} = require('docx');

const FONT = 'Arial';
const thin = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const p = (text, o = {}) => new Paragraph({
  bidirectional: !o.ltr,
  alignment: o.align || (o.ltr ? AlignmentType.LEFT : AlignmentType.RIGHT),
  spacing: { before: o.before ?? 0, after: o.after ?? 60 },
  keepNext: !!o.keepNext,
  children: [new TextRun({ text, font: FONT, size: o.size || 19, bold: !!o.bold, color: o.color, rightToLeft: !o.ltr })],
});
const h = (text) => p(text, { bold: true, size: 24, color: '1F4E79', before: 200, after: 80, keepNext: true });

function table(head, rows, widths, ltrCols = []) {
  const cell = (t, i, fill, bold, white) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    children: String(t).split('\n').map(x => p(x, { bold, color: white ? 'FFFFFF' : undefined, ltr: ltrCols.includes(i) && !white })),
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths, visuallyRightToLeft: true,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, '1F4E79', true, true)) }),
      ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, i === r.length - 1 ? 'FFF2CC' : undefined, i === 0)) })),
    ],
  });
}

// לרוחב: 16838 − 2×800 = 15238
const W1 = [600, 2700, 900, 1300, 1300, 4200, 2400, 1838];
const fazRows = [
  ['1', 'FC-10-GT51G-585-02-24\nFortiGate-51G – FortiAnalyzer Cloud', '24', '$1,436', '$34,464',
   'המחיר ליחידה זהה למחיר הבאנדל FG-51G-BDL-950-36 (סעיף 27).\nהשורה ל-24 חודשים, ושאר השורות ל-36.',
   'מחיר רשימה נכון; מק"ט ל-36 חודשים', ''],
  ['2', 'FC-10-GT71G-585-02-36\nFortiGate-71G – FortiAnalyzer Cloud', '4', '$2,234', '$8,937',
   'המחיר ליחידה זהה למחיר הבאנדל FG-71G-BDL-950-36 (סעיף 25).\nבנוסף: 4 × 2,234 = 8,936 – הפרש של 1$ בסה"כ.',
   'מחיר רשימה נכון', ''],
  ['3', 'FC-10-F121G-585-02-36\nFortiGate-121G – FortiAnalyzer Cloud', '1', '$8,130', '$8,130',
   'המחיר ליחידה זהה למחיר הבאנדל FG-121G-BDL-950-36 (סעיף 26).',
   'מחיר רשימה נכון', ''],
  ['4', 'חלופה (אם יש)', '—', '—', '—',
   'דרישת המכרז: FortiAnalyzer Cloud ל-29 FortiGate (24×51G, 4×71G, 1×121G), רישוי ל-36 חודשים, שמירת לוגים ל-24 חודשים.',
   'האפשרות הזולה ביותר שעומדת בדרישה: מנוי מרכזי לפי נפח, באנדל הכולל FAZ Cloud וכדומה', ''],
];

const W2 = [600, 3200, 6000, 3600, 1838];
const reqRows = [
  ['5', 'מחיר פרויקט (SPR)', 'רישום העסקה אצל Fortinet (Deal Registration) על שמנו, ובקשה למחיר פרויקט.\nהיעד: 25% לפחות מעבר להצעה הנוכחית – לציוד ולמנויי הענן.\nכמויות: 29 FortiGate, 16 FortiSwitch, 10 FortiAP, FortiNAC ל-400 נקודות קצה, FortiManager / FortiAnalyzer בענן; התקשרות עד 60 חודשים; לקוח מוניציפלי; מכרז פומבי.', 'אחוז ההנחה שאושר, לכל שורה', ''],
  ['6', 'תוקף המחירים', 'עד 31.5.2027 לפחות (ההצעה לעירייה בתוקף 90 יום מ-30.11.2026; חתימה תוך 7 ימים מהזכייה).', 'תאריך תוקף', ''],
  ['7', 'חידוש מנויי הענן – שנים 4–5', 'מחיר חידוש נעול לחודשים 37–60 ל-FortiNAC, FortiAnalyzer Cloud ו-FortiManager Cloud; לחלופין – תקרה על העלייה.', 'מחיר / תקרה לחידוש', ''],
  ['8', 'מטבע', 'מחיר בשקלים, או שער דולר מקובע עד מועד ההזמנה.', 'מטבע / שער', ''],
  ['9', 'FortiAP-231K', 'הדגם מקובל (העירייה מאשרת שווה ערך). נבקש דף מפרט להשוואה מול FortiAP-231G.', 'דף מפרט', ''],
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 19 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 600, bottom: 500, left: 800, right: 800 } } },
    children: [
      p('הצעת מחיר Fortinet – עיריית באקה אלגרבייה (מכרז 30/2026): שאלות ובקשות לתיקון', { bold: true, size: 28, align: AlignmentType.CENTER, after: 60 }),
      p('נבקש למלא את העמודה "תשובת הספק" ולהחזיר עד 24.11.2026. את טבלה 1 – אם אפשר כבר מחר.', { size: 20, align: AlignmentType.CENTER, after: 160 }),

      h('טבלה 1 – תיקון שורות FortiAnalyzer Cloud (דחוף)'),
      table(['#', 'SKU / תיאור', 'כמות', 'מחיר ליחידה בהצעה', 'סה"כ בהצעה', 'מה לא ברור', 'מה אנחנו מבקשים', 'תשובת הספק'], fazRows, W1, [1, 3, 4]),

      h('טבלה 2 – בקשות נוספות'),
      table(['#', 'נושא', 'הבקשה', 'מה לכתוב בתשובה', 'תשובת הספק'], reqRows, W2),

      p('תודה, ונשמח לשיחה משותפת עם נציג Fortinet בישראל אם זה יקדם את הבקשה.', { before: 80 }),
    ],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[2], b); console.log('written'); });
