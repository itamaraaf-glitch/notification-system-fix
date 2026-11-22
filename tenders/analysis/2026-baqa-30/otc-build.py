"""מחשבון OTC (V22) – מולא לכתב הכמויות של Fortinet במכרז באקה אלגרבייה 30/2026.

הרצה: python3 otc-build.py <מחשבון_OTC_V22.xlsx> <out.xlsx>   ואז חישוב מחדש (Excel / LibreOffice).
התבנית עצמה (מחשבון פנימי) לא נשמרת במאגר. הסקריפט:
  1. מעתיק את המחשבון כמו שהוא, ומחזיר את הלוגואים (openpyxl לא שומר תמונות).
  2. מוסיף גיליון "כתב כמויות Fortinet – באקה" עם שורות הצעת המחיר של הספק (USD),
     המרה לש"ח, תמחור לפי לוגיקת המחשבון (העמסה + ריבית), ובדיקה מול המחיר המרבי במכרז – ברמזור.
  3. ממלא את קלטי "מחשבון ציוד – עלות חד פעמית" לחומרה (סעיפים 23–28).
"""
import sys
import re
import zipfile
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.drawing.image import Image as XLImage
from openpyxl.drawing.spreadsheet_drawing import OneCellAnchor, AnchorMarker
from openpyxl.drawing.xdr import XDRPositiveSize2D

SRC, OUT = sys.argv[1], sys.argv[2]
BDL_ONLY = '--bdl-only' in sys.argv   # טיוטה: בלי רישוי FortiAnalyzer Cloud לכל מכשיר (בהנחה שכפול ל-BDL)
wb = openpyxl.load_workbook(SRC)

# ------------------------------------------------------------------ לוגואים מהתבנית
z = zipfile.ZipFile(SRC)
wbx = z.read('xl/workbook.xml').decode()
rels = z.read('xl/_rels/workbook.xml.rels').decode()
rid2file = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(?:/xl/)?(worksheets/sheet\d+\.xml)"', rels))
rid2file.update({a: b for b, a in re.findall(r'Target="(?:/xl/)?(worksheets/sheet\d+\.xml)"[^>]*Id="(rId\d+)"', rels)})
sheets = re.findall(r'<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"', wbx)
for name, rid in sheets:
    name = name.replace('&quot;', '"').replace('&amp;', '&')
    sf = rid2file.get(rid)
    if not sf:
        continue
    srel = f'xl/worksheets/_rels/{sf.split("/")[-1]}.rels'
    if srel not in z.namelist():
        continue
    m = re.search(r'Target="\.\./drawings/(drawing\d+\.xml)"', z.read(srel).decode())
    if not m:
        continue
    dxml = z.read(f'xl/drawings/{m.group(1)}').decode()
    drel = z.read(f'xl/drawings/_rels/{m.group(1)}.rels').decode()
    rmap = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="\.\./media/([^"]+)"', drel))
    for anchor in re.findall(r'<xdr:(?:oneCellAnchor|twoCellAnchor)[^>]*>.*?</xdr:(?:oneCellAnchor|twoCellAnchor)>', dxml, re.S):
        emb = re.search(r'r:embed="(rId\d+)"', anchor)
        if not emb or emb.group(1) not in rmap:
            continue
        f = re.search(r'<xdr:from><xdr:col>(\d+)</xdr:col><xdr:colOff>(-?\d+)</xdr:colOff><xdr:row>(\d+)</xdr:row><xdr:rowOff>(-?\d+)</xdr:rowOff>', anchor)
        ext = re.search(r'<a:ext cx="(\d+)" cy="(\d+)"', anchor)
        img = XLImage(io.BytesIO(z.read(f'xl/media/{rmap[emb.group(1)]}')))
        if f and ext:
            img.anchor = OneCellAnchor(_from=AnchorMarker(col=int(f[1]), colOff=int(f[2]), row=int(f[3]), rowOff=int(f[4])),
                                       ext=XDRPositiveSize2D(int(ext[1]), int(ext[2])))
        wb[name].add_image(img)

# ------------------------------------------------------------------ סגנון
F = 'Arial'
BLUE, BLACK, BOLD = Font(name=F, color='0000FF'), Font(name=F), Font(name=F, bold=True)
TITLE, HDR = Font(name=F, bold=True, size=14), Font(name=F, bold=True, color='FFFFFF')
HFILL, YEL = PatternFill('solid', fgColor='1F4E79'), PatternFill('solid', fgColor='FFFF00')
SUB = PatternFill('solid', fgColor='DDEBF7')
thin = Side(style='thin', color='BFBFBF')
BOX = Border(top=thin, bottom=thin, left=thin, right=thin)
USD, ILS, PCT = '$#,##0', '#,##0 ₪;(#,##0 ₪);-', '0.0%;[Red]-0.0%;-'
WRAP = Alignment(wrap_text=True, vertical='top', horizontal='right')
TL = [('עובר', '006100', 'C6EFCE'), ('גבולי', '9C5700', 'FFEB9C'), ('לא עובר', '9C0006', 'FFC7CE')]


def put(ws, ref, val, font=BLACK, fmt=None, fill=None):
    c = ws[ref]
    c.value, c.font, c.border = val, font, BOX
    if fmt:
        c.number_format = fmt
    if fill:
        c.fill = fill
    return c


def traffic(ws, rng):
    first = rng.split(':')[0]
    for txt, fc, bg in TL:
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'LEFT({first},{len(txt)})="{txt}"'], stopIfTrue=True,
                                                       font=Font(name=F, bold=True, color=fc), fill=PatternFill('solid', fgColor=bg)))


CALC = "'מחשבון ציוד - עלות חד פעמית'!"

