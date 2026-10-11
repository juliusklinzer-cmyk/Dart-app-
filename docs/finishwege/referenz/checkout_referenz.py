#!/usr/bin/env python3
"""
checkout_referenz.py

Referenz-Implementierung der Darts Checkout Engine (Steeldart, Double Out).
Mit dem Profil "Fortgeschritten" (Streuung 12 mm, Lieblingsdoppel mit 20 % weniger
Streuung) erzeugt sie exakt die Tabellen aus darts-finish-wege.md.

Sie ist die Vorlage für die Portierung nach JavaScript. Maßgeblich sind die Regeln in
loesen() und die Kalibrierung unten. Laufzeit ist hier egal, in der App nicht.

Aufruf:
  python3 checkout_referenz.py fixtures
      schreibt checkout_fixtures.json: Tabellen der Referenzprofile (identisch mit der MD),
      Average-Tabelle und Kalibrier-Beispiele als Testdaten für die JS-Version.
  python3 checkout_referenz.py profil profil.json
      rechnet eine persönliche Tabelle für ein Profil (Format siehe Profil unten).

Benötigt: Python 3.9 oder neuer, numpy.
"""

import json
import math
import re
import sys
from dataclasses import dataclass, field, asdict, replace

import numpy as np

# ============================================================================
# 1. Board (Steeldart, Maße in mm nach Regelwerk)
# ============================================================================

ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]  # im Uhrzeigersinn ab oben
R_BULL, R_25, R_T_IN, R_T_OUT, R_D_IN, R_D_OUT = 6.35, 15.9, 99.0, 107.0, 162.0, 170.0

# Ergebnis-Indizes: 0 daneben, 1..20 Single, 21..40 Doppel, 41..60 Triple, 61 = 25, 62 = Bull (50, zählt als Doppel)
NO = 63
VAL = np.zeros(NO, dtype=int)
DBL = np.zeros(NO, dtype=bool)
for _n in range(1, 21):
    VAL[_n] = _n
    VAL[20 + _n] = 2 * _n
    DBL[20 + _n] = True
    VAL[40 + _n] = 3 * _n
VAL[61] = 25
VAL[62] = 50
DBL[62] = True


def ergebnis(x, y):
    """Ergebnis-Index für Trefferpunkte (x nach rechts, y nach oben, Ursprung Bull)."""
    r = np.hypot(x, y)
    phi = (90.0 - np.degrees(np.arctan2(y, x))) % 360.0
    idx = np.floor((phi + 9.0) / 18.0).astype(int) % 20
    num = np.array(ORDER)[idx]
    o = num.copy()
    o = np.where((r > R_T_IN) & (r <= R_T_OUT), 40 + num, o)
    o = np.where((r > R_D_IN) & (r <= R_D_OUT), 20 + num, o)
    o = np.where(r > R_D_OUT, 0, o)
    o = np.where(r <= R_25, 61, o)
    o = np.where(r <= R_BULL, 62, o)
    return o


def _winkel(n):
    return math.radians(90 - 18 * ORDER.index(n))


# ============================================================================
# 2. Zielpunkte (81): Triple, Doppel, Single außen, Single innen, Zentrum
# ============================================================================

AIMS = []  # (label, art, zahl, x, y)
for _n in range(1, 21):
    _a = _winkel(_n)
    AIMS.append((f"T{_n}", "T", _n, 103 * math.cos(_a), 103 * math.sin(_a)))
for _n in range(1, 21):
    _a = _winkel(_n)
    AIMS.append((f"D{_n}", "D", _n, 166 * math.cos(_a), 166 * math.sin(_a)))
for _n in range(1, 21):
    _a = _winkel(_n)
    AIMS.append((f"SO{_n}", "S", _n, 134.5 * math.cos(_a), 134.5 * math.sin(_a)))
for _n in range(1, 21):
    _a = _winkel(_n)
    AIMS.append((f"SI{_n}", "S", _n, 57.5 * math.cos(_a), 57.5 * math.sin(_a)))
AIMS.append(("C", "C", 25, 0.0, 0.0))  # Zentrum: Ziel für Bull und 25
NA = len(AIMS)
AIM_IDX = {a[0]: i for i, a in enumerate(AIMS)}
C_IDX = AIM_IDX["C"]
NONCENTER = np.array([a[1] != "C" for a in AIMS])

# ============================================================================
# 3. Spielerprofil
# ============================================================================


@dataclass(frozen=True)
class Profil:
    sigma_x: float = 12.0        # waagrechte Streuung in mm (Grundwert, gilt für T20, T19 und Singles)
    sigma_y: float = 12.0        # senkrechte Streuung in mm
    f_triple: float = 1.0        # Streuungsfaktor für Triples außer T20 und T19
    f_doppel: float = 1.0        # Streuungsfaktor für Doppel (Nicht-Favoriten)
    f_bull: float = 1.0          # Streuungsfaktor für das Zentrum (Bull und 25)
    favoriten: tuple = ()        # Doppel-Zahlen der Lieblingsgruppe(n), 25 steht für Bull
    f_fav: float = 0.8           # Favoriten streuen um diesen Faktor weniger (zusätzlich zu f_doppel bzw. f_bull)
    ziel: str = "aufnahmen"      # "aufnahmen" (im Schnitt am schnellsten) oder "checkout" (maximale Chance jetzt)


