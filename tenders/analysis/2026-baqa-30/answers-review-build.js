// סקירת תשובות ההבהרה ותנאי הסף – עיריית באקה אלגרבייה, מכרז 30/2026
// הרצה: node answers-review-build.js <out.docx>
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  ShadingType, AlignmentType, BorderStyle, Footer, Header, PageNumber,
} = require('docx');

const FONT = 'Arial';
const thin = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const p = (text, o = {}) => new Paragraph({
  bidirectional: true,
  alignment: o.align || AlignmentType.RIGHT,
  spacing: { before: o.before ?? 0, after: o.after ?? 50 },
  keepNext: !!o.keepNext,
  children: [new TextRun({ text, font: FONT, size: o.size || 19, bold: !!o.bold, color: o.color, rightToLeft: true })],
});
const h = (text) => p(text, { bold: true, size: 25, color: '1F4E79', before: 220, after: 90, keepNext: true });
const b = (text, o = {}) => p('• ' + text, o);

const FILL = { red: 'F8CBAD', yellow: 'FFF2CC', green: 'E2EFDA' };
function table(head, rows, widths) {
  const cell = (t, i, fill, bold, white) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
    children: String(t).split('\n').map(x => p(x, { bold, color: white ? 'FFFFFF' : undefined })),
  });
  return new Table({
    width: { size: widths.reduce((a, c) => a + c, 0), type: WidthType.DXA },
    columnWidths: widths, visuallyRightToLeft: true,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t, i) => cell(t, i, '1F4E79', true, true)) }),
      ...rows.map(r => {
        const status = r[r.length - 1];
        const cells = r.slice(0, -1);
        return new TableRow({ cantSplit: true, children: cells.map((t, i) => cell(t, i, i === cells.length - 1 && status ? FILL[status] : undefined, i === 0)) });
      }),
    ],
  });
}

// עמוד A4 לאורך: 11906 − 2×950 = 10006
const W3 = [2200, 5106, 2700];
const W4 = [2300, 2900, 2906, 1900];

const threshold = [
  [`CCNP – חדש`, `לשאלה "האם הדרישה היא דרישת סף?" העירייה ענתה "כן". מתקבלת הסמכה מקבילה של Fortinet. נדרש איש כזה בהקמה ובתמיכה השוטפת.`, `כנראה עומדים: ל-HOT יש NSE 1–7. להציג איש NSE 7 (שקול ל-CCNP), בתוקף ומועסק בחברה המגישה`, 'yellow'],
  [`ד' – מוקד 24/7, הגעה תוך שעתיים`, `בקשת הצוות ל-SLA של 4 שעות: "בהתאם לטבלת ה-SLA". לא הוקל.`, `חייבים לעמוד בשעתיים בתקלה משביתה`, 'yellow'],
  [`ה' – מערכת קריאות שירות`, `זמן התגובה נמדד מרגע קליטת הפנייה במערכות שלנו; חובה לתעד עד הסגירה.`, `המערכת היא ההוכחה`, 'yellow'],
  [`ISO 27017 ו-Tier 3`, `"אין התייחסות בסעיף זה לתקני ISO" (נספח DPA, סעיף 4).`, `כנראה לא תנאי סף. נספח הפרטיות 2.1 (עמ' 50) לא נענה`, 'yellow'],
  [`יב' – הכול על שם החברה המגישה`, `לא נענה.`, `קריטי: רישיון, ענן, ניסיון ו-ISO על אותה ישות`, 'red'],
  [`ח' – ערבות הצעה עד 15.2.2027`, `לא נענה. ההגשה הוארכה ל-30.11; תוקף ההצעה (120 יום) מגיע ל-30.3.2027.`, `לבדוק אם התוקף עודכן (קובץ 3 / פנייה לעירייה)`, 'red'],
  [`שאר התנאים (א'–י"א)`, `אין שינוי.`, `לפי הבדיקה הקודמת`, 'green'],
];

const answers = [
  [`תקרת פיצויים (הסכם 38–39)`, `נדחה – "העירייה אינה מוכנה לסבול המשך תקלה לזמן רב".`, `נשאר בלי תקרה; הסיכון במודל (B17) בתוקף.`, 'red'],
  [`הצמדה בתקופות האופציה`, `לא מתקבל.`, `מחירים נומינליים ל-60 חודשים.`, 'red'],
  [`FortiGate 121G/71G/51G, FortiAP 231G`, `חלופות לא מתקבלות – גם ל-231G שהוא EOS.`, `להציע בדיוק את הדגמים.`, 'red'],
  [`הקלטות שיחות`, `שמירה 24 חודשים; עלות האחסון כלולה בתמחור; מחיקה אוטומטית בתום התקופה.`, `עלות חדשה – להוסיף למודל.`, 'yellow'],
  [`180 ₪ לשעת עבודה`, `כולל נסיעות. סוג העבודה: תמיכה מרחוק, הגדרות, עדכונים, פתרון תקלות.`, `להעמיס נסיעות על התעריף.`, 'yellow'],
  [`ציון המחיר – חודשי בלבד?`, `לא נענה.`, `החד-פעמי נשאר במחיר המרבי.`, 'yellow'],
  [`חומרה במחיר החודשי`, `ציוד חדש שנתקין – באחריות כולל החלפה. ציוד ישן של העירייה שהתקלקל – בחיוב נפרד.`, `תיקון / החלפת ציוד קיים בתשלום.`, 'green'],
  [`ציוד Cisco / Fortinet קיים`, `בבעלות העירייה ובתמיכת הספק הנוכחי. לחבר כל עוד תקין.`, `תיקון או החלפה – בחיוב.`, 'green'],
  [`פירוק ציוד קיים`, `סעיף נפרד בכתב הכמויות.`, `לא נבלע במחיר החודשי.`, 'green'],
  [`העברת מידע תוך 48 שעות`, `ימי עסקים, ללא סופי שבוע וחגים.`, `הקלה.`, 'green'],
  [`שיתוף פעולה של הספק הקיים`, `באחריות העירייה.`, `הסיכון אצל העירייה.`, 'green'],
  [`FortiNAC / Manager / Analyzer`, `בענן.`, `לבדוק מול דרישת מיקום המידע בישראל.`, 'yellow'],
  [`מבנים עתידיים`, `קיימים, וחלק מכתב הכמויות.`, `—`, ''],
  [`ישיבת הבהרות`, `לא תתקיים.`, `אין פרוטוקול לצרף.`, ''],
  [`ראיון ועדה (15 נק')`, `רק מי שעמד בתנאי הסף; הקריטריונים לא פורטו.`, `—`, ''],
  [`הצעות זהות`, `תשאול נוסף.`, `—`, ''],
  [`ערבות ביצוע 25,000 ₪`, `מתחדשת בכל שנת אופציה.`, `—`, ''],
  [`תשלום`, `אישור גזברות תוך 7 ימים (שוטף + 30).`, `—`, ''],
  [`סנטריקס כחלופה`, `"השאלה לא ברורה".`, `נשלח הנוסח המקורי עם "הוט".`, 'red'],
];