# ------------------------------------------------------------------ שורות הצעת הספק (USD) – מהצילום
# (סעיף במכרז, SKU, תיאור, כמות, מחיר ליחידה USD, סוג: SaaS / חומרה / אחריות)
LINES = [
    (1, 'FNC-CAX-VM', 'FortiNAC Control and Application Extended-VM (עד 50,000 נקודות קצה)', 1, 1819, 'SaaS'),
    (1, 'FC-10-FNVXA-248-02-36', 'FortiNAC Control and Application Extended-VM – 3 Year FortiCare Premium', 1, 1213, 'SaaS'),
    (1, 'FC5-10-FNAC1-213-01-36', 'FortiNAC Subscription License 3 Year – PLUS, 100 endpoints', 4, 827, 'SaaS'),
    (2, 'FC-10-GT51G-585-02-24', 'FortiGate-51G – FortiAnalyzer Cloud (שימו לב: 24 חודשים)', 24, 1436, 'SaaS'),
    (2, 'FC-10-GT71G-585-02-36', 'FortiGate-71G 3 Year FortiAnalyzer Cloud', 4, 2234, 'SaaS'),
    (2, 'FC-10-F121G-585-02-36', 'FortiGate-121G 3 Year FortiAnalyzer Cloud', 1, 8130, 'SaaS'),
    (3, 'FC1-10-MVCLD-227-01-36', 'FortiManager Cloud – 10 devices/VDOMs, 3 Year', 5, 2509, 'SaaS'),
    (23, 'FS-124F-FPOE', 'FortiSwitch-124F-FPOE – 24x GE PoE + 4x 10G SFP+', 15, 880, 'חומרה'),
    (23, 'FC-10-S124F-247-02-36', 'FortiSwitch-124F-FPOE 3 Year FortiCare Premium', 15, 286, 'אחריות'),
    (24, 'FS-148F-FPOE', 'FortiSwitch-148F-FPOE – 48x GE PoE + 4x 10G SFP+', 1, 1445, 'חומרה'),
    (24, 'FC-10-148FF-247-02-36', 'FortiSwitch-148F-FPOE 3 Year FortiCare Premium', 1, 469, 'אחריות'),
    (25, 'FG-71G-BDL-950-36', 'FortiGate-71G Hardware + 3 Year FortiCare Premium & UTP', 4, 2234, 'חומרה'),
    (26, 'FG-121G-BDL-950-36', 'FortiGate-121G Hardware + 3 Year FortiCare Premium & UTP', 1, 8130, 'חומרה'),
    (27, 'FG-51G-BDL-950-36', 'FortiGate-51G Hardware + 3 Year FortiCare Premium & UTP', 24, 1436, 'חומרה'),
    (28, 'FAP-231K-E', 'FortiAP-231K Indoor Wireless AP (Wi-Fi 7)', 10, 344, 'חומרה'),
    (28, 'FC-10-P231K-247-02-36', 'FortiAP-231K 3 Year FortiCare Premium', 10, 106, 'אחריות'),
]
# סעיפי המכרז: (סעיף, שם, סוג תשלום, כמות, מחיר מרבי ליחידה)
ITEMS = [
    (1, 'FortiNAC Cloud SaaS ל-400 התקנים', 'חודשי', 1, 1700),
    (2, 'FortiAnalyzer Cloud SaaS, שמירה 24 ח\'', 'חודשי', 1, 1900),
    (3, 'FortiManager Cloud SaaS עד 50 התקנים', 'חודשי', 1, 1500),
    (23, 'מתג FS-124F-FPOE + 36 ח\' תמיכה', 'חד-פעמי', 15, 4700),
    (24, 'מתג FS-148F-FPOE + 36 ח\' תמיכה', 'חד-פעמי', 1, 7000),
    (25, 'FortiGate FG-71G + 36 ח\' FortiCare', 'חד-פעמי', 4, 6500),
    (26, 'FortiGate FG-121G + 36 ח\' FortiCare', 'חד-פעמי', 1, 23000),
    (27, 'FortiGate FG-51G + 36 ח\' FortiCare', 'חד-פעמי', 24, 4500),
    (28, 'FortiAP 231G + 3Y UTM + FortiCare', 'חד-פעמי', 10, 1200),
]

if BDL_ONLY:
    LINES = [l for l in LINES if l[0] != 2]
ws = wb.create_sheet('כתב כמויות Fortinet – באקה', 0)
ws.sheet_view.rightToLeft = True
for c, w in {'A': 8, 'B': 26, 'C': 50, 'D': 9, 'E': 13, 'F': 14, 'G': 12, 'H': 15, 'I': 15, 'J': 15, 'K': 13, 'L': 30, 'M': 13, 'N': 13, 'O': 13, 'P': 14, 'Q': 11, 'R': 12}.items():
    ws.column_dimensions[c].width = w
ws['A1'] = 'כתב כמויות Fortinet – עיריית באקה אלגרבייה, מכרז 30/2026 (לפי מחשבון OTC V22)' + (' – טיוטה: BDL בלבד, בלי רישוי FortiAnalyzer Cloud' if BDL_ONLY else '')
ws['A1'].font = TITLE