REFERENZ = Profil()  # "Fortgeschritten", 77,5er Average, ohne Favorit

# Halbierungsketten für die Auswahl der Lieblingsgruppe
GRUPPEN = {
    "D20": (20, 10, 5),
    "D16": (16, 8, 4, 2, 1),
    "D18": (18, 9),
    "D12": (12, 6, 3),
    "D14": (14, 7),
    "Bull": (25,),
}

# ============================================================================
# 4. Trefferbild: Wahrscheinlichkeit jedes Ergebnisses je Zielpunkt
# ============================================================================

SEED = 20261011
N_SAMPLES = 1_000_000
_Z = None


def _z(n=N_SAMPLES):
    global _Z
    if _Z is None:
        _Z = np.random.default_rng(SEED).standard_normal((N_SAMPLES, 2))
    return _Z[:n]


def verteilung(x, y, sx, sy, n=N_SAMPLES):
    """Ergebnis-Verteilung für einen Wurf auf (x, y) mit Normalstreuung sx, sy (Monte Carlo, fester Seed)."""
    Z = _z(n)
    o = ergebnis(x + sx * Z[:, 0], y + sy * Z[:, 1])
    return np.bincount(o, minlength=NO) / n


def faktor(profil, aim):
    lab, art, n, x, y = aim
    if art == "T":
        return 1.0 if n in (19, 20) else profil.f_triple
    if art == "D":
        return profil.f_doppel * (profil.f_fav if n in profil.favoriten else 1.0)
    if art == "C":
        return profil.f_bull * (profil.f_fav if 25 in profil.favoriten else 1.0)
    return 1.0


def trefferbild(profil, n=N_SAMPLES):
    P = np.zeros((NA, NO))
    for i, aim in enumerate(AIMS):
        f = faktor(profil, aim)
        P[i] = verteilung(aim[3], aim[4], profil.sigma_x * f, profil.sigma_y * f, n)
    return P


# ============================================================================
# 5. Wege, Finish-Modus und erlaubte Zielpunkte (hängt nicht vom Spieler ab)
# ============================================================================

SETUP = []  # (label, wert, zielpunkte)
for _n in range(1, 21):
    SETUP.append((str(_n), _n, [AIM_IDX[f"SO{_n}"], AIM_IDX[f"SI{_n}"]]))
for _n in range(1, 21):
    SETUP.append((f"T{_n}", 3 * _n, [AIM_IDX[f"T{_n}"]]))
SETUP.append(("25", 25, [C_IDX]))
SETUP.append(("Bull", 50, [C_IDX]))
FIN = []  # (label, wert, zielpunkte, ist_bull)
for _n in range(1, 21):
    FIN.append((f"D{_n}", 2 * _n, [AIM_IDX[f"D{_n}"]], False))
FIN.append(("Bull", 50, [C_IDX], True))

ROUTES = [[[] for _ in range(4)] for _ in range(171)]  # ROUTES[rest][darts] = [(darts, endet_auf_bull)]
for _f in FIN:
    ROUTES[_f[1]][1].append(((_f,), _f[3]))
for _s in SETUP:
    for _f in FIN:
        if _s[1] + _f[1] <= 170:
            ROUTES[_s[1] + _f[1]][2].append(((_s, _f), _f[3]))
for _s1 in SETUP:
    for _s2 in SETUP:
        for _f in FIN:
            if _s1[1] + _s2[1] + _f[1] <= 170:
                ROUTES[_s1[1] + _s2[1] + _f[1]][3].append(((_s1, _s2, _f), _f[3]))


def k_min(r):
    """Minimale Dartzahl ohne Bull-Finish (kNB) und mit Bull-Finish (kB)."""
    kNB = next((k for k in (1, 2, 3) if any(not b for _, b in ROUTES[r][k])), None)
    kB = next((k for k in (1, 2, 3) if any(b for _, b in ROUTES[r][k])), None)
    return kNB, kB


def finishbar(r, d):
    if r < 2 or r > 170 or d <= 0:
        return False
    return any(len(ROUTES[r][k]) > 0 for k in range(1, d + 1))


