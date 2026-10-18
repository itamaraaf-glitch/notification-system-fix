// לוח זמנים – עיריית אופקים, מכרז פומבי 11/2026 (מרכזיית טלפוניה)
// הרצה: node schedule-build.js <out.docx>
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, BorderStyle, Footer, PageNumber, HeadingLevel,
} = require('docx');

const FONT = 'Arial';
const thin = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const p = (text, o = {}) => new Paragraph({
  bidirectional: true,
  alignment: o.align || AlignmentType.RIGHT,
  spacing: { before: o.before ?? 0, after: o.after ?? 60 },
  keepNext: !!o.keepNext,
  children: [new TextRun({ text, font: FONT, size: o.size || 20, bold: !!o.bold, color: o.color, rightToLeft: true })],
});
const h = (text) => p(text, { bold: true, size: 26, color: '1F4E79', before: 240, after: 100, keepNext: true });

function table(head, rows, widths, opts = {}) {
  const cell = (t, i, fill, bold) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    children: String(t).split('\n').map(x => p(x, { bold, color: fill === '1F4E79' ? 'FFFFFF' : undefined })),
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths, visuallyRightToLeft: true,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, '1F4E79', true)) }),
      ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, (opts.hl || []).includes(r) ? 'FFF2CC' : undefined, i === 0)) })),
    ],
  });
}

// עמוד A4 לאורך: רוחב טקסט 11906 − 2×1000 = 9906
const W1 = [1900, 2300, 3906, 1800];
const W3 = [1500, 5006, 1900, 1500];