put(ws, 'B3', 'שער דולר (₪)', BOLD)
put(ws, 'C3', 3.70, BLUE, '0.000', YEL)
put(ws, 'D3', 'לעדכן לשער היום / לשער הספק')
put(ws, 'B4', 'אחוז העמסה (מהמחשבון, G17)', BOLD)
put(ws, 'C4', f'={CALC}G17', fmt='0%')
put(ws, 'D4', 'משנים במחשבון. מינימום לפי מאשר העסקה: מת"ל 25%, מנהל מחלקה 20%, אגף 15%, חטיבה 8%.')
put(ws, 'B5', 'ריבית חודשית (מהמחשבון, Z6)', BOLD)
put(ws, 'C5', f'={CALC}Z6', fmt='0.000%')
put(ws, 'B6', 'תקופת החוזה לחישוב רווח (חודשים)', BOLD)
put(ws, 'C6', 36, BLUE, '0', YEL)
put(ws, 'D6', 'כל שורת רישוי נפרסת לפי התקופה שלה (‎-24 = 24 חודשים, ‎-36 = 36 חודשים – עמודה I). רישוי של 24 חודשים מחודש לתקופה הנותרת באותו מחיר לחודש.')
put(ws, 'B7', 'הנחת פרויקט מהספק (Special Pricing)', BOLD)
put(ws, 'C7', 0, BLUE, '0%', YEL)
put(ws, 'D7', 'להזנה אחרי תשובת הספק – מוריד את כל עלויות Fortinet.')
for r in (3, 4, 5, 6, 7):
    ws.merge_cells(f'D{r}:L{r}')

# ---- שורות הספק
H1 = 8
heads = ['סעיף במכרז', 'SKU', 'תיאור', 'כמות', 'מחיר ליחידה ($)', 'סה"כ ($)', 'סוג', 'סה"כ עלות (₪)', 'תקופת רישוי (חודשים)', 'עלות לחודש (₪)']
for i, t in enumerate(heads):
    c = ws.cell(row=H1, column=1 + i, value=t)
    c.font, c.fill, c.border = HDR, HFILL, BOX
    c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
ws.row_dimensions[H1].height = 32
L0 = H1 + 1
for i, (it, sku, desc, q, p, kind) in enumerate(LINES):
    r = L0 + i
    put(ws, f'A{r}', it)
    put(ws, f'B{r}', sku)
    put(ws, f'C{r}', desc).alignment = WRAP
    put(ws, f'D{r}', q, BLUE, '0', YEL)
    put(ws, f'E{r}', p, BLUE, USD, YEL)
    put(ws, f'F{r}', f'=D{r}*E{r}', fmt=USD)
    put(ws, f'G{r}', kind)
    put(ws, f'H{r}', f'=F{r}*$C$3*(1-$C$7)', fmt=ILS)
    if kind == 'SaaS':
        m_ = re.search(r'-(\d{2})$', sku)
        put(ws, f'I{r}', int(m_.group(1)) if m_ else 36, BLUE, '0', YEL)   # לפי סיומת ה-SKU (‎-24 / ‎-36)
        put(ws, f'J{r}', f'=H{r}/I{r}', fmt=ILS)
LL = L0 + len(LINES) - 1
r = LL + 1
put(ws, f'C{r}', 'סה"כ הצעת הספק', BOLD)
put(ws, f'F{r}', f'=SUM(F{L0}:F{LL})', BOLD, USD)
put(ws, f'H{r}', f'=SUM(H{L0}:H{LL})', BOLD, ILS)
for kind_ in ('SaaS', 'חומרה', 'אחריות'):
    r += 1
    put(ws, f'C{r}', f'מתוכם: {kind_}')
    put(ws, f'F{r}', f'=SUMIFS(F{L0}:F{LL},G{L0}:G{LL},"{kind_}")', fmt=USD)
    put(ws, f'H{r}', f'=SUMIFS(H{L0}:H{LL},G{L0}:G{LL},"{kind_}")', fmt=ILS)
KS = {'SaaS': r - 2, 'חומרה': r - 1, 'אחריות': r}

# ---- תמחור לפי סעיף מול המחיר המרבי
H2 = r + 3
put(ws, f'A{H2 - 1}', 'תמחור לפי סעיף במכרז – מול המחיר המרבי', TITLE).border = Border()
heads2 = ['סעיף', 'רכיב', 'סוג תשלום', 'כמות', 'עלות (₪)', 'המחיר שלנו לפי המחשבון', 'מחיר מרבי במכרז',
          'העמסה מרבית אפשרית', 'רווח (₪)', 'בדיקה', 'הערה']
cols = 'ABCDEFGHIJK'
for i, t in enumerate(heads2):
    c = ws.cell(row=H2, column=1 + i, value=t)
    c.font, c.fill, c.border = HDR, HFILL, BOX
    c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
for i, t in enumerate(['הערה', 'עלות ליחידה (₪; חודשי = לחודש)', 'מחיר מרבי ליחידה במכרז', 'הנחה נדרשת מהספק – בלי רווח',
                       'הנחה נדרשת מהספק – עם ההעמסה במחשבון', 'שער דולר לאיזון (בלי רווח)', 'תקופת רישוי אפקטיבית (חודשים)']):
    c = ws.cell(row=H2, column=12 + i, value=t)
    c.font, c.fill, c.border = HDR, HFILL, BOX
    c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