# MODE[d, s] = 1: Finish möglich (nur erste Darts minimaler Wege erlaubt), 0: Stellmodus
# Regel 1 (hart): wenigste Darts. Bull als Schlussdoppel nur, wenn es einen Dart spart oder der einzige Weg ist.
MODE = np.zeros((4, 171), dtype=int)
MASK = np.zeros((4, 171, NA), dtype=bool)
FIRST = [[set() for _ in range(171)] for _ in range(4)]
for _r in range(2, 171):
    _kNB, _kB = k_min(_r)
    for _d in (1, 2, 3):
        _allowed = set()
        if _kNB is not None and _kNB <= _d:
            for _darts, _b in ROUTES[_r][_kNB]:
                if not _b:
                    _allowed.update(_darts[0][2])
                    FIRST[_d][_r].add(_darts[0][0])
            for _k in range(1, _kNB):
                for _darts, _b in ROUTES[_r][_k]:
                    if _b:
                        _allowed.update(_darts[0][2])
                        FIRST[_d][_r].add(_darts[0][0])
            MODE[_d, _r] = 1
        elif _kB is not None and _kB <= _d:
            for _darts, _b in ROUTES[_r][_kB]:
                if _b:
                    _allowed.update(_darts[0][2])
                    FIRST[_d][_r].add(_darts[0][0])
            MODE[_d, _r] = 1
        else:
            # Stellmodus: jedes Single, Triple oder Zentrum, das nicht überwirft und mindestens 2 übrig lässt
            for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
                if _art == "S" and _n <= _r - 2:
                    _allowed.add(_i)
                elif _art == "T" and 3 * _n <= _r - 2:
                    _allowed.add(_i)
                elif _art == "C" and 25 <= _r - 2:
                    _allowed.add(_i)
            MODE[_d, _r] = 0
        MASK[_d, _r, list(_allowed)] = True

# Feinregeln (Werte in Aufnahmen)
BULL_DELTA = 0.02     # Regel 7: Zentrum nur, wenn mindestens so viel besser
EPS_FAV = 0.02        # Regel 3: Weg auf einen Favoriten gewinnt, wenn höchstens so viel schlechter
EPS_STD = 0.01        # Standardweg bleibt, wenn höchstens so viel schlechter (nur mit Favoriten)
BOGEY_MALUS = 0.01    # Triple, dessen Single-Fehlwurf mit 2 Darts kein Finish mehr lässt (nur bei 3 Darts)
FIRST_DART_PEN = 0.01  # ab Rest 100 erster Dart T20 oder T19, außer ein anderes Triple ist klar besser

PEN = np.zeros(NA)  # winziger Gleichstandsbrecher zu vertrauten Zielen
for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
    if _art == "T":
        PEN[_i] = 0.0 if _n == 20 else 0.0005 if _n == 19 else 0.001 if _n in (16, 17, 18) else 0.0015
    elif _lab.startswith("SI"):
        PEN[_i] = 0.0002

BMAL = np.zeros((171, NA))
for _r in range(2, 171):
    if MODE[3, _r] == 1:
        for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
            if _art == "T" and MASK[3, _r, _i] and not finishbar(_r - _n, 2):
                BMAL[_r, _i] = BOGEY_MALUS

FPEN = np.zeros((171, NA))
for _r in range(100, 171):
    for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
        if _art == "T" and _n not in (19, 20):
            FPEN[_r, _i] = FIRST_DART_PEN

# Beabsichtigter Wert jedes Zielpunkts je Zustand (für Wegdarstellung und Favoriten-Regel)
VINT = np.zeros((4, 171, NA), dtype=int)
FINAIM = np.zeros((4, 171, NA), dtype=bool)
ENDCODE_AIM = np.zeros(NA, dtype=int)  # Doppelzahl bzw. 25 für Bull
for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
    ENDCODE_AIM[_i] = _n if _art == "D" else (25 if _art == "C" else 0)
for _d in (1, 2, 3):
    for _s in range(2, 171):
        for _i, (_lab, _art, _n, _x, _y) in enumerate(AIMS):
            if _art == "T":
                VINT[_d, _s, _i] = 3 * _n
            elif _art == "S":
                VINT[_d, _s, _i] = _n
            elif _art == "D":
                VINT[_d, _s, _i] = 2 * _n
                FINAIM[_d, _s, _i] = (2 * _n == _s)
            else:
                if _s == 50:
                    VINT[_d, _s, _i] = 50
                    FINAIM[_d, _s, _i] = True
                elif MODE[_d, _s] == 1 and "25" not in FIRST[_d][_s]:
                    VINT[_d, _s, _i] = 50
                else:
                    VINT[_d, _s, _i] = 25

# ============================================================================
# 6. Lösung: erwartete Aufnahmen bis zum Finish minimieren
# ============================================================================


@dataclass
class Loesung:
    P: np.ndarray
    F: np.ndarray      # F[S]: erwartete Aufnahmen ab Rest S (mit 3 Darts), inklusive der aktuellen
    POL: dict          # POL[S][d, s]: Zielpunkt im Zustand (Rest s, d Darts) einer Aufnahme, die bei S begann
    GA: dict           # Wert eines Zustands = GA[S][d, s] + GB[S][d, s] * F[S]
    GB: dict           # (GB ist die Wahrscheinlichkeit, auf S zurückzufallen: Bust oder nichts gepunktet)


