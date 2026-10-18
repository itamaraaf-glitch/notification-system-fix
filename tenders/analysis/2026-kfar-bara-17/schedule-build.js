// לוח זמנים – מועצה מקומית כפר ברא, מכרז מסגרת פומבי 17/2026 (שירותי IT מנוהלים)
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

const CLAR = ['19.10.2026 (יום ב\')', 'שאלות הבהרה – מועד אחרון', 'בכתב בלבד, בדוא"ל למזכיר המועצה מר מחמוד ריאן. Word פתוח: מס"ד | מספר עמוד | הסעיף | פירוט השאלה.\nבחוברת שתי כתובות שונות – לשלוח לשתיהן ולבקש אישור קבלה:\nmahmood11@walla.co.il\nmahmoodr@kafar-bara.muni.il', 'עמ\' 2; עמ\' 4; עמ\' 10–11'];
const SUBMIT = ['28.10.2026 (יום ד\'), 13:00', 'הגשת ההצעה', 'מסירה אישית בלבד לתיבת המכרזים, בניין המועצה, רח\' צלאח אלדין 20, כפר ברא (בעמ\' 2: לשכת המנכ"ל; בסעיף 2.3: לשכת מזכיר המועצה).\nמעטפה סגורה, רק מספר המכרז עליה. שני עותקים חתומים: עותק נייר בכריכה קשה + עותק סרוק על CD או דיסק-און-קי.', 'עמ\' 2; עמ\' 4; עמ\' 6 סעיף 2.3'];
const tender = [
  ['2.10.2026', 'פרסום המכרז ותחילת רכישת המסמכים', '1,500 ₪ (לא מוחזר), במחלקת הגבייה בימים א\'–ה\' 10:00–15:00, או בהעברה בנקאית (בנק 10, סניף 648, חשבון 199700/96). הקבלה – חובה בהגשה.', 'עמ\' 2, 4; עמ\' 6 סעיף 2.1'],
  ['15.10.2026', 'פרסום מדד ספטמבר 2026', 'מדד הבסיס של ערבות ההצעה.', 'עמ\' 4; עמ\' 6 סעיף 2.2'],
  CLAR,
  ['21.10.2026 (יום ד\')', 'תשובות המועצה להבהרות', 'יפורסמו במרוכז באתר המועצה. לחתום על התשובות ולצרף אותן להצעה.', 'עמ\' 2, 4; עמ\' 11'],
  SUBMIT,
  ['אחרי פתיחת ההצעות – המועצה תודיע', 'ראיונות', 'ראיון (10 נקודות): התרשמות מניסיון, אמינות, מקצועיות, זמינות וזמני הגעה.', 'עמ\' 9'],
  ['עד 25.01.2027', 'תוקף ערבות ההצעה', '10,000 ₪ כולל מע"מ, צמודה למדד ספטמבר 2026. (בנוסח הערבות בעמ\' 24 נכתב בטעות 25.01.2026.)', 'עמ\' 4, 7, 24'],
  ['90 יום מהמועד האחרון להגשה', 'תוקף ההצעה', 'כ-26.1.2027.', 'עמ\' 19 סעיף 5'],
];
const after = [
  ['תוך 7 ימים מהודעת הזכייה\n(בעמ\' 8: 14 יום)', 'חתימה על ההסכם ומסמכים', 'חתימה על ההסכם, ערבות ביצוע 15,000 ₪ ל-14 חודשים, אישור קיום ביטוחים. ערבות ההצעה תשוחרר תוך 7 ימים מהחתימה.\nבחוברת סתירה: 7 ימים (עמ\' 10, 13, 14, 17, 19) מול 14 יום (עמ\' 8) – לעבוד לפי 7.', 'עמ\' 8; עמ\' 10, 13–14'],
  ['תוך 72 שעות מכל הזמנה', 'אספקת שירותים וציוד', 'מכל הזמנה חתומה של נציג המועצה.', 'עמ\' 5 סעיף 1.5; עמ\' 7 סעיף 3.8'],
  ['3 שנים', 'תקופת ההתקשרות', '+ שתי אופציות של שנה – עד 5 שנים. המועצה רשאית לבטל בהודעה של 30 יום.', 'עמ\' 15 סעיף 13'],
];
const internal = [
  ['18.10 (היום)', 'לסגור את קובץ שאלות ההבהרה (43 שאלות), כולל שאלות ISO 9001 (11, 13) ומחיר מינימלי לדמי הקמה (15). תשובות תנאי הסף מהמחלקות (המועד הפנימי 16.10 עבר)', 'מחלקת המכרזים', '☐'],
  ['19.10, עד סוף היום', 'לשלוח את שאלות ההבהרה לשתי כתובות הדוא"ל ולקבל אישור קבלה', 'מחלקת המכרזים', '☐'],
  ['21.10', 'לבדוק באתר המועצה את התשובות – במיוחד חלופה ל-ISO 9001', 'מחלקת המכרזים', '☐'],
  ['22.10', 'החלטת Go / No-Go: בלי ISO 9001 או חלופה מאושרת – לא מגישים', 'הנהלה + מחלקת המכרזים', '☐'],
  ['22.10', 'הזמנת ערבות בנקאית 10,000 ₪, צמודה למדד ספטמבר 2026, בתוקף עד 25.01.2027, בנוסח נספח מ\'ז', 'כספים', '☐'],
  ['25.10', 'תמחור סופי: אסטרטגיית דמי ההקמה (80% מציון המחיר), הנחה על השירות השנתי, אישור', 'כספים + מחלקת המכרזים', '☐'],
  ['26.10–27.10', 'חתימה על כל המסמכים, תצהירים מאומתים בעו"ד, תשובות ההבהרה חתומות, כריכה קשה, סריקה ל-CD/דיסק-און-קי, קבלת רכישה', 'מחלקת המכרזים', '☐'],
  ['28.10 עד 13:00', 'מסירה אישית בבניין המועצה, כפר ברא', 'מחלקת המכרזים', '☐'],
  ['מיד אחרי ההגשה', 'הכנה לראיון: מציגים, דוגמאות לזמינות וזמני הגעה, המלצות', 'מכירות + IT מנוהל', '☐'],
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
      p('לוח זמנים – מכרז מסגרת פומבי 17/2026', { bold: true, size: 32, align: AlignmentType.CENTER, after: 40 }),
      p('מועצה מקומית כפר ברא – שירותי IT מנוהלים, שרתים, אבטחת מידע, קווים ומרכזייה בענן', { size: 24, align: AlignmentType.CENTER, after: 40 }),
      p('עודכן: 18.10.2026', { size: 18, color: '595959', align: AlignmentType.CENTER, after: 200 }),
      p('שאלות הבהרה: מחר, 19.10.2026  |  הגשה: 28.10.2026 (יום ד\') עד 13:00', { bold: true, size: 24, color: 'C00000', align: AlignmentType.CENTER, after: 120 }),

      h('1. מועדי המכרז'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], tender, W1, { hl: [CLAR, SUBMIT] }),

      h('2. אחרי זכייה'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], after, W1),

      h('3. לו"ז עבודה פנימי עד ההגשה'),
      table(['עד', 'משימה', 'אחראי', 'בוצע'], internal, W3),

      h('לתשומת לב'),
      p('• מועד שאלות ההבהרה הוא מחר (19.10). אחרי ההגשה לא יתקבלו הסתייגויות, גם לא לאישור הביטוח (עמ\' 14).'),
      p('• ISO 9001 הוא תנאי סף (סעיף 3.7) ול-HOT אין כרגע תעודה. ההחלטה אם להגיש תלויה בתשובה לשאלות ההבהרה 11 ו-13.'),
      p('• סתירות בחוברת: יום ב\' (סעיף 2.3) מול יום ד\' (עמ\' 2) – 28.10.2026 הוא יום ד\'; מכרז 13/2026 מול 17/2026; 7 מול 14 ימים לחתימה. לעבוד לפי המועד המוקדם.'),
      p('• מועדי לו"ז העבודה הפנימי הם הצעה – לעדכן לפי החלטת מחלקת המכרזים.'),
    ],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[2], b); console.log('written'); });