ws.row_dimensions[H2].height = 46
NOTES = {
    2: 'שורת 51G היא ל-24 חודשים (02-24) ולא 36; המחירים ליחידה זהים לבאנדלים בסעיפים 25–27 – לבדוק מול הספק אם הועתקו בטעות.',
    25: 'מחיר זהה לשורת FortiAnalyzer 71G (סעיף 2) – לאמת.',
    27: 'מחיר זהה לשורת FortiAnalyzer 51G (סעיף 2) – לאמת.',
    28: 'הספק הציע FortiAP-231K. לפי תשובה 49 (21.11) מותר דגם שו"ע עם לפחות אותן תכונות, ללא תוספת מחיר – לצרף השוואת מפרט ל-231G.',
    **({2: 'טיוטה: הוסרו 3 שורות FortiAnalyzer Cloud (בהנחה שהן כפילות של ה-BDL). לאמת מול הספק שהשירות כלול – המכרז דורש FortiAnalyzer Cloud עם שמירת לוגים 24 ח\'.'} if BDL_ONLY else {}),
}
I0 = H2 + 1
for i, (it, name, pay, q, mx) in enumerate(ITEMS):
    r = I0 + i
    put(ws, f'A{r}', it)
    put(ws, f'B{r}', name).alignment = WRAP
    put(ws, f'C{r}', pay)
    put(ws, f'D{r}', q, fmt='0')
    put(ws, f'E{r}', f'=SUMIFS($H${L0}:$H${LL},$A${L0}:$A${LL},A{r})', fmt=ILS)
    if pay == 'חודשי':
        # תשלום חודשי שמחזיר עלות × (1+העמסה) בריבית המחשבון
        put(ws, f'R{r}', f'=IF(SUMIFS($J${L0}:$J${LL},$A${L0}:$A${LL},A{r})>0,E{r}/SUMIFS($J${L0}:$J${LL},$A${L0}:$A${LL},A{r}),$C$6)', fmt='0.0')
        put(ws, f'F{r}', f'=PMT($C$5,R{r},-E{r}*(1+$C$4))', fmt=ILS)
        put(ws, f'G{r}', mx, BLUE, ILS)
        put(ws, f'H{r}', f'=IF(E{r}>0,-PV($C$5,R{r},G{r})/E{r}-1,0)', fmt=PCT)
        put(ws, f'I{r}', f'=(MIN(F{r},G{r})-M{r})*$C$6', fmt=ILS)
    else:
        put(ws, f'F{r}', f'=E{r}*(1+$C$4)', fmt=ILS)
        put(ws, f'G{r}', f'={mx}*D{r}', fmt=ILS)
        put(ws, f'H{r}', f'=IF(E{r}>0,G{r}/E{r}-1,0)', fmt=PCT)
        put(ws, f'I{r}', f'=MIN(F{r},G{r})-E{r}', fmt=ILS)
    put(ws, f'J{r}', f'=IF(E{r}=0,"-",IF(H{r}<0,"לא עובר – העלות מעל המרבי",IF(H{r}<$C$4,"גבולי – רק בהעמסה נמוכה","עובר")))')
    ws[f'J{r}'].alignment = Alignment(horizontal='center', wrap_text=True)
    put(ws, f'K{r}', 'חודשי ל-36 ח\'' if pay == 'חודשי' else 'סה"כ לסעיף')
    put(ws, f'L{r}', NOTES.get(it, '')).alignment = WRAP
    if pay == 'חודשי':
        put(ws, f'M{r}', f'=SUMIFS($J${L0}:$J${LL},$A${L0}:$A${LL},A{r})', fmt=ILS)   # כל שורה לפי תקופת הרישוי שלה
        put(ws, f'N{r}', mx, fmt=ILS)
        put(ws, f'O{r}', f'=IF(E{r}=0,0,MAX(0,1-(-PV($C$5,R{r},G{r}))/E{r}))', fmt=PCT)
        put(ws, f'P{r}', f'=IF(E{r}=0,0,MAX(0,1-(-PV($C$5,R{r},G{r}))/(E{r}*(1+$C$4))))', fmt=PCT)
        put(ws, f'Q{r}', f'=IF(E{r}=0,"-",$C$3*(-PV($C$5,R{r},G{r}))/E{r})', fmt='0.00')
    else:
        put(ws, f'M{r}', f'=E{r}/D{r}', fmt=ILS)
        put(ws, f'N{r}', mx, fmt=ILS)
        put(ws, f'O{r}', f'=MAX(0,1-N{r}/M{r})', fmt=PCT)
        put(ws, f'P{r}', f'=MAX(0,1-N{r}/(M{r}*(1+$C$4)))', fmt=PCT)
        put(ws, f'Q{r}', f'=$C$3*N{r}/M{r}', fmt='0.00')
    ws.row_dimensions[r].height = 42 if it in NOTES else 22
IL = I0 + len(ITEMS) - 1
traffic(ws, f'J{I0}:J{IL}')
r = IL + 1
put(ws, f'B{r}', 'סה"כ חודשי (סעיפים 1–3)', BOLD)
put(ws, f'E{r}', f'=SUMIFS(E{I0}:E{IL},C{I0}:C{IL},"חודשי")', BOLD, ILS)
put(ws, f'F{r}', f'=SUMIFS(F{I0}:F{IL},C{I0}:C{IL},"חודשי")', BOLD, ILS)
put(ws, f'G{r}', f'=SUMIFS(G{I0}:G{IL},C{I0}:C{IL},"חודשי")', BOLD, ILS)
put(ws, f'I{r}', f'=SUMIFS(I{I0}:I{IL},C{I0}:C{IL},"חודשי")', BOLD, ILS)
r += 1
put(ws, f'B{r}', 'סה"כ חד-פעמי (סעיפים 23–28)', BOLD)
for c_ in 'EFGI':
    put(ws, f'{c_}{r}', f'=SUMIFS({c_}{I0}:{c_}{IL},C{I0}:C{IL},"חד-פעמי")', BOLD, ILS)