def loesen(P, favoriten=(), pol_std=None, maxS=170):
    """
    Für jeden Startrest S einer Aufnahme (aufsteigend) wird F[S] per Fixpunkt bestimmt,
    weil ein Bust auf S zurückführt. In jedem Zustand (s, d) wird der Zielpunkt so gewählt:
      eff = erwartete weitere Aufnahmen + PEN + (bei 3 Darts: BMAL + FPEN) + BULL_DELTA für das Zentrum
      best0 = Minimum von eff über die erlaubten Zielpunkte (MASK)
      Favoriten: Zielpunkte, deren beabsichtigter Weg auf einem Favoriten endet und deren eff höchstens
                 EPS_FAV über best0 liegt, bilden die Kandidaten. Das Zentrum zählt nur, wenn best0 schon
                 das Zentrum ist. Gibt es keinen solchen Kandidaten, sind alle erlaubten Zielpunkte Kandidaten.
      best1 = Minimum von eff über die Kandidaten
      Standard: liegt der Zielpunkt des Profils ohne Favoriten unter den Kandidaten und höchstens EPS_STD
                über best1, bleibt er.
    """
    favset = np.array(sorted(set(favoriten)), dtype=int)
    F = np.zeros(maxS + 1)
    POL, GAs, GBs = {}, {}, {}
    PT = P.T
    for S in range(2, maxS + 1):
        Fg = F[S - 1] + 0.3 if S > 2 else 4.0
        for _ in range(200):
            GA = np.zeros((4, S + 1))
            GB = np.zeros((4, S + 1))
            GA[0, 2:S] = F[2:S]   # Aufnahme vorbei: nächste Aufnahme ab dem Rest
            GB[0, S] = 1.0        # nichts gepunktet: wieder ab S
            pol = np.full((4, S + 1), -1, dtype=int)
            endc = np.zeros((4, S + 1), dtype=int)
            s_arr = np.arange(2, S + 1)
            rr = np.arange(len(s_arr))
            for d in (1, 2, 3):
                sp = s_arr[:, None] - VAL[None, :]
                fin = (sp == 0) & DBL[None, :]
                bust = (sp < 0) | (sp == 1) | ((sp == 0) & ~DBL[None, :])
                ok = ~(fin | bust)
                spc = np.clip(sp, 0, S)
                A = np.where(ok, GA[d - 1][spc], 0.0)
                B = np.where(ok, GB[d - 1][spc], 0.0) + bust.astype(float)
                EA = A @ PT
                EB = B @ PT
                tot = EA + EB * Fg
                m = MASK[d, 2:S + 1]
                eff = tot + PEN[None, :] + (BMAL[2:S + 1] + FPEN[2:S + 1] if d == 3 else 0.0) \
                    + BULL_DELTA * (~NONCENTER)[None, :]
                eff = np.where(m, eff, np.inf)
                best0 = np.argmin(eff, axis=1)
                beff = eff[rr, best0]
                vint = VINT[d, 2:S + 1]
                finm = FINAIM[d, 2:S + 1]
                nxt = np.clip(s_arr[:, None] - vint, 0, S)
                aim_end = np.where(finm, ENDCODE_AIM[None, :], endc[d - 1][nxt])
                aim_end = np.where((s_arr[:, None] - vint >= 2) | finm, aim_end, 0)
                if len(favset):
                    centre_ok = (best0 == C_IDX)[:, None] | NONCENTER[None, :]
                    favok = m & centre_ok & np.isin(aim_end, favset) & (eff <= beff[:, None] + EPS_FAV)
                    anyfav = favok.any(axis=1)
                else:
                    favok = np.zeros_like(m)
                    anyfav = np.zeros(len(s_arr), dtype=bool)
                cand = np.where(anyfav[:, None], favok, m)
                best1 = np.argmin(np.where(cand, eff, np.inf), axis=1)
                choice = best1
                if pol_std is not None:
                    sa = np.clip(pol_std[S][d, 2:S + 1], 0, NA - 1)
                    sa_ok = cand[rr, sa] & (eff[rr, sa] <= eff[rr, best1] + EPS_STD)
                    choice = np.where(sa_ok, sa, choice)
                best = choice
                GA[d, 2:S + 1] = EA[rr, best]
                GB[d, 2:S + 1] = EB[rr, best]
                pol[d, 2:S + 1] = best
                bv = VINT[d, 2:S + 1][rr, best]
                bf = FINAIM[d, 2:S + 1][rr, best]
                nx = s_arr - bv
                e_next = np.where(nx >= 2, endc[d - 1][np.clip(nx, 0, S)], 0)
                endc[d, 2:S + 1] = np.where(bf, ENDCODE_AIM[best], np.where(MODE[d, 2:S + 1] == 1, e_next, 0))
            Fnew = (1.0 + GA[3, S]) / (1.0 - GB[3, S])
            if abs(Fnew - Fg) < 1e-12:
                Fg = Fnew
                break
            Fg = Fnew
        F[S] = Fg
        POL[S], GAs[S], GBs[S] = pol, GA, GB
    return Loesung(P, F, POL, GAs, GBs)


def beabsichtigt(a, s, d):
    """Label, Wert und ob der Dart finisht, wenn der Zielpunkt a wie geplant getroffen wird."""
    lab, art, n, x, y = AIMS[a]
    if art == "T":
        return f"T{n}", 3 * n, False
    if art == "S":
        return str(n), n, False
    if art == "D":
        return f"D{n}", 2 * n, True
    if s == 50:
        return "Bull", 50, True
    if MODE[d, s] == 1 and "25" not in FIRST[d][s]:
        return "Bull", 50, False
    return "25", 25, False


