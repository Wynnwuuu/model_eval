import assert from 'node:assert/strict';
import {
  calculateArenaRankModelStats,
  calculateRankPairwiseStats,
  calculateRankingAgreement,
  formatConsensusRanking,
  formatRanking,
  getArenaRankModelOutputUrl,
  getRankingEntryMetrics,
  getRankingTieSummary,
  normalizeRanking,
  rankingToTiers,
  tiersToRankingEntries,
  validateRanking,
} from '../src/rankingUtils';
import { buildRankInsights, buildRankPairwiseCsv } from '../src/analysisInsights';
import type { RankingEntry, VoteRecord } from '../src/types';

const entry = (modelId: string, rank: number): RankingEntry => ({
  modelId,
  modelName: modelId.toUpperCase(),
  rank,
});

const vote = (itemId: string, ranking: RankingEntry[], user = 'reviewer'): VoteRecord => ({
  itemId,
  method: 'rank_order',
  ranking,
  timestamp: 1,
  user,
});

const strict = [entry('a', 1), entry('b', 2), entry('c', 3), entry('d', 4)];
const multipleTies = [entry('a', 1), entry('b', 1), entry('c', 3), entry('d', 3)];
const allTied = [entry('a', 1), entry('b', 1), entry('c', 1), entry('d', 1)];

assert.deepEqual(
  normalizeRanking([entry('a', 1), entry('b', 1), entry('c', 2), entry('d', 3)]).map(item => item.rank),
  [1, 1, 3, 4],
  'non-standard tied ranks should normalize to competition ranks',
);
assert.deepEqual(
  normalizeRanking([entry('a', 1), entry('a', 2), entry('b', 3)]).map(item => item.modelId),
  ['a', 'b'],
  'duplicate models should be removed deterministically',
);
assert.equal(validateRanking([entry('a', 1), entry('a', 2), entry('b', 3)]).valid, false);
assert.equal(validateRanking(strict, ['a', 'b', 'c', 'd']).valid, true);
assert.equal(validateRanking(strict.slice(0, 3), ['a', 'b', 'c', 'd']).valid, false);

const tiers = rankingToTiers(multipleTies);
assert.deepEqual(tiers.map(tier => ({ rank: tier.rank, size: tier.size, midRank: tier.midRank })), [
  { rank: 1, size: 2, midRank: 1.5 },
  { rank: 3, size: 2, midRank: 3.5 },
]);
assert.deepEqual(
  tiersToRankingEntries(tiers.map(tier => tier.entries)).map(item => item.rank),
  [1, 1, 3, 3],
  'tier serialization should preserve multiple independent tie groups',
);
assert.equal(formatRanking(multipleTies), 'A = B > C = D');

const tiedMetrics = multipleTies.map(item => getRankingEntryMetrics(multipleTies, item.modelId));
assert.deepEqual(tiedMetrics.map(metric => metric?.bordaScore), [3.5, 3.5, 1.5, 1.5]);
assert.deepEqual(tiedMetrics.map(metric => metric?.midRank), [1.5, 1.5, 3.5, 3.5]);
assert.equal(tiedMetrics.reduce((sum, metric) => sum + (metric?.bordaScore || 0), 0), 10, 'ties must preserve the ballot Borda total');
assert.deepEqual(
  strict.map(item => getRankingEntryMetrics(strict, item.modelId)?.bordaScore),
  [4, 3, 2, 1],
  'legacy strict rankings should retain their previous Borda scores',
);
assert.deepEqual(
  allTied.map(item => getRankingEntryMetrics(allTied, item.modelId)?.bordaScore),
  [2.5, 2.5, 2.5, 2.5],
  'all-tied ballots should split all occupied Borda positions evenly',
);
assert.deepEqual(allTied.map(item => getRankingEntryMetrics(allTied, item.modelId)?.normalizedBorda), [0.5, 0.5, 0.5, 0.5]);
assert.equal(getArenaRankModelOutputUrl({ id: 'case-1', modelOutputs: [] }, entry('missing', 1)), '', 'missing model output must remain a clean empty URL');