r += 2
put(ws, f'B{r}', 'שורה תחתונה – Fortinet', BOLD)
put(ws, f'C{r}', f'=IF(COUNTIF(J{I0}:J{IL},"לא עובר*")>0,"לא עובר – "&COUNTIF(J{I0}:J{IL},"לא עובר*")&" סעיפים שהעלות שלהם מעל המחיר המרבי",IF(COUNTIF(J{I0}:J{IL},"גבולי*")>0,"גבולי – "&COUNTIF(J{I0}:J{IL},"גבולי*")&" סעיפים רק בהעמסה נמוכה","עובר"))', BOLD)
ws.merge_cells(f'C{r}:J{r}')
traffic(ws, f'C{r}:J{r}')
BOTTOM = r
r += 2
for t in [
    'איך לקרוא: "העמסה מרבית אפשרית" = כמה אפשר להעמיס על עלות הספק בלי לעבור את המחיר המרבי במכרז. עובר = מעל ההעמסה במחשבון; גבולי = 0% עד ההעמסה במחשבון (צריך אישור מאשר בדרג גבוה יותר); לא עובר = העלות כבר מעל המרבי.',
    'סעיפים 1–3 חודשיים: כל שורת רישוי נפרסת לפי התקופה שלה (24 או 36 חודשים). התשלום החודשי – PMT בריבית המחשבון על העלות × (1+העמסה), לפי תקופת הרישוי האפקטיבית של הסעיף (עמודה R).',
    'המחיר המרבי במכרז הוא ליחידה – לכן הבדיקה היא עלות ליחידה מול מרבי ליחידה (עמודות M–N). "הנחה נדרשת מהספק" = כמה הספק צריך להוריד כדי שהיחידה תיכנס במרבי. "שער דולר לאיזון" = השער שבו העלות ליחידה שווה למרבי.',
    'סעיפים 23–28 חד-פעמיים: עלות × (1+העמסה). אלה גם הקלטים של "מחשבון ציוד – עלות חד פעמית" (D28 ציוד, D30 רישיונות / אחריות, תשלום אחד).',
    'מקור: הצעת מחיר של הספק (צילום מסך, 19.11.2026). המחירים ב-USD – לאמת מול ההצעה הרשמית ולעדכן את שער הדולר.',
]:
    put(ws, f'A{r}', t).alignment = WRAP
    ws.merge_cells(f'A{r}:L{r}')
    ws.row_dimensions[r].height = 30
    r += 1

# ---- המחירים שלנו להצעה
r += 1
put(ws, f'A{r}', 'המחירים שלנו להצעה – מחיר ליחידה, סה"כ, מאשר נדרש והשפעה על הציון', TITLE).border = Border()
r += 1
H3 = r
heads3 = ['סעיף', 'רכיב', 'סוג תשלום', 'כמות', 'עלות ליחידה (₪; חודשי = לחודש)', 'מחיר מרבי ליחידה',
          'המחיר המחושב (עלות + העמסה, עד המרבי)', 'דריסה ידנית', 'המחיר שלנו ליחידה', 'סה"כ שלנו',
          'העמסה בפועל', 'מאשר נדרש (לפי טבלת המחשבון)', 'שווי בציון המחיר (₪ לחודש)', 'רווח לתקופה (₪)', 'להעתקה למודל']
for i, t in enumerate(heads3):
    c = ws.cell(row=H3, column=1 + i, value=t)
    c.font, c.fill, c.border = HDR, HFILL, BOX
    c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
ws.row_dimensions[H3].height = 46
P0 = H3 + 1
TH = [f'{CALC}$W$26', f'{CALC}$W$27', f'{CALC}$W$28', f'{CALC}$W$29']   # 25% / 20% / 15% / 8%
for i, (it, name, pay, q, mx) in enumerate(ITEMS):
    r = P0 + i
    pr = I0 + i
    mon = pay == 'חודשי'
    put(ws, f'A{r}', it)
    put(ws, f'B{r}', name).alignment = WRAP
    put(ws, f'C{r}', pay)
    put(ws, f'D{r}', q, fmt='0')
    put(ws, f'E{r}', f'=M{pr}', fmt=ILS)
    put(ws, f'F{r}', f'=N{pr}', fmt=ILS)
    if mon:
        put(ws, f'G{r}', f'=IF(E{pr}=0,F{r},MIN(PMT($C$5,R{pr},-E{pr}*(1+$C$4)),F{r}))', fmt=ILS)
    else:
        put(ws, f'G{r}', f'=IF(E{r}=0,F{r},MIN(E{r}*(1+$C$4),F{r}))', fmt=ILS)
    put(ws, f'H{r}', None, BLUE, ILS, YEL)
    put(ws, f'I{r}', f'=IF(H{r}<>"",H{r},ROUND(G{r},0))', BOLD, ILS)
    put(ws, f'J{r}', f'=I{r}*D{r}', fmt=ILS)
    if mon:
        put(ws, f'K{r}', f'=IF(E{pr}>0,-PV($C$5,R{pr},J{r})/E{pr}-1,1)', fmt=PCT)
        put(ws, f'M{r}', f'=J{r}', fmt=ILS)
        put(ws, f'N{r}', f'=(J{r}-E{r})*$C$6', fmt=ILS)
    else:
        put(ws, f'K{r}', f'=IF(E{pr}>0,J{r}/E{pr}-1,1)', fmt=PCT)
        put(ws, f'M{r}', f'=J{r}/36', fmt=ILS)
        put(ws, f'N{r}', f'=J{r}-E{pr}', fmt=ILS)
    put(ws, f'L{r}', (f'=IF(I{r}>F{r},"לא עובר – מעל המרבי (פסילה)",IF(ROUND(K{r},3)>={TH[0]},"עובר – מת""ל",'
                      f'IF(ROUND(K{r},3)>={TH[1]},"עובר – מנהל מחלקה/תחום",IF(ROUND(K{r},3)>={TH[2]},"גבולי – מנהל אגף",'
                      f'IF(ROUND(K{r},3)>={TH[3]},"גבולי – מנהל חטיבה",IF(ROUND(K{r},3)>=0,"לא עובר – מתחת להעמסה המינימלית","לא עובר – הפסד"))))))'))
    ws[f'L{r}'].alignment = Alignment(horizontal='center', wrap_text=True)
    put(ws, f'O{r}', f"מודל: 'הצעת המחיר שלנו'!F{it + 3}")
    ws.row_dimensions[r].height = 28