def weg(L, r, d, S=None, pol=None):
    """Weg ab Rest r mit d Darts (Aufnahme begann bei S). Rückgabe: (Darts, Rest danach; 0 = Finish)."""
    S = r if S is None else S
    pol = L.POL[S] if pol is None else pol
    steps = []
    while d > 0 and r > 0:
        lab, v, fz = beabsichtigt(pol[d, r], r, d)
        steps.append(lab)
        r -= v
        d -= 1
        if fz:
            return steps, 0
    return steps, r


def tabelle(L, pol_von=None):
    """Tabelle wie in der MD: 3, 2, 1 Dart und Plan B (Single statt Triple bzw. 25 statt Bull)."""
    out = {}
    for r in range(2, 171):
        pol3 = pol_von(r) if pol_von else None
        s3, r3 = weg(L, r, 3, pol=pol3)
        s2, r2 = weg(L, r, 2, pol=pol3)
        s1, r1 = weg(L, r, 1, pol=pol3)
        plan_b = None
        pol = pol3 if pol3 is not None else L.POL[r]
        first = AIMS[pol[3, r]]
        if first[1] == "T" and r - first[2] >= 2:
            rb = r - first[2]
            sb, restb = weg(L, rb, 2, S=r, pol=pol)
            plan_b = {"single": str(first[2]), "rest": rb, "weg": sb, "bleibt": restb}
        elif first[1] == "C" and s3[0] == "Bull" and r != 50 and r - 25 >= 2:
            rb = r - 25
            sb, restb = weg(L, rb, 2, S=r, pol=pol)
            plan_b = {"single": "25", "rest": rb, "weg": sb, "bleibt": restb}
        out[r] = {"3": {"weg": s3, "bleibt": r3}, "2": {"weg": s2, "bleibt": r2},
                  "1": {"weg": s1, "bleibt": r1}, "planB": plan_b}
    return out


# ============================================================================
# 7. Zielvariante "checkout": maximale Chance, in dieser Aufnahme auszuchecken
# ============================================================================


def checkout_politik(L, tol=0.0005):
    """Pro Startrest S eine Politik, die die Checkout-Chance der Aufnahme maximiert.
    Gleichstände (innerhalb tol) entscheidet der Aufnahmen-Wert wie in loesen()."""
    P = L.P
    pf = np.zeros((4, 171))
    for d in (1, 2, 3):
        for s in range(2, 171):
            sp = s - VAL
            fin = (sp == 0) & DBL
            ok = sp >= 2
            v = P[:, fin].sum(1) + (P[:, ok] * pf[d - 1][sp[ok]]).sum(1)
            pf[d, s] = np.where(MASK[d, s], v, -1.0).max()

    def pol_fuer(S):
        pol = np.full((4, S + 1), -1, dtype=int)
        for d in (1, 2, 3):
            for s in range(2, S + 1):
                sp = s - VAL
                fin = (sp == 0) & DBL
                ok = sp >= 2
                pcv = P[:, fin].sum(1) + (P[:, ok] * pf[d - 1][sp[ok]]).sum(1)
                bust = (sp < 0) | (sp == 1) | ((sp == 0) & ~DBL)
                okk = ~(fin | bust)
                spc = np.clip(sp, 0, S)
                A = np.where(okk, L.GA[S][d - 1][spc], 0.0)
                B = np.where(okk, L.GB[S][d - 1][spc], 0.0) + bust
                eff = P @ A + (P @ B) * L.F[S] + PEN + (BMAL[s] + FPEN[s] if d == 3 else 0.0) \
                    + BULL_DELTA * (~NONCENTER)
                m = MASK[d, s]
                best = np.where(m, pcv, -1).max()
                cand = m & (pcv >= best - tol)
                pol[d, s] = int(np.argmin(np.where(cand, eff, np.inf)))
        return pol

    return pol_fuer


# ============================================================================
# 8. Wege bewerten (für eigene Einträge und die Top-3-Auswahl)
# ============================================================================


def _token_aims(t):
    if t in ("Bull", "25"):
        return [C_IDX]
    if t[0] in "TD":
        return [AIM_IDX[t]]
    return [AIM_IDX[f"SO{t}"], AIM_IDX[f"SI{t}"]]


def _token_wert(t):
    if t == "Bull":
        return 50
    if t == "25":
        return 25
    if t[0] == "T":
        return 3 * int(t[1:])
    if t[0] == "D":
        return 2 * int(t[1:])
    return int(t)


