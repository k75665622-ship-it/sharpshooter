"""
research/v6/make_fd_fixture.py - write football-data.co.uk-format CSVs from the research archive.

    python3 -I research/v6/make_fd_fixture.py <Matches.csv> <division> <season start years, comma> <out_dir>

Used to build the offline test fixtures (test/fixtures/fd-E0-2526.csv ...) with the full
football-data column layout (results, half-times, shots, corners, fouls, cards, Bet365 and
best-of-market 1X2 and Over/Under 2.5, Asian handicap), so the v6 crawler, factor engine and
models run end-to-end on real data in tests.
"""
import csv
import sys

src, div, seasons, out = sys.argv[1], sys.argv[2], [int(s) for s in sys.argv[3].split(',')], sys.argv[4]
COLS = ['Div', 'Date', 'Time', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR', 'HTHG', 'HTAG', 'HTR', 'HS', 'AS', 'HST', 'AST',
        'HF', 'AF', 'HC', 'AC', 'HY', 'AY', 'HR', 'AR', 'B365H', 'B365D', 'B365A', 'MaxH', 'MaxD', 'MaxA',
        'B365>2.5', 'B365<2.5', 'Max>2.5', 'Max<2.5', 'AHh', 'B365AHH', 'B365AHA']
MAP = {'FTHG': 'FTHome', 'FTAG': 'FTAway', 'FTR': 'FTResult', 'HTHG': 'HTHome', 'HTAG': 'HTAway', 'HTR': 'HTResult',
       'HS': 'HomeShots', 'AS': 'AwayShots', 'HST': 'HomeTarget', 'AST': 'AwayTarget', 'HF': 'HomeFouls', 'AF': 'AwayFouls',
       'HC': 'HomeCorners', 'AC': 'AwayCorners', 'HY': 'HomeYellow', 'AY': 'AwayYellow', 'HR': 'HomeRed', 'AR': 'AwayRed',
       'B365H': 'OddHome', 'B365D': 'OddDraw', 'B365A': 'OddAway', 'MaxH': 'MaxHome', 'MaxD': 'MaxDraw', 'MaxA': 'MaxAway',
       'B365>2.5': 'Over25', 'B365<2.5': 'Under25', 'Max>2.5': 'MaxOver25', 'Max<2.5': 'MaxUnder25',
       'AHh': 'HandiSize', 'B365AHH': 'HandiHome', 'B365AHA': 'HandiAway'}
INTS = {'FTHG', 'FTAG', 'HTHG', 'HTAG', 'HS', 'AS', 'HST', 'AST', 'HF', 'AF', 'HC', 'AC', 'HY', 'AY', 'HR', 'AR'}
rows = {s: [] for s in seasons}
with open(src) as fh:
    for r in csv.DictReader(fh):
        if r['Division'] != div or not r['FTHome']:
            continue
        y, m = int(r['MatchDate'][:4]), int(r['MatchDate'][5:7])
        s = y if m >= 7 else y - 1
        if s not in rows:
            continue
        o = {'Div': div, 'Date': f"{r['MatchDate'][8:10]}/{r['MatchDate'][5:7]}/{r['MatchDate'][:4]}", 'Time': (r['MatchTime'] or '')[:5],
             'HomeTeam': r['HomeTeam'], 'AwayTeam': r['AwayTeam']}
        for c in COLS[5:]:
            v = r.get(MAP[c], '')
            if v != '' and c in INTS:
                v = str(int(float(v)))
            o[c] = v
        rows[s].append(o)
for s, rs in rows.items():
    code = f'{s % 100:02d}{(s + 1) % 100:02d}'
    with open(f'{out}/fd-{div}-{code}.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=COLS)
        w.writeheader()
        w.writerows(rs)
    print(code, len(rs))