PL = P0 + len(ITEMS) - 1
traffic(ws, f'L{P0}:L{PL}')
r = PL + 1
put(ws, f'B{r}', 'סה"כ חודשי (סעיפים 1–3)', BOLD)
put(ws, f'J{r}', f'=SUMIFS(J{P0}:J{PL},C{P0}:C{PL},"חודשי")', BOLD, ILS)
put(ws, f'M{r}', f'=SUMIFS(M{P0}:M{PL},C{P0}:C{PL},"חודשי")', BOLD, ILS)
put(ws, f'N{r}', f'=SUMIFS(N{P0}:N{PL},C{P0}:C{PL},"חודשי")', BOLD, ILS)
r += 1
put(ws, f'B{r}', 'סה"כ חד-פעמי (סעיפים 23–28)', BOLD)
put(ws, f'J{r}', f'=SUMIFS(J{P0}:J{PL},C{P0}:C{PL},"חד-פעמי")', BOLD, ILS)
put(ws, f'M{r}', f'=SUMIFS(M{P0}:M{PL},C{P0}:C{PL},"חד-פעמי")', BOLD, ILS)
put(ws, f'N{r}', f'=SUMIFS(N{P0}:N{PL},C{P0}:C{PL},"חד-פעמי")', BOLD, ILS)
r += 1
put(ws, f'B{r}', 'Fortinet בציון המחיר (חודשי + חד-פעמי ÷ 36)', BOLD)
put(ws, f'M{r}', f'=SUM(M{P0}:M{PL})', BOLD, ILS)
put(ws, f'N{r}', f'=SUM(N{P0}:N{PL})', BOLD, ILS)
put(ws, f'L{r}', f'=IF(COUNTIF(L{P0}:L{PL},"לא עובר*")>0,"לא עובר – "&COUNTIF(L{P0}:L{PL},"לא עובר*")&" סעיפים",IF(COUNTIF(L{P0}:L{PL},"גבולי*")>0,"גבולי – נדרש מאשר בכיר","עובר"))', BOLD)
ws[f'L{r}'].alignment = Alignment(horizontal='center', wrap_text=True)
traffic(ws, f'L{r}:L{r}')
r += 2
for t in [
    'המחיר המחושב = עלות × (1 + אחוז ההעמסה במחשבון), ובחודשי – PMT בריבית המחשבון ל-36 חודשים; בכל מקרה לא יותר מהמחיר המרבי ליחידה. אפשר לדרוס ידנית בעמודה H.',
    'מאשר נדרש – לפי טבלת ההעמסה המינימלית במחשבון (V26:W29): מת"ל 25%, מנהל מחלקה 20%, מנהל אגף 15%, מנהל חטיבה 8%. מתחת ל-8% – לא ניתן לאשר; מתחת ל-0% – הפסד.',
    'שווי בציון: לפי תשובה 9 (21.11) החד-פעמי מחולק ל-36 ומתווסף לחודשי. כל 36 ₪ בחד-פעמי = 1 ₪ בציון.',
    'דגמים: לפי תשובה 49 (21.11) מותר דגם שו"ע עם לפחות אותן תכונות, ללא תוספת מחיר (למשל FortiAP-231K).',
    'להעתקה למודל הכלכלי: את "המחיר שלנו ליחידה" (עמודה I) מזינים בגיליון "הצעת המחיר שלנו" במודל, בתא שבעמודה O.',
]:
    put(ws, f'A{r}', t).alignment = WRAP
    ws.merge_cells(f'A{r}:O{r}')
    ws.row_dimensions[r].height = 28
    r += 1
ws.column_dimensions['O'].width = 26
ws.freeze_panes = 'A9'

# ------------------------------------------------------------------ קלטי המחשבון (חומרה, תשלום אחד)
c = wb['מחשבון ציוד - עלות חד פעמית']
S = "'כתב כמויות Fortinet – באקה'!"
c['D13'] = 'עיריית באקה אלגרבייה – מכרז 30/2026'
c['D28'] = f'={S}H{KS["חומרה"]}'
c['D30'] = f'={S}H{KS["אחריות"]}'
c['D32'] = 0
c['D34'] = 0
c['G11'] = 1
c['G13'] = 3
c['D26'] = 'כן'
for ref in ('D28', 'D30'):
    c[ref].number_format = '#,##0 ₪'

# ------------------------------------------------------------------ תנאי סף יב' – ישות מגישה
tz = wb.create_sheet("תנאי סף יב' – ישות מגישה", 1)
tz.sheet_view.rightToLeft = True
for c_, w_ in {'A': 5, 'B': 9, 'C': 46, 'D': 26, 'E': 11, 'F': 11, 'G': 22, 'H': 14, 'I': 34, 'J': 26}.items():
    tz.column_dimensions[c_].width = w_