def weg_bewerten(L, r, d, tokens):
    """
    Bewertet einen Weg als Plan: Solange die Darts wie geplant fallen, wird der Plan weitergeworfen,
    nach einem Fehlwurf übernimmt die berechnete Politik. Rückgabe: (erwartete weitere Aufnahmen nach
    dieser, Checkout-Chance in dieser Aufnahme). Kleinere Aufnahmen-Werte sind besser.
    """
    S = r
    P, F, GA, GB = L.P, L.F, L.GA[S], L.GB[S]
    pol = L.POL[S]
    pf = np.zeros((4, S + 1))
    for dd in (1, 2, 3):
        for s in range(2, S + 1):
            p = P[pol[dd, s]]
            sp = s - VAL
            fin = (sp == 0) & DBL
            ok = sp >= 2
            pf[dd, s] = p[fin].sum() + (p[ok] * pf[dd - 1][sp[ok]]).sum()

    def V(s, dd):
        return GA[dd][s] + GB[dd][s] * F[S]

    best = None
    vals = [_token_wert(t) for t in tokens]
    for combo in _kombis([_token_aims(t) for t in tokens]):
        def rec(s, dd, k):
            if k is None or k >= len(combo):
                return V(s, dd), (pf[dd][s] if dd > 0 else 0.0)
            p = P[combo[k]]
            ev = pc = 0.0
            for o in np.nonzero(p)[0]:
                pr = p[o]
                spo = s - VAL[o]
                if spo == 0 and DBL[o]:
                    pc += pr
                elif spo < 2:
                    ev += pr * F[S]
                elif dd - 1 == 0:
                    ev += pr * V(spo, 0)
                else:
                    nk = k + 1 if VAL[o] == vals[k] else None
                    e2, c2 = rec(spo, dd - 1, nk)
                    ev += pr * e2
                    pc += pr * c2
            return ev, pc
        res = rec(r, d, 0)
        if best is None or res[0] < best[0]:
            best = res
    return best


def _kombis(listen):
    if not listen:
        yield []
        return
    for a in listen[0]:
        for rest in _kombis(listen[1:]):
            yield [a] + rest


def alternativen(L, r, d, k=3):
    """Die k besten unterschiedlichen Wege für (r, d): [(weg, bleibt, aufnahmen, checkout_chance)]."""
    res, seen = [], set()
    for a in np.nonzero(MASK[d, r])[0]:
        lab, v, fz = beabsichtigt(a, r, d)
        if fz:
            steps, rest = [lab], 0
        else:
            s2, rest = weg(L, r - v, d - 1, S=r) if d > 1 else ([], r - v)
            steps = [lab] + s2
        key = " ".join(steps)
        if key in seen:
            continue
        seen.add(key)
        ev, pc = weg_bewerten(L, r, d, steps)
        res.append((steps, rest, ev, pc))
    res.sort(key=lambda t: t[2])
    return res[:k]


def token_gueltig(t):
    """Erlaubte Felder: 1 bis 20 (Single), T1 bis T20, D1 bis D20, 25, Bull."""
    if t in ("25", "Bull"):
        return True
    m = re.fullmatch(r"([TD]?)([1-9]|1[0-9]|20)", t)
    return m is not None


def weg_pruefen(r, d, tokens):
    """Harte Prüfung eines eigenen Eintrags. Rückgabe: (ok, fehler, warnungen)."""
    fehler, warn = [], []
    ungueltig = [t for t in tokens if not token_gueltig(t)]
    if ungueltig:
        return False, [f"unbekanntes Feld {', '.join(ungueltig)}"], []
    if not 1 <= len(tokens) <= d:
        fehler.append("zu viele Darts")
    rest = r
    for i, t in enumerate(tokens):
        rest -= _token_wert(t)
        letzter = i == len(tokens) - 1
        if rest < 0 or rest == 1 or (rest == 0 and not letzter):
            fehler.append("überworfen")
            break
    if not fehler:
        if rest == 0 and not (tokens[-1] == "Bull" or tokens[-1].startswith("D")):
            fehler.append("letzter Dart muss ein Doppel oder Bull sein")
        if rest > 0 and finishbar(r, d):
            warn.append("kein Finish, obwohl eins möglich ist")
        kNB, kB = k_min(r)
        kmin = min(k for k in (kNB, kB) if k is not None) if (kNB or kB) else None
        if rest == 0 and kmin and len(tokens) > kmin:
            warn.append(f"ein Dart mehr als nötig (möglich mit {kmin})")
    return not fehler, fehler, warn


def weg_vergleich(L, r, d, tokens):
    """Eigener Weg gegen den berechneten besten Weg. 'deutlich_schlechter' löst in der App einen Hinweis aus."""
    best_steps, _ = weg(L, r, d)
    e_best, c_best = weg_bewerten(L, r, d, best_steps)
    e_own, c_own = weg_bewerten(L, r, d, tokens)
    delta = float(e_own - e_best)
    return {"bester_weg": best_steps, "checkout_bester": float(c_best), "checkout_eigen": float(c_own),
            "mehr_aufnahmen": delta,
            "deutlich_schlechter": bool(delta > 0.05 or (c_best - c_own) > 0.03)}


# ============================================================================
# 9. Kalibrierung: Average und Wurftests in Profilwerte umrechnen
# ============================================================================

KAL_N = 100_000      # Stichproben je Verteilung in der Kalibrierung
PRIOR_SD = 0.25      # Vertrauen in den Ausgangswert: Faktor etwa ±25 % (log-normal)
SIGMA_MIN, SIGMA_MAX = 4.0, 30.0   # unter etwa 41er Average trägt das Modell nicht mehr: dann 30 mm

T20 = AIMS[AIM_IDX["T20"]]


def average_modell(sx, sy, n=KAL_N):
    p = verteilung(T20[3], T20[4], sx, sy, n)
    return 3.0 * float((p * VAL).sum())


