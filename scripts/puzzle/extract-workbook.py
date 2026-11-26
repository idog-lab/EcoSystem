# Pulls the Puzzle model's inputs and the workbook's own computed values (the
# cached results Excel saved) into one JSON file for parity tests.
import openpyxl, json, sys, datetime
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
def grid(ws, rng):
    return [[c.value for c in row] for row in ws[rng]]
def norm(v):
    if isinstance(v, datetime.datetime): return v.isoformat()
    return v
def g(ws, rng): return [[norm(v) for v in r] for r in grid(ws, rng)]
P = wb['Puzzle']; R = wb['Puzzle - Rewards']; PC = wb['Puzzle - Pieces Cost']; CFG = wb['Puzzle - Config']
RS = wb['Puzzle - RC Simulator']; RN = wb['RC config new']; RG = wb['RC Segments Generator']
M = wb['Maleficent']; MC = wb['Maleficent - Config']; MRC = wb['Maleficent RC - Config']; CC = wb['Puzzle CC Management']
F = {}
F['puzzle_inputs'] = {
  'structure_rows_cols_rate': g(P, 'A2:G7'),
  'R3_R11': g(P, 'Q3:T12'), 'R18': norm(P['R18'].value), 'R21_22': g(P, 'R21:R22'),
  'dr_per_day': g(P, 'AG2:AM16'),
  'mode_multipliers_BA3_BD5': g(P, 'BA3:BD5'), 'AZ24': P['AZ24'].value,
  'segments_AZ10_BN18': g(P, 'AZ10:BN18'),
}
F['puzzle_expected'] = {
  'structure_A2_O7': g(P, 'A2:O7'), 'inflation_V2_AC16': g(P, 'V2:AC16'), 'dr_per_day_AG2_AW16': g(P, 'AG2:AW16'),
  'R5': P['R5'].value, 'R6': P['R6'].value, 'R8': P['R8'].value, 'R9': P['R9'].value, 'R12': P['R12'].value,
  'shares_AZ21_BC22': g(P, 'AZ21:BC22'),
  'dr_cost_by_segment_A13_D21': g(P, 'A13:D21'),
  'pieces_cost_A2_T88': g(PC, 'A2:T88'),
}
F['rewards_inputs'] = {
  'worth_A2_E10': g(R, 'A2:E10'), 'H1_H2': g(R, 'H1:H2'), 'boost_K1_K4': g(R, 'K1:K4'), 'price_cut_M1_N4': g(R, 'M1:N4'),
  'rows_A17_P95': g(R, 'A17:P95'),
}
F['rewards_expected'] = {
  'H3_H10': g(R, 'H3:H10'), 'rows_J17_U95': g(R, 'J17:U95'), 'S17_T95': g(R, 'S17:T95'), 'X2_Z7': g(R, 'X2:Z7'),
  'B2_B10': g(R, 'B2:B10'),
}
F['config_expected'] = {'D2_AA17': g(CFG, 'A2:AA17')}
F['rc_inputs'] = {'B5_B17': g(RS, 'A5:C17'), 'tiers_A19_Q22': g(RS, 'A19:Q22'), 'segments_A26_L37': g(RS, 'A26:L37')}
blocks = []
for n in range(11):
    r0 = 40 + 8 * n
    blocks.append(g(RS, f'A{r0}:Q{r0+6}'))
F['rc_expected_blocks'] = blocks
rcn = []
for n in range(11):
    r0 = 1 + 8 * n
    rcn.append(g(RN, f'A{r0}:AB{r0+6}'))
F['rc_config_new'] = rcn
F['rc_segments_generator'] = {'A3_B7': g(RG, 'A3:B7'), 'A12_E20': g(RG, 'A12:E20'), 'A24_C35': g(RG, 'A24:C35')}
F['maleficent'] = {
  'B1_B4': g(M, 'A1:B4'), 'tiers_E3_G9': g(M, 'E3:G9'), 'J3': M['J3'].value, 'rc_tiers_L3_N6': g(M, 'L3:N6'),
  'results_B12_L66': g(M, 'B12:L66'), 'rc_results_B70_L103': g(M, 'B70:L103'),
  'buckets_O12_P35': g(M, 'O12:P35'), 'wedges_O38_Q45': g(M, 'O38:Q45'),
  'spins_T12_W27': g(M, 'T12:W27'), 'spins_AA12_AD32': g(M, 'AA12:AD32'), 'spins_AH12_AK37': g(M, 'AH12:AK37'),
  'spins_AO12_AR42': g(M, 'AO12:AR42'), 'spins_AV12_AY47': g(M, 'AV12:AY47'),
  'boss_T37_Y48': g(M, 'T37:Y48'),
}
F['maleficent_config'] = g(MC, 'A1:AH17')
F['maleficent_rc_config'] = g(MRC, 'A1:BH14')
F['cc'] = {
  'A2_F2': g(CC, 'A2:F2'), 'pace_A4_E19': g(CC, 'A4:E19'), 'states_G4_H9': g(CC, 'G4:H9'),
  'bands_A66_E69': g(CC, 'A66:E69'), 'thresholds_A71_K86': g(CC, 'A71:K86'),
  'presets_S4_Y72': g(CC, 'S4:Y72'), 'ladder_S98_T101': g(CC, 'S98:T101'),
}
json.dump(F, open(out, 'w'), indent=None, default=str)
print('ok', len(json.dumps(F, default=str)))