tz['A1'] = "תנאי סף יב' – כל התנאים במציע עצמו (באקה אלגרבייה, מכרז 30/2026)"
tz['A1'].font = TITLE
put(tz, 'B3', 'הישות המגישה (שם וח.פ.)', BOLD)
tz.merge_cells('B3:C3')
put(tz, 'D3', None, BLUE, None, YEL)
tz.merge_cells('D3:F3')
put(tz, 'G3', 'למלא קודם – מחלקת המכרזים', Font(name=F, color='C00000'))
tz.merge_cells('G3:J3')
put(tz, 'B4', 'תשובה 5ב (21.11): הבקשה להקל בתנאי יב\' נדחתה; גם ספק משנה לתנאים ג\', ו\', י\' נדחה. רכיב על שם ישות אחרת = פסילה.')
tz.merge_cells('B4:J4')
TH0 = 6
for i_, t_ in enumerate(['#', 'תנאי', 'רכיב שצריך להיות על שם הישות המגישה', 'מחלקה אחראית', 'סוג', 'יש / אין',
                         'על שם (ח.פ.) – אם שונה', 'תואם לישות?', 'אסמכתא / הערות', 'סטטוס']):
    c_ = tz.cell(row=TH0, column=1 + i_, value=t_)
    c_.font, c_.fill, c_.border = HDR, HFILL, BOX
    c_.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
tz.row_dimensions[TH0].height = 34
D_T, D_M, D_C, D_S, D_SA, D_F = 'ניהול מכרזים ומנהלה', 'מוקד, NOC ושטח', 'ענן ומרכזי נתונים', 'אבטחת מידע, Fortinet ו-ISO', 'מכירות וניהול לקוח', 'כספים ותמחור'
ROWS_T = [
    ("א'", 'תעודת התאגדות / רישום הישות בישראל', D_T, 'תנאי סף'),
    ("ו'", 'רישיון מפעיל פנים-ארצי (תשובה 4)', D_T, 'תנאי סף'),
    ("יא'", 'קבלה על רכישת מסמכי המכרז (500 ₪)', D_T, 'תנאי סף'),
    ("ב'", 'ניסיון 6 שנים ברציפות ב-3 גופים ציבוריים לפחות + המלצות (תשובה 2)', D_SA, 'תנאי סף'),
    ("ג'", 'Help Desk עם מעל 4 תומכים (בכלל המוקד – תשובה 3)', D_M, 'תנאי סף'),
    ("ד'", 'מוקד 24/7, הגעה תוך שעתיים בתקלה משביתה', D_M, 'תנאי סף'),
    ("ה'", 'מערכת קריאות שירות בכל הערוצים, כולל WhatsApp', D_M, 'תנאי סף'),
    ("ז'", 'אירוח בענן בחזקת המציע / בשכירות + הסכם; תצהיר חתום מול עו"ד (תשובה 4)', D_C, 'תנאי סף'),
    ("י'", 'מנהל אבטחת מידע (CISO) מועסק בישות + אישור רו"ח', D_S, 'תנאי סף'),
    ('CCNP', 'איש רשתות NSE 7 (במקום CCNP) מועסק בישות, תעודה בתוקף', D_S, 'תנאי סף'),
    ("ח'", 'ערבות בנקאית 10,000 ₪ על שם המציע עצמו', D_F, 'תנאי סף'),
    ('29', 'מערכת SOC/SIEM ברמת הארגון (תשובה 29)', D_S, 'דרישה'),
    ('ניקוד', 'ISO 27001 על שם הישות (2024/2025)', D_S, 'ניקוד'),
    ('ניקוד', 'ISO 9001 על שם הישות (2024/2025)', D_S, 'ניקוד'),
]
dv = DataValidation(type='list', formula1='"יש,אין,בבדיקה"', allow_blank=True)
tz.add_data_validation(dv)
R0T = TH0 + 1
for i_, (cond, comp, dept, kind) in enumerate(ROWS_T):
    r_ = R0T + i_
    put(tz, f'A{r_}', i_ + 1)
    put(tz, f'B{r_}', cond, BOLD)
    put(tz, f'C{r_}', comp).alignment = WRAP
    put(tz, f'D{r_}', dept).alignment = WRAP
    put(tz, f'E{r_}', kind)
    put(tz, f'F{r_}', None, BLUE, None, YEL)
    tz[f'F{r_}'].alignment = Alignment(horizontal='center')
    dv.add(f'F{r_}')
    put(tz, f'G{r_}', None, BLUE, None, YEL)
    put(tz, f'H{r_}', f'=IF(G{r_}="","כן (ברירת מחדל)",IF(G{r_}=$D$3,"כן","לא – ישות אחרת"))')
    put(tz, f'I{r_}', None).alignment = WRAP
    bad = '"לא עובר – חוסם"' if kind == 'תנאי סף' else ('"לא עובר – דרישה"' if kind == 'דרישה' else '"גבולי – פוגע בניקוד"')
    put(tz, f'J{r_}', f'=IF(OR(F{r_}="",F{r_}="בבדיקה"),"בבדיקה – אין תשובה",IF(OR(F{r_}="אין",LEFT(H{r_},2)="לא"),{bad},"עובר"))', BOLD)
    tz[f'J{r_}'].alignment = Alignment(horizontal='center', wrap_text=True)
    tz.row_dimensions[r_].height = 30
RLT = R0T + len(ROWS_T) - 1
TL4 = TL + [('בבדיקה', '595959', 'E7E6E6')]
for rng_ in (f'J{R0T}:J{RLT}',):
    first_ = rng_.split(':')[0]
    for txt, fc, bg in TL4:
        tz.conditional_formatting.add(rng_, FormulaRule(formula=[f'LEFT({first_},{len(txt)})="{txt}"'], stopIfTrue=True,
                                                        font=Font(name=F, bold=True, color=fc), fill=PatternFill('solid', fgColor=bg)))
# ---- סיכום אוטומטי
r_ = RLT + 2
put(tz, f'B{r_}', 'סיכום', TITLE).border = Border()
r_ += 1
SUMH = r_
for i_, t_ in enumerate(['מצב', 'תנאי סף', 'כל השורות']):
    c_ = tz.cell(row=SUMH, column=3 + i_, value=t_)
    c_.font, c_.fill, c_.border = HDR, HFILL, BOX