def sigma_aus_average(avg, q=1.0):
    """Waagrechte Streuung sx (mit sy = q * sx), bei der das Modell den Average erreicht."""
    lo, hi = SIGMA_MIN, SIGMA_MAX
    if avg >= average_modell(lo, q * lo):
        return lo
    if avg <= average_modell(hi, q * hi):
        return hi
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if average_modell(mid, q * mid) > avg:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def _idx_single(n): return n
def _idx_double(n): return 20 + n
def _idx_triple(n): return 40 + n


def _nachbarn(n):
    i = ORDER.index(n)
    return ORDER[i - 1], ORDER[(i + 1) % 20]


def kategorien(test, ziel=None):
    """Ergebnis-Indizes je Zähl-Button. Was nicht aufgeführt ist, zählt als 'sonst'."""
    if test == "t20":
        return {"treffer": [60], "s20": [20, 40], "eins": [1, 21, 41], "fuenf": [5, 25, 45]}
    if test == "doppel":
        a, b = _nachbarn(ziel)
        return {"treffer": [_idx_double(ziel)], "innen": [_idx_single(ziel), _idx_triple(ziel)], "aussen": [0],
                f"nachbar_{a}": [a, 20 + a, 40 + a], f"nachbar_{b}": [b, 20 + b, 40 + b]}
    if test == "bull":
        return {"bull": [62], "25": [61]}
    if test == "triple":
        a, b = _nachbarn(ziel)
        return {"treffer": [_idx_triple(ziel)], "single": [_idx_single(ziel), _idx_double(ziel)],
                "nachbar": [a, 20 + a, 40 + a, b, 20 + b, 40 + b]}
    raise ValueError(test)


def _loglik(p, kats, zaehler):
    ll, rest_p = 0.0, 1.0
    for name, idx in kats.items():
        pk = float(p[idx].sum())
        rest_p -= pk
        ll += zaehler.get(name, 0) * math.log(max(pk, 1e-6))
    ll += zaehler.get("sonst", 0) * math.log(max(rest_p, 1e-6))
    return ll


def _prior(f, f0):
    return -(math.log(f / f0) ** 2) / (2 * PRIOR_SD ** 2)


def fit_streuung(avg, t20_zaehler=None):
    """Average legt die Gesamtstreuung fest, der T20-Test das Verhältnis senkrecht zu waagrecht."""
    if not t20_zaehler:
        s = sigma_aus_average(avg)
        return s, s
    kats = kategorien("t20")
    best = None
    for q in np.exp(np.linspace(math.log(0.6), math.log(1.0 / 0.6), 21)):
        sx = sigma_aus_average(avg, q)
        p = verteilung(T20[3], T20[4], sx, q * sx, KAL_N)
        score = _loglik(p, kats, t20_zaehler) + _prior(q, 1.0)
        if best is None or score > best[0]:
            best = (score, sx, q * sx)
    return best[1], best[2]


def _fit_faktor(x, y, sx, sy, kats, zaehler, f0):
    best = None
    for f in np.exp(np.linspace(math.log(0.4), math.log(2.5), 41)):
        p = verteilung(x, y, sx * f, sy * f, KAL_N)
        score = _loglik(p, kats, zaehler) + _prior(f, f0)
        if best is None or score > best[0]:
            best = (score, float(f))
    return best[1]


def profil_aus_tests(avg, favoriten=(), t20=None, doppel=None, bull=None, triple=None, ziel="aufnahmen"):
    """
    avg: 3-Dart-Average. favoriten: Doppel-Zahlen der Lieblingsgruppe(n), 25 = Bull.
    t20:    {"treffer", "s20", "eins", "fuenf", "sonst"}
    doppel: {"ziel": 16, "treffer", "innen", "aussen", "nachbar_7", "nachbar_8", "sonst"}
    bull:   {"bull", "25", "sonst"}
    triple: {"ziel": 16, "treffer", "single", "nachbar", "sonst"}
    Jeder Test ist optional. Ohne Test bleibt der Ausgangswert (wie in der MD).
    """
    favoriten = tuple(favoriten)
    sx, sy = fit_streuung(avg, t20)
    f_doppel, f_fav, f_bull, f_triple = 1.0, 0.8, 1.0, 1.0
    if doppel:
        z = doppel["ziel"]
        aim = AIMS[AIM_IDX[f"D{z}"]]
        ist_fav = z in favoriten
        g = _fit_faktor(aim[3], aim[4], sx, sy, kategorien("doppel", z), doppel, 0.8 if ist_fav else 1.0)
        f_doppel = g / 0.8 if ist_fav else g
    if bull:
        f0 = 0.8 if 25 in favoriten else 1.0
        g = _fit_faktor(0.0, 0.0, sx, sy, kategorien("bull"), bull, f0)
        f_bull = g / 0.8 if 25 in favoriten else g
    if triple:
        z = triple["ziel"]
        aim = AIMS[AIM_IDX[f"T{z}"]]
        if z not in (19, 20):
            f_triple = _fit_faktor(aim[3], aim[4], sx, sy, kategorien("triple", z), triple, 1.0)
    return Profil(sigma_x=round(float(sx), 3), sigma_y=round(float(sy), 3), f_triple=round(float(f_triple), 3),
                  f_doppel=round(float(f_doppel), 3), f_bull=round(float(f_bull), 3), favoriten=favoriten,
                  f_fav=f_fav, ziel=ziel)