const tieSummary = getRankingTieSummary(multipleTies);
assert.equal(tieSummary.hasTie, true);
assert.equal(tieSummary.allTied, false);
assert.equal(tieSummary.tieGroupCount, 2);
assert.equal(tieSummary.topTieSize, 2);
assert.equal(tieSummary.distinctionRate, 4 / 6);
assert.equal(getRankingTieSummary(allTied).distinctionRate, 0);

const stats = calculateArenaRankModelStats([vote('case-1', multipleTies)]);
assert.deepEqual(stats.map(model => model.totalScore), [3.5, 3.5, 1.5, 1.5]);
assert.equal(stats[0].coFirstCount, 1);
assert.equal(stats[0].outrightFirstCount, 0);
assert.equal(stats[0].firstPlaceCredit, 0.5);
assert.equal(stats[0].normalizedScore, 5 / 6);
assert.equal(formatConsensusRanking(stats), 'A = B > C = D');

const models = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }));
const allTiePairwise = calculateRankPairwiseStats([vote('case-1', allTied)], models);
assert.equal(allTiePairwise.length, 6);
allTiePairwise.forEach(pair => {
  assert.equal(pair.ties, 1);
  assert.equal(pair.total, 1);
  assert.equal(pair.decisiveTotal, 0);
  assert.equal(pair.dominanceScore, 0.5);
  assert.equal(pair.aWins + pair.ties + pair.bWins, pair.total);
});

const allTieInsights = buildRankInsights({
  items: [{ id: 'case-1' }],
  votes: [vote('case-1', allTied)],
  models,
});
assert.equal(allTieInsights.summary.tieBallotRate, 1);
assert.equal(allTieInsights.summary.allTieBallotRate, 1);
assert.equal(allTieInsights.summary.averageDistinctionRate, 0);
assert.equal(allTieInsights.summary.averageRelationAgreement, null, 'one ballot has no cross-reviewer agreement estimate');
allTieInsights.pairwise.forEach(pair => {
  assert.equal(pair.pValue, null, 'all-tie relations must not produce significance');
  assert.equal(pair.confidenceInterval.lower, 0);
  assert.equal(pair.confidenceInterval.upper, 0, 'CI is represented as unavailable when no decisive relation exists');
});
const pairwiseCsv = buildRankPairwiseCsv(allTieInsights);
assert.match(pairwiseCsv, /Wins_A,Ties,Wins_B/);
assert.match(pairwiseCsv, /"0","1","0","1","0","0\.5000","0\.5000","1\.0000","","",""/);

const mixedPairwise = calculateRankPairwiseStats([
  vote('case-1', multipleTies, 'one'),
  vote('case-1', strict, 'two'),
], models);
const ab = mixedPairwise.find(pair => pair.modelAId === 'a' && pair.modelBId === 'b');
assert(ab);
assert.equal(ab.aWins, 1);
assert.equal(ab.ties, 1);
assert.equal(ab.bWins, 0);
assert.equal(ab.total, 2);
assert.equal(ab.decisiveTotal, 1);
assert.equal(ab.dominanceScore, 0.75);

const identicalTieAgreement = calculateRankingAgreement([multipleTies, multipleTies]);
assert.equal(identicalTieAgreement.relationAgreement, 1);
assert.equal(identicalTieAgreement.kendallTauB, 1);
assert.equal(identicalTieAgreement.distinctionRate, 4 / 6);

const allTieAgreement = calculateRankingAgreement([allTied, allTied]);
assert.equal(allTieAgreement.relationAgreement, 1);
assert.equal(allTieAgreement.kendallTauB, null);
assert.equal(allTieAgreement.distinctionRate, 0);

const opposite = [entry('d', 1), entry('c', 2), entry('b', 3), entry('a', 4)];
const oppositeAgreement = calculateRankingAgreement([strict, opposite]);
assert.equal(oppositeAgreement.relationAgreement, 0);
assert.equal(oppositeAgreement.kendallTauB, -1);

const roundTrip = JSON.parse(JSON.stringify(normalizeRanking(multipleTies))) as RankingEntry[];
assert.deepEqual(roundTrip, multipleTies, 'ranking_json should preserve duplicate rank values');

console.log('Arena-rank tie checks passed.');