JR, ER = f'$J${R0T}:$J${RLT}', f'$E${R0T}:$E${RLT}'
for j_, (lab, pat) in enumerate([('עובר', 'עובר*'), ('לא עובר', 'לא עובר*'), ('גבולי (ניקוד)', 'גבולי*'), ('בבדיקה', 'בבדיקה*')]):
    rr = SUMH + 1 + j_
    put(tz, f'C{rr}', lab)
    put(tz, f'D{rr}', f'=COUNTIFS({JR},"{pat}",{ER},"תנאי סף")', fmt='0')
    put(tz, f'E{rr}', f'=COUNTIF({JR},"{pat}")', fmt='0')
rr = SUMH + 5
put(tz, f'C{rr}', 'שורה תחתונה', BOLD)
put(tz, f'D{rr}', (f'=IF(COUNTIF({JR},"לא עובר*")>0,"לא עובר – אין להגיש ("&COUNTIF({JR},"לא עובר*")&" רכיבים)",'
                   f'IF(COUNTIF({JR},"בבדיקה*")>0,"בבדיקה – חסרות "&COUNTIF({JR},"בבדיקה*")&" תשובות",'
                   f'IF(COUNTIF({JR},"גבולי*")>0,"גבולי – אפשר להגיש, עם פגיעה בניקוד ISO","עובר – אפשר להגיש")))'), BOLD)
tz.merge_cells(f'D{rr}:J{rr}')
for txt, fc, bg in TL4:
    tz.conditional_formatting.add(f'D{rr}:J{rr}', FormulaRule(formula=[f'LEFT($D${rr},{len(txt)})="{txt}"'], stopIfTrue=True,
                                                             font=Font(name=F, bold=True, color=fc), fill=PatternFill('solid', fgColor=bg)))
BOTT = rr
# ---- לפי מחלקה
rr += 2
for i_, t_ in enumerate(['מחלקה', 'רכיבים', 'עובר', 'פתוח (בבדיקה)', 'לא עובר / גבולי', 'מצב המחלקה']):
    c_ = tz.cell(row=rr, column=3 + i_, value=t_)
    c_.font, c_.fill, c_.border = HDR, HFILL, BOX
    c_.alignment = Alignment(wrap_text=True, horizontal='center')
DR = f'$D${R0T}:$D${RLT}'
D0 = rr + 1
for k_, d_ in enumerate([D_T, D_M, D_C, D_S, D_SA, D_F]):
    r2 = D0 + k_
    put(tz, f'C{r2}', d_).alignment = WRAP
    put(tz, f'D{r2}', f'=COUNTIF({DR},C{r2})', fmt='0')
    put(tz, f'E{r2}', f'=COUNTIFS({DR},C{r2},{JR},"עובר*")', fmt='0')
    put(tz, f'F{r2}', f'=COUNTIFS({DR},C{r2},{JR},"בבדיקה*")', fmt='0')
    put(tz, f'G{r2}', f'=COUNTIFS({DR},C{r2},{JR},"לא עובר*")+COUNTIFS({DR},C{r2},{JR},"גבולי*")', fmt='0')
    put(tz, f'H{r2}', f'=IF(COUNTIFS({DR},C{r2},{JR},"לא עובר*")>0,"לא עובר",IF(F{r2}>0,"בבדיקה",IF(G{r2}>0,"גבולי","עובר")))', BOLD)
    tz[f'H{r2}'].alignment = Alignment(horizontal='center')
DL = D0 + 5
for txt, fc, bg in TL4:
    tz.conditional_formatting.add(f'H{D0}:H{DL}', FormulaRule(formula=[f'LEFT(H{D0},{len(txt)})="{txt}"'], stopIfTrue=True,
                                                             font=Font(name=F, bold=True, color=fc), fill=PatternFill('solid', fgColor=bg)))
rr = DL + 2
for t_ in ['איך ממלאים: (1) D3 – הישות המגישה (מחלקת המכרזים). (2) עמודה F – יש / אין / בבדיקה לכל רכיב. (3) עמודה G – רק אם הרכיב רשום על ישות אחרת: לכתוב אותה; הבדיקה בעמודה H תסמן "לא – ישות אחרת".',
           'סטטוס: תנאי סף שחסר או על שם ישות אחרת = לא עובר (חוסם – לא מגישים). ISO = ניקוד בלבד (גבולי). SOC/SIEM = דרישה בחוזה.',
           'משפטי וביטוח לא ברשימה – כל שאלה על מבנה הקבוצה עוברת דרך מחלקת המכרזים.']:
    put(tz, f'B{rr}', t_).alignment = WRAP
    tz.merge_cells(f'B{rr}:J{rr}')
    tz.row_dimensions[rr].height = 30
    rr += 1
tz.freeze_panes = f'A{R0T}'
# קישור לגיליון Fortinet: סטטוס תנאי סף בראש הגיליון
put(ws, 'B2', 'תנאי סף יב\' (ישות מגישה)', BOLD)
put(ws, 'C2', f"='תנאי סף יב'' – ישות מגישה'!D{BOTT}", BOLD)
ws.merge_cells('C2:L2')
for txt, fc, bg in TL4:
    ws.conditional_formatting.add('C2:L2', FormulaRule(formula=[f'LEFT($C$2,{len(txt)})="{txt}"'], stopIfTrue=True,
                                                     font=Font(name=F, bold=True, color=fc), fill=PatternFill('solid', fgColor=bg)))

# הגיליון החדש פעיל בפתיחה
wb.active = 0
for s_ in wb.worksheets:
    s_.sheet_view.tabSelected = (s_.title == ws.title)
wb.save(OUT)
print('saved', OUT, 'bottom row', BOTTOM)