# ============================================================================
# 10. Komplettlauf für ein Profil
# ============================================================================


def tabellen_fuer_profil(profil):
    """Wie die App rechnen soll: erst ohne Favoriten (Standard), dann mit Favoriten und Standard-Bindung."""
    P_std = trefferbild(replace(profil, favoriten=()))
    L_std = loesen(P_std)
    if profil.favoriten:
        P = trefferbild(profil)
        L = loesen(P, favoriten=profil.favoriten, pol_std=L_std.POL)
    else:
        L = L_std
    tab_aufnahmen = tabelle(L)
    pol_cp = checkout_politik(L)
    tab_checkout = tabelle(L, pol_von=pol_cp)
    return L, tab_aufnahmen, tab_checkout


def _fixtures():
    out = {"beschreibung": "Referenzdaten aus checkout_referenz.py. 'tabellen' ist identisch mit darts-finish-wege.md.",
           "profile": {}, "tabellen": {}, "tabellen_checkout": {}, "average_tabelle": [], "kalibrierung": []}
    P0 = trefferbild(REFERENZ)
    L0 = loesen(P0)
    out["profile"]["standard"] = asdict(REFERENZ)
    out["tabellen"]["standard"] = tabelle(L0)
    out["tabellen_checkout"]["standard"] = tabelle(L0, pol_von=checkout_politik(L0))
    for fav in (16, 20, 18, 12, 8, 10, 14, 6, 4):
        prof = replace(REFERENZ, favoriten=(fav,))
        P = trefferbild(prof)
        L = loesen(P, favoriten=prof.favoriten, pol_std=L0.POL)
        out["profile"][f"D{fav}"] = asdict(prof)
        out["tabellen"][f"D{fav}"] = tabelle(L)
        print(f"D{fav} fertig", file=sys.stderr, flush=True)
    for s in (6, 8, 10, 12, 14, 16, 18, 20, 23, 26, 30):
        out["average_tabelle"].append({"sigma_mm": s, "average": round(average_modell(s, s, N_SAMPLES), 2)})
    # Testfälle für Wegbewertung (Standardprofil): Aufnahmen nach dieser und Checkout-Chance in dieser Aufnahme
    out["weg_bewertung"] = []
    for r, d, toks in ((127, 3, ["T19", "T18", "D8"]), (127, 3, ["T20", "T17", "D8"]), (82, 3, ["Bull", "D16"]),
                       (82, 3, ["T14", "D20"]), (99, 3, ["T19", "10", "D16"]), (70, 2, ["T20", "D5"]),
                       (61, 3, ["25", "D18"]), (61, 3, ["T15", "D8"])):
        ev, pc = weg_bewerten(L0, r, d, toks)
        out["weg_bewertung"].append({"rest": r, "darts": d, "weg": toks,
                                     "aufnahmen_danach": round(float(ev), 5), "checkout": round(float(pc), 5)})
    out["alternativen"] = {}
    for r, d in ((82, 3), (127, 3), (70, 2), (99, 3), (61, 3)):
        out["alternativen"][f"{r}_{d}"] = [
            {"weg": s, "bleibt": int(b), "aufnahmen_danach": round(float(e), 5), "checkout": round(float(p), 5)}
            for s, b, e, p in alternativen(L0, r, d)]
    beispiele = [
        dict(avg=77.5),
        dict(avg=60.0, favoriten=GRUPPEN["D16"][:4], t20={"treffer": 1, "s20": 6, "eins": 1, "fuenf": 2},
             doppel={"ziel": 16, "treffer": 2, "innen": 4, "aussen": 3, "nachbar_7": 0, "nachbar_8": 1},
             bull={"bull": 1, "25": 3, "sonst": 6}),
        dict(avg=85.0, favoriten=GRUPPEN["D20"], t20={"treffer": 3, "s20": 3, "eins": 2, "fuenf": 2},
             doppel={"ziel": 20, "treffer": 4, "innen": 3, "aussen": 2, "nachbar_1": 1},
             bull={"bull": 3, "25": 5, "sonst": 2}, triple={"ziel": 16, "treffer": 2, "single": 7, "nachbar": 1}),
        dict(avg=45.0, bull={"bull": 0, "25": 1, "sonst": 9}),
    ]
    for b in beispiele:
        prof = profil_aus_tests(**b)
        out["kalibrierung"].append({"eingabe": b, "profil": asdict(prof)})
    return out


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "fixtures":
        data = _fixtures()
        with open("checkout_fixtures.json", "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
        print("checkout_fixtures.json geschrieben")
    elif len(sys.argv) >= 3 and sys.argv[1] == "profil":
        cfg = json.load(open(sys.argv[2], encoding="utf-8"))
        prof = Profil(**{**cfg, "favoriten": tuple(cfg.get("favoriten", ()))})
        L, t_a, t_c = tabellen_fuer_profil(prof)
        json.dump({"profil": asdict(prof), "tabelle": t_a, "tabelle_checkout": t_c}, sys.stdout,
                  ensure_ascii=False, indent=1)
    else:
        print(__doc__)
