// לוח זמנים – נתיבי הגז הטבעי לישראל (נתג"ז), מכרז פומבי INGL/TENDER/2026/48 (נתבים ומתגים Cisco)
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
  children: [new TextRun({ text, font: FONT, size: o.size || 19, bold: !!o.bold, color: o.color, rightToLeft: true })],
});
const h = (text) => p(text, { bold: true, size: 26, color: '1F4E79', before: 240, after: 100, keepNext: true });

function table(head, rows, widths, opts = {}) {
  const cell = (t, i, fill, bold) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
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

const CLAR = ['16.11.2026 (יום ב\'), 12:00', 'שאלות הבהרה – מועד אחרון', 'רק דרך מערכת המכרזים, בקטגוריה "שאלות הבהרה". לכל שאלה: שם המסמך, מספר העמוד, הסעיף ופירוט השאלה.\nפניות בכל דרך אחרת לא יחייבו. תשובות יפורסמו במערכת ו/או באתר החברה ויהיו חלק ממסמכי המכרז.', 'סעיפים 9.1(א), 10.1–10.4'];
const SUBMIT = ['13.12.2026 (יום א\'), 12:00', 'הגשת ההצעה – אלקטרונית בלבד', 'במערכת המכרזים המקוונת "Sourcing Vision" (משיק). התיבה ננעלת אוטומטית במועד; הצעה שלא נקלטה עד אז לא תידון. נקיטת חלק מהפעולות אינה הגשה.\nהצעת המחיר – רק בקובץ ה-Excel במערכת (נספח י\'), לא באף מסמך אחר.', 'סעיפים 8.5–8.8, 9.1(ב), 11–12'];
const tender = [
  ['18.10.2026', 'פרסום מסמכי המכרז', 'מהדורה 1 (ההסכם מ-6.10.2026). המסמכים בחינם במערכת; אין ערבות הצעה.', 'עמ\' 1; הסכם עמ\' 1'],
  ['מיידי', 'הרשמה למערכת המכרזים', 'רישום ב-https://account.sourcingvision.com, אימות דו-שלבי: דוא"ל פעיל וטלפון נייד ישראלי (SMS). המסמכים להורדה בקטגוריה "מסמכים להורדה".\nאחרי 20 דקות ללא פעולה המערכת מתנתקת.\nתמיכה (א\'–ה\' 08:00–17:00): service@mashiktech.com, 050-9029376 – מענה עד 5 שעות; ב-5 השעות שלפני ההגשה אין התחייבות.', 'סעיפים 8.1–8.5, 8.10'],
    CLAR,
  SUBMIT,
  ['180 יום מהמועד האחרון להגשה', 'תוקף ההצעה', 'עד כ-11.6.2027. החברה רשאית לדרוש הארכה.', 'סעיף 14.1'],
  ['אחרי הבדיקה', 'הליך הצעה סופית', 'רק אם יש שוויון בציון המשוקלל – הגשת הצעה כספית סופית, ואם עדיין שוויון – הגרלה.', 'סעיף 16.3'],
  ['12 חודשים (+6) מהודעת החברה', 'כשיר נוסף', 'ההצעה של הכשיר הבא בתור תעמוד בתוקף 12 חודשים מהודעת החברה, עם אפשרות הארכה ב-6 חודשים.', 'סעיף 17'],
];
const after = [
  ['תוך 7 ימים מהודעת הזכייה', 'השלמת מסמכים וחתימה', 'כל מסמך נדרש, כולל חתימה על ההסכם, הסדר ניגוד עניינים ורישומים ורישיונות. (אין ערבות ביצוע.)', 'סעיף 19.1'],
  ['תוך 14 יום מהחתימה – ולפני תחילת השירותים', 'אישור עריכת ביטוח', 'אישור חתום ע"י המבטח (נספח ג\' להסכם): צד ג\' 4M, מעבידים 20M, מוצר 4M, אחריות מקצועית 2M. חידוש – 14 יום לפני פקיעה.', 'הסכם סעיף 18.5, 18.9'],
  ['מיד עם הודעת החברה', 'תחילת השירותים', 'אי זמינות במועד = עילה לביטול הזכייה. אספקה לפי הזמנות; התקנות בתיאום, א\'–ה\' 08:00–17:00, עד 3 התקנות ביום.', 'סעיף 6.2; מפרט 3.1'],
  ['12 חודשים מהחתימה', 'תקופת ההסכם', '+ שתי אופציות של 12 חודשים (הודעת החברה 30 יום לפני הסיום). הספק מתריע 60 יום לפני סיום התקופה.', 'סעיף 6.1; הסכם 4.1–4.3'],
  ['כל 12 חודשים', 'עדכון מחירים', 'רכיבים – לפי שינוי מחירון Cisco ישראל; שירותים – 50% משינוי מדד המחירים לצרכן.', 'הסכם 10.9'],
  ['60 חודשים מאספקת המוצר', 'אחריות ותחזוקה', 'תמיכה 24/7; תגובה עד 4 שעות; התחלת טיפול תוך יום עבודה. חלפים ללא תשלום נוסף.', 'מפרט 2.3, 2.6, 4, 5.4'],
  ['שוטף + 45', 'תנאי תשלום', 'מקבלת החשבון, כפוף לאישור הממונה. בשקלים בלבד, לפי שער הדולר היציג ביום ההזמנה.', 'הסכם 10.2, 10.5'],
  ['30 יום / 7 ימים', 'סיום ההתקשרות', 'החברה רשאית לסיים בהודעה של 30 יום. בסיום – העברת כל המידע והחומר תוך 7 ימים.', 'הסכם 11.1, 11.4'],
];
const internal = [
  ['1.11 (יום א\')', 'הרשמה למערכת המכרזים והורדת כל המסמכים – כולל קובץ ה-Excel ונספחים ח\' ו-י\' המלאים', 'מחלקת המכרזים', '☐'],
  ['5.11 (יום ה\')', 'תנאי סף – האם אפשר להגיש: Cisco Preferred Networking Partner בתוקף; פרויקט Cyber Vision (100 התקנים לפחות) מאז 1.1.2024; 10 עובדים עם CCNA + 2 עם CCST Cybersecurity', 'לפי תנאי (מכירות, הנדסה, משאבי אנוש)', '☐'],
  ['10.11 (יום ג\')', 'נתוני ניקוד האיכות (40%): Cisco Preferred Security Partner, מספר פרויקטי Cyber Vision, מספר בעלי CCNA ו-CCST', 'הנדסה + משאבי אנוש', '☐'],
  ['12.11 (יום ה\')', 'סגירת קובץ שאלות ההבהרה', 'מחלקת המכרזים', '☐'],
  ['15.11 (יום א\')', 'העלאת שאלות ההבהרה למערכת – יום לפני המועד האחרון (16.11, 12:00)', 'מחלקת המכרזים', '☐'],
  ['26.11 (יום ה\')', 'בדיקת תשובות ההבהרה + החלטת Go / No-Go', 'הנהלה + מחלקת המכרזים', '☐'],
  ['3.12 (יום ה\')', 'תמחור סופי: רכיבים בדולר (הצעת מפיץ Cisco) ושירותים בשקלים, ואישור', 'כספים + מחלקת המכרזים', '☐'],
  ['8.12 (יום ג\')', 'מסמכים חתומים בראשי תיבות בכל עמוד, תצהירים מאומתים בעו"ד (נספחים ג\', ה\'), אישור זכויות חתימה, נספחים ו\'–ט\', העתק תעודת Partner', 'מחלקת המכרזים', '☐'],
  ['10.12 (יום ה\')', 'העלאת ההצעה המלאה למערכת ובדיקת דוא"ל האישור – שלושה ימים לפני המועד, כשמוקד התמיכה זמין', 'מחלקת המכרזים', '☐'],
  ['13.12 (יום א\') עד 12:00', 'מועד אחרון – התיבה ננעלת אוטומטית', 'מחלקת המכרזים', '☐'],
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 20 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 700, bottom: 700, left: 1000, right: 1000 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [
      new TextRun({ text: 'עמוד ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }),
      new TextRun({ text: ' מתוך ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 })] })] }) },
    children: [
      p('לוח זמנים – מכרז פומבי INGL/TENDER/2026/48', { bold: true, size: 32, align: AlignmentType.CENTER, after: 40 }),
      p('נתיבי הגז הטבעי לישראל – אספקה, התקנה ותחזוקה של נתבים ו/או מתגים תוצרת Cisco', { size: 24, align: AlignmentType.CENTER, after: 40 }),
      p('עודכן: 29.10.2026', { size: 18, color: '595959', align: AlignmentType.CENTER, after: 200 }),
      p('שאלות הבהרה: 16.11.2026 עד 12:00  |  הגשה: 13.12.2026 (יום א\') עד 12:00 – אלקטרונית', { bold: true, size: 24, color: 'C00000', align: AlignmentType.CENTER, after: 120 }),

      h('1. מועדי המכרז'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], tender, W1, { hl: [CLAR, SUBMIT] }),

      h('2. אחרי זכייה'),
      table(['מועד', 'אירוע', 'פרטים', 'מקור בחוברת'], after, W1),

      h('3. לו"ז עבודה פנימי עד ההגשה'),
      table(['עד', 'משימה', 'אחראי', 'בוצע'], internal, W3),

      h('לתשומת לב'),
      p('• ההגשה אלקטרונית בלבד. העלאה עלולה לקחת זמן ולהיתקע; החברה לא אחראית לתקלות. לכן מתוכנן להעלות שלושה ימים לפני המועד.'),
      p('• החברה רשאית לדחות כל מועד ותודיע על כך דרך המערכת (סעיף 9.3). בסתירה בין מועדים – גוברת טבלת המועדים בסעיף 9.1.'),
      p('• מועדי לו"ז העבודה הפנימי הם הצעה – לעדכן לפי החלטת מחלקת המכרזים.'),
    ],
  }],
});
Packer.toBuffer(doc).then(b => { fs.writeFileSync(process.argv[2], b); console.log('written'); });
