"""מחלץ את נתוני התמחור מהמודל (אחרי חישוב מחדש) לקובץ JSON עבור pricing-build.js.
הרצה: python3 pricing-extract.py <model.xlsx> <out.json>"""
import sys, json
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], data_only=True)
p, t, h, z = wb['סעיפי מחיר'], wb['תוספות'], wb['הנחות'], wb['תזרים']
out = dict(
    items=[[p[f'{c}{r}'].value for c in 'ABCDEFGHIJUWX'] for r in range(5, 10)],
    tpoint=[p[f'T{r}'].value for r in range(5, 10)],
    opts=[[t[f'{c}{r}'].value for c in 'ABCDEFGH'] for r in range(5, 16)],
    a={str(r): h[f'B{r}'].value for r in list(range(4, 23)) + [25, 26, 27] + list(range(28, 34))},
    rev36=z['C2'].value, cost36=z['C3'].value, profit36=z['C4'].value,
    total=z['H2'].value, npv=z['H3'].value, be=z['H4'].value, pmax=p['P12'].value, ext=p['P13'].value,
    optm=t['H16'].value,
)
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1, default=str)
print('ok')
