// The filter. Every filing is classified by rules, for free, before any model sees it.
// Order matters: the first rule that matches wins, so specific paperwork is caught before
// the broad words ("order", "acquisition", "appointment") can misfile it.
//
// tier 3 = material  (a card, enriched)
// tier 2 = glance    (one line)
// tier 1 = routine   (collapsed and counted)

const KMP = /chief executive|\bceo\b|\bcfo\b|chief financial|managing director|\bmd\b|chairman|chairperson|whole[- ]?time director|executive director|key managerial|\bkmp\b|independent director|\bdirector\b/;

const RULES = [
  // paperwork that borrows material-sounding words
  ['results', 1, /newspaper|advertisement/, 'Results advertisement'],
  ['earnings_call', 2, /transcript/, 'Call transcript'],
  ['earnings_call', 1, /earnings call|conference call|con-?call|audio|video recording|recording of/, 'Call notice'],
  ['results', 2, /investor presentation|results? presentation|presentation/, 'Investor deck'],
  ['investor_meetings', 1, /analyst|investor meet|institutional investor|investors? conference|schedule of meet/],
  ['results', 2, /(intimation|notice|prior intimation).{0,40}board meeting|board meeting.{0,60}(to consider|intimation|scheduled)/, 'Results date set'],
  ['results', 3, /financial result|unaudited|audited (standalone|consolidated|financial)|results? for the (quarter|half|year|period)|integrated filing.{0,20}financ|outcome of board meeting.{0,200}result/],
  ['unclassified', 1, /esop|esos|esps|employee stock|stock option|trading window|loss of share|duplicate share|share certificate|compliance certificate|certificate under|regulation 74|investor grievance|brsr|sustainability report|\besg\b|statutory auditor|secretarial audit|change in auditor|appointment of .*auditor|registrar|transfer agent|change of address|monitoring agency|cost auditor|internal auditor/],
  ['press_release', 2, /bagging|receiv(ed|ing|es) (of )?(an? )?(new |work |purchase )?orders?|order win|letter of (award|intent|acceptance)|contract (award|win)|secur(ed|es|ing) .{0,40}(order|contract)|new orders?/, 'Order win'],
  ['pledging', 3, /pledge|encumbr/],
  ['insider_trading', 2, /insider|\bsast\b|takeover|regulation 29|regulation 7\(|substantial acquisition of shares|promoter.{0,40}(sold|purchas|acquir|bought|dispos)/],
  ['management_change', 0, /resign|appoint|cessation|retire|step(ping|s|ped)? down|change in (director|management|key managerial|kmp|senior management)|demise|superannuat/],
  ['M&A', 3, /acqui|merger|amalgamat|demerger|joint venture|scheme of arrangement|slump sale|divest|disinvest|stake (sale|purchase)|sale of (stake|shares|subsidiar|business|undertaking)|incorporation of|wholly[- ]owned subsidiary|open offer/],
  ['fund_raise', 2, /commercial paper|debenture|\bncd|\bbonds?\b/, 'Debt issue'],
  ['fund_raise', 3, /\bqip\b|qualified institution|preferential|warrants?|rights issue|buy-?back|fund rais|raising of funds|issue of securities|allotment of (equity|securities|shares)/],
  ['litigation', 2, /tax demand|gst|income tax|customs|assessment order|demand order/, 'Tax order'],
  ['litigation', 3, /litigation|penalt|\bfine\b|show cause|orders? passed|action\(?s?\)? (taken|initiated)|insolvency|nclt|\bsebi order|dispute|search and seizure|fraud|default|arbitration|court/],
  ['credit_rating', 0, /credit rating|\brating\b/],
  ['bonus_split', 3, /bonus|stock split|sub-?division/],
  ['dividend', 2, /dividend|record date/],
  ['capex', 3, /capex|capital expenditure|capacity (expansion|addition)|new plant|greenfield|brownfield|commission(ed|ing)|expansion/],
  ['postal_ballot', 1, /postal ballot/],
  ['agm_egm', 1, /\bagm\b|\begm\b|annual general|extra-?ordinary general|shareholders? meeting|voting result|scrutini[sz]er|proceedings/],
  ['results', 2, /outcome of board meeting|board meeting/, 'Board outcome'],
  ['press_release', 2, /press release|media release|clarification|rumou?r|launch|partnership|agreement|\bmou\b|spurt in volume|price movement|collaborat/],
  ['press_release', 1, /update|general|intimation|disclosure/],
];

export const CATEGORY_LABEL = {
  results: 'Results', 'M&A': 'M&A', fund_raise: 'Fund raise', management_change: 'Management',
  litigation: 'Legal', insider_trading: 'Insider', earnings_call: 'Earnings call',
  investor_meetings: 'Investor meetings', credit_rating: 'Credit rating', dividend: 'Dividend',
  bonus_split: 'Bonus / split', capex: 'Capex', press_release: 'Company news',
  postal_ballot: 'Postal ballot', agm_egm: 'AGM / EGM', pledging: 'Pledge', unclassified: 'Paperwork',
};

export function classify(f) {
  const text = `${f.title} ${f.summary}`.toLowerCase();
  for (const [category, tier, re, tag] of RULES) {
    if (!re.test(text)) continue;
    let t = tier;
    // two categories whose weight depends on who or which way
    if (category === 'management_change') t = KMP.test(text) ? 3 : 2;
    if (category === 'credit_rating') t = /upgrad|downgrad|revis|watch|placed|withdraw/.test(text) ? 3 : 2;
    return { category, tier: t, tag: tag || null };
  }
  return { category: 'unclassified', tier: 1, tag: null };
}

/** "X Limited has informed the Exchange regarding ..." -> the part a person would say out loud. */
export function headline(f) {
  let s = f.summary || f.title;
  s = s.replace(/^.*?has (informed|submitted to) the exchange,?\s*(regarding|about|that)?\s*/i, '')
    .replace(/^(a |the )?(copy of|intimation (of|regarding|for)|disclosure (of|under))\s*/i, '')
    .replace(/\s*(\.{2,}|…)\s*$/, '…').replace(/\s+/g, ' ').trim();
  if (s.length < 12) s = f.title;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