const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 19 } } } },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 950, right: 950 } } },
    headers: { default: new Header({ children: [p('פנימי – לא להגשה', { size: 16, color: 'C00000', align: AlignmentType.CENTER })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, children: [
      new TextRun({ text: 'עמוד ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16 }),
      new TextRun({ text: ' מתוך ', font: FONT, size: 16, rightToLeft: true }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16 })] })] }) },
    children: [
      p('סקירת תשובות ההבהרה ותנאי הסף – מכרז פומבי 30/2026', { bold: true, size: 30, align: AlignmentType.CENTER, after: 40 }),
      p('עיריית באקה אלגרבייה – אספקה וניהול מערכות תקשורת ואבטחת מידע', { size: 22, align: AlignmentType.CENTER, after: 40 }),
      p('עודכן: 19.11.2026 | מקור: 3 קבצי תשובות מאתר העירייה (ממוספרים 1, 2, 4)', { size: 17, color: '595959', align: AlignmentType.CENTER, after: 120 }),
      p('ההגשה: 30.11.2026 (יום ב\') עד 13:00 – הוארכה מ-15.11', { bold: true, size: 23, color: 'C00000', align: AlignmentType.CENTER, after: 120 }),

      h('בשורה התחתונה'),
      p('התשובות לא חוסמות את ההגשה. נוסף תנאי סף חדש (CCNP או חלופת Fortinet) – ל-HOT יש NSE 1–7, כך שכנראה עומדים. כל ההקלות שביקשנו נדחו. רוב השאלות החשובות שלנו לא קיבלו תשובה.'),

      h('1. שלושה דברים לטפל בהם קודם'),
      b('הקובץ המאוחד שלנו (50 שורות) לא נענה. בקבצים יש תשובות רק לאקסל הגולמי של הצוות, לשאלות הביטוח ולסט של 25 שאלות (מקור "ניתוח מכרז"). הקבצים ממוספרים 1, 2 ו-4 – כנראה יש באתר גם קובץ 3. לחפש אותו, ולברר אם הקובץ המאוחד נשלח בכלל.'),
      b('השם של HOT נחשף: נשלח האקסל המקורי עם הנוסח "הוט סנטריקס פרוסה על 5 חברות", והוא מפורסם באתר העירייה.'),
      b('תוקף הערבות מול ההארכה לא נענה: הערבות עד 15.2.2027, תוקף ההצעה (120 יום מ-30.11) עד 30.3.2027.'),

      h('2. תנאי סף אחרי התשובות'),
      table(['תנאי', 'מה נקבע בתשובות', 'מצב / פעולה'], threshold, W3),
      p('אדום = חוסם עד שייסגר | צהוב = לעמוד בדרישה / לבדוק | ירוק = ללא שינוי', { size: 16, color: '595959', before: 60 }),

      h('3. מה נענה ומה זה אומר'),
      table(['נושא', 'תשובת העירייה', 'השלכה', 'מצב'].slice(0, 3), answers, W3),

      h('4. ביטוח (עובר דרך מחלקת המכרזים)'),
      p('כמעט כל הבקשות נדחו. התקבלו שלוש:'),
      b('"מתחייב" הוחלף ב"רשאי" (שאלה 3).'),
      b('אי-המצאת אישור ביטוח במועד אינה הפרה יסודית, אם האישור נמסר תוך 10 ימי עסקים מהבקשה (שאלה 7).'),
      b('נמחקו "תאגידים עירוניים ו/או חברות קשורות" וביטוח הרכוש, ונוסף "ו/או נוסח מקביל" לנוסח הפוליסות (שאלה 9).'),

      h('5. ההמלצה'),
      p('אפשר להמשיך לקראת הגשה, בתנאי שנסגרים שלושה דברים עד 23.11 (החלטת Go / No-Go):'),
      b('איש NSE 7 (קיים) – לוודא תעודה בתוקף, מועסק בחברה המגישה, וזמין בהקמה ובתמיכה.'),
      b('כל תנאי הסף על שם אותה ישות (תנאי יב\').'),
      b('תוקף ערבות ההצעה מול ההארכה.'),
      p('המודל הכלכלי טרם עודכן – חסרות עלויות אמיתיות. כשיהיו: להוסיף אחסון הקלטות ל-24 חודשים ולהעמיס נסיעות על התעריף השעתי.', { before: 80 }),
    ],
  }],
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(process.argv[2], buf); console.log('written'); });
