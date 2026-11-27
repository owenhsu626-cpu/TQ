"""把主辦方的 Excel 名單（「店家名單」「BS公司人員」兩個分頁）轉成系統匯入用 CSV。

用法：python3 -I scripts/convert-bs-xlsx.py <名單.xlsx> <輸出.csv>

輸出欄位：姓名,店名,房號,桌次,交通方式,Buffet資格,備註,身分
- 店家名單：每列一家店，第一位、第二位出席人員各成一列；店名保留原樣（含【TK】【PTK】）
- BS公司人員：店名填部門（合併儲存格往下補；無部門者用分組名 BSFC / BSSC），
  備註填「分組｜職稱」，身分填「公司人員」（不填問卷、不領贈品）
- 房號、桌次留空；Buffet資格留空（= 有）；公司人員交通方式留空
"""
import csv
import re
import sys
from collections import Counter

import openpyxl


def clean(v):
    if v is None:
        return ''
    s = str(v).replace('\xa0', ' ').replace('　', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return re.sub(r'\s+(?=【)', '', s)  # 「長青輪胎行 【TK】」→「長青輪胎行【TK】」


def dealers(ws, warn):
    out = []
    head = [clean(c) for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    col = {h: i for i, h in enumerate(head)}
    i_store = col['店家']
    i_p = [i for h, i in col.items() if h.startswith('出席人員姓名')]
    i_tr = col['交通方式']
    for n, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not isinstance(row[0], (int, float)):
            continue  # 合計列等
        store = clean(row[i_store])
        transport = clean(row[i_tr])
        if not store:
            warn.append(f'店家名單第 {n} 列沒有店名，已略過')
            continue
        if not transport:
            warn.append(f'店家名單第 {n} 列（{store}）沒有交通方式')
        for i in i_p:
            name = clean(row[i])
            if not name:
                continue
            note = ''
            if len(name) == 1:
                note = '姓名僅一字，待確認'
                warn.append(f'店家名單第 {n} 列（{store}）姓名只有「{name}」，請確認全名')
            out.append([name, store, '', '', transport, '', note, ''])
    return out


def staff(ws, warn):
    # 合併儲存格：B 欄部門往下補
    filled = {}
    for rng in ws.merged_cells.ranges:
        v = ws.cell(rng.min_row, rng.min_col).value
        for r in range(rng.min_row, rng.max_row + 1):
            for c in range(rng.min_col, rng.max_col + 1):
                filled[(r, c)] = v
    out = []
    group = ''
    for r in range(1, ws.max_row + 1):
        get = lambda c: ws.cell(r, c).value if (r, c) not in filled else filled[(r, c)]
        a = get(1)
        if isinstance(a, str) and clean(a).upper().startswith('BS'):
            group = clean(a).split(' ')[0]
            continue
        if not isinstance(a, (int, float)):
            continue
        dept, title, name = clean(get(2)), clean(get(3)), clean(get(4))
        if not name:
            continue
        store = dept or group
        out.append([name, store, '', '', '', '', f'{group}｜{title}' if title else group, '公司人員'])
    return out


def main(src, dst):
    wb = openpyxl.load_workbook(src, data_only=True)
    warn = []
    rows = []
    for ws in wb.worksheets:
        if ws.title.strip() == '店家名單':
            rows += dealers(ws, warn)
        elif 'BS' in ws.title:
            rows += staff(ws, warn)
        else:
            warn.append(f'未處理的分頁：{ws.title}')

    # 同店同名不可重複；跨店同名提示（系統會讓本人選店）
    dup = [k for k, c in Counter((r[0], r[1]) for r in rows).items() if c > 1]
    for name, store in dup:
        warn.append(f'錯誤：{store} 有兩位 {name}，系統無法區分')
    by_name = {}
    for r in rows:
        by_name.setdefault(r[0], []).append(r[1])
    for name, stores in by_name.items():
        if len(set(stores)) > 1:
            warn.append(f'同名不同店（查詢時會請本人選店）：{name} → ' + '、'.join(stores))

    with open(dst, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, lineterminator='\r\n')
        w.writerow(['姓名', '店名', '房號', '桌次', '交通方式', 'Buffet資格', '備註', '身分'])
        w.writerows(rows)

    n_staff = sum(1 for r in rows if r[7])
    print(f'輸出 {len(rows)} 人：店家 {len(rows) - n_staff} 人（{len({r[1] for r in rows if not r[7]})} 家店）、公司人員 {n_staff} 人')
    print('交通方式：', dict(Counter(r[4] or '（空白）' for r in rows)))
    for x in warn:
        print('⚠', x)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