const SUBMIT = ['3.11.2026 (יום ג\'), 12:00', 'הגשת ההצעה', 'ידנית בלבד, בנוכחות נציג/ת העירייה, לתיבת המכרזים בלשכת המנכ"ל, בניין העירייה קומה א\', רח\' הרצל 38 אופקים.\nמעטפה סגורה ללא סימני זיהוי, שני עותקים: מקור חתום וחתום בחותמת בכל דף + העתק (צילום המקור החתום).', 'עמ\' 3, סעיף 6; מסמך א\' סעיף 1.3'];
const tender = [
  ['—', 'אין מפגש מציעים', 'לא יתקיים כנס או סיור מציעים.', 'עמ\' 3, סעיף 4'],
  ['13.10.2026, 12:00\n(המועד עבר)', 'שאלות הבהרה', 'קובץ Word בלבד, בעמוד המכרז באתר העירייה, בלחצן "שאלות הבהרה". עמודות: מס"ד | עמוד | המסמך או הנספח | סעיף רלבנטי | נוסח השאלה.\nהעירייה לא חייבת לענות לשאלות שלא הוגשו במועד ובפורמט.', 'סעיפים 1.3, 8.1–8.4'],
  ['לא נקבע', 'תשובות העירייה להבהרות', 'יפורסמו בכתב; רק תשובה בכתב מחייבת. יש לצרף את התשובות חתומות להצעה.', 'סעיפים 8.5–8.6'],
  SUBMIT,
  ['תימסר הודעה', 'פתיחת תיבת המכרזים', 'המציעים רשאים להיות נוכחים.', 'עמ\' 3, סעיף 7; סעיף 6.2'],
  ['בהתראה של 3 ימי עבודה לפחות', 'מצגת והדגמה על מערכת חיה (10 נקודות)', 'בעירייה, עד 120 דקות: תפעול טלפוניה, מוקדי שירות, דוחות בזמן אמת והיסטוריים. רשימת המשתתפים מטעם המציע – 24 שעות לפני.', 'סעיף 10.3'],
  ['עד 3.3.2027', 'תוקף ההצעה וערבות ההצעה', 'ההצעה בתוקף 120 יום מהמועד האחרון להגשה (העירייה רשאית לדרוש הארכה ב-120 יום נוספים).\nערבות בנקאית 10,000 ₪, מקור, בתוקף עד 3.3.2027 לפחות.', 'סעיפים 1.3, 6.3, 5.10'],
];
const after = [
  ['תוך 14 יום מהודעת הזכייה', 'חתימה על ההסכם ומסמכים', 'חתימה על ההסכם (מסמך ג\'), ערבות ביצוע 20,000 ₪ צמודה ל-12 חודשים (תוארך ב-12 חודשים נוספים), אישור עריכת ביטוחים.\nאיחור: 1,000 ₪ לכל יום, או ביטול הזכייה וחילוט ערבות ההצעה.', 'סעיפים 11.2–11.4'],
  ['תוך 30 יום מהודעת חתימת העירייה', 'השלמת ההקמה', 'אספקה, התקנה והדרכות – הפתרון כולו באופן מושלם.', 'סעיף 2.4'],
  ['36 חודשים מחתימת העירייה', 'תקופת ההתקשרות', 'אופציה להארכות של שנה או חלק ממנה, עד 7 שנים בסך הכול.', 'סעיף 2 (תקופה); הסכם'],
  ['עד 24 חודשים מחתימת החוזה', '"כשיר שני"', 'העירייה רשאית לבחור כשיר שני למקרה של ביטול ההסכם עם הזוכה.', 'סעיף 10.5'],
];
const internal = [
  ['20.10', 'לבדוק באתר העירייה אם פורסמו תשובות להבהרות או שינויים במועדים; לוודא שקובץ שאלות ההבהרה (62 שאלות) הועלה', 'מחלקת המכרזים', '☐'],
  ['22.10', 'תשובות המחלקות: תנאי סף (ניסיון 3 שנים רצופות 2023–2026, מוקד א\'–ה\' 08:00–16:00, מחזור 2 מיליון ₪ בממוצע 2023–2025) ועלויות', 'כל המחלקות', '☐'],
  ['26.10', 'החלטת Go / No-Go לפי המודל הכלכלי (בהנחות ברירת המחדל – הפסד; נקודת איזון כ-1,950 ₪ לחודש)', 'הנהלה + מחלקת המכרזים', '☐'],
  ['27.10', 'הזמנת ערבות בנקאית 10,000 ₪, מקור, בתוקף עד 3.3.2027, בנוסח מסמך א\'(2)', 'כספים', '☐'],
  ['29.10', 'תמחור סופי ואישור (5 סעיפי מחיר בין מינימום למקסימום; תוספות שלא בשקלול – במחיר המרבי)', 'כספים + מחלקת המכרזים', '☐'],
  ['1.11–2.11', 'חתימה וחותמת בכל דף, תצהירים מאומתים בעו"ד, צירוף תשובות ההבהרה חתומות, צילום ההעתק, מעטפה סגורה', 'מחלקת המכרזים', '☐'],
  ['3.11 עד 12:00', 'מסירה ידנית בלשכת המנכ"ל, אופקים', 'מחלקת המכרזים', '☐'],
  ['מיד אחרי ההגשה', 'הכנת צוות ומערכת פעילה להדגמה – ההתראה יכולה להיות 3 ימי עבודה בלבד', 'טלפוניה + מכירות', '☐'],
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [
      new TextRun({ text: 'עמוד ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }),
      new TextRun({ text: ' מתוך ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 })] })] }) },
    children: [
      p('לוח זמנים – מכרז פומבי 11/2026', { bold: true, size: 32, align: AlignmentType.CENTER, after: 40 }),
      p('עיריית אופקים – אספקה, הקמה ותחזוקה של מרכזיית טלפוניה', { size: 24, align: AlignmentType.CENTER, after: 40 }),
      p('עודכן: 18.10.2026', { size: 18, color: '595959', align: AlignmentType.CENTER, after: 200 }),
      p('ההגשה: 3.11.2026 (יום ג\') עד השעה 12:00 – מסירה ידנית בלבד', { bold: true, size: 24, color: 'C00000', align: AlignmentType.CENTER, after: 120 }),

      h('1. מועדי המכרז'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], tender, W1, { hl: [SUBMIT] }),

      h('2. אחרי זכייה'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], after, W1),

      h('3. לו"ז עבודה פנימי עד ההגשה'),
      table(['עד', 'משימה', 'אחראי', 'בוצע'], internal, W3),

      h('לתשומת לב'),
      p('• העירייה רשאית לשנות את המועדים בהודעה באתר, גם אחרי המועד האחרון להגשה, כל עוד לא נפתחה התיבה (סעיף 1.4). לבדוק את עמוד המכרז עד יום ההגשה.'),
      p('• מועד שאלות ההבהרה (13.10) עבר. אם הקובץ לא הועלה במועד – העירייה לא חייבת לענות (סעיף 8.4).'),
      p('• מועדי לו"ז העבודה הפנימי הם הצעה – לעדכן לפי החלטת מחלקת המכרזים.'),
    ],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[2], b); console.log('written'); });
