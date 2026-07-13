import type { VoteRecord } from './types';

const SCORE_SCALE = 400 / Math.log(10);
const REGULARIZATION = 0.02;
const MAX_ITERATIONS = 80;

export interface BradleyTerryModelInput {
  id: string;
  name: string;
}

export interface BradleyTerryModelResult {
  modelId: string;
  modelName: string;
  rating: number;
  ratingLower: number;
  ratingUpper: number;
  standardError: number;
  rank: number;
  rankLower: number;
  rankUpper: number;
  battles: number;
  wins: number;
  losses: number;
  ties: number;
  component: number;
}

export interface BradleyTerryPairResult {
  pairId: string;
  modelAId: string;
  modelBId: string;
  modelAWins: number;
  modelBWins: number;
  ties: number;
  battles: number;
}

export interface BradleyTerryResult {
  models: BradleyTerryModelResult[];
  pairs: BradleyTerryPairResult[];
  connected: boolean;
  componentCount: number;
  effectiveSampleSize: number;
  totalBattles: number;
}

interface PreparedBattle {
  a: number;
  b: number;
  outcome: number;
  weight: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sigmoid = (value: number) => {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
};

const zeroMatrix = (size: number) => Array.from({ length: size }, () => Array(size).fill(0));

const solveLinearSystem = (matrix: number[][], vector: number[]) => {
  const size = vector.length;
  if (size === 0) return [];
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) augmented[pivot][column] = 1e-12;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map(row => row[size]);
};

const invertMatrix = (matrix: number[][]) => {
  const size = matrix.length;
  return Array.from({ length: size }, (_, column) =>
    solveLinearSystem(matrix, Array.from({ length: size }, (_unused, index) => index === column ? 1 : 0))
  ).map((column, columnIndex, columns) => columns.map(row => row[columnIndex]));
};

const multiplyMatrices = (left: number[][], right: number[][]) => {
  if (!left.length || !right.length) return [];
  return left.map(row => right[0].map((_unused, column) =>
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)
  ));
};

export const getBradleyTerryAnalysisWeight = (vote: VoteRecord) => {
  const probability = vote.pairContext?.samplingProbability;
  const eligiblePairCount = vote.pairContext?.eligiblePairCount;
  if (!probability || probability <= 0 || !eligiblePairCount || eligiblePairCount <= 0) return 1;
  return clamp((1 / eligiblePairCount) / probability, 0.25, 4);
};

const getComponents = (modelCount: number, battles: PreparedBattle[]) => {
  const adjacency = Array.from({ length: modelCount }, () => new Set<number>());
  battles.forEach(({ a, b }) => {
    adjacency[a].add(b);
    adjacency[b].add(a);
  });
  const components = Array(modelCount).fill(-1);
  let component = 0;
  for (let start = 0; start < modelCount; start += 1) {
    if (components[start] !== -1) continue;
    const queue = [start];
    components[start] = component;
    while (queue.length) {
      const current = queue.shift()!;
      adjacency[current].forEach(next => {
        if (components[next] !== -1) return;
        components[next] = component;
        queue.push(next);
      });
    }
    component += 1;
  }
  return { components, count: component };
};

const designValue = (modelIndex: number, parameterIndex: number, anchor: number) => {
  if (modelIndex === anchor) return 0;
  return modelIndex === parameterIndex ? 1 : 0;
};

export const calculateBradleyTerry = (
  votes: VoteRecord[],
  models: BradleyTerryModelInput[]
): BradleyTerryResult => {
  if (!models.length) {
    return { models: [], pairs: [], connected: false, componentCount: 0, effectiveSampleSize: 0, totalBattles: 0 };
  }
  const modelIndex = new Map(models.map((model, index) => [model.id, index]));
  const rawBattles = votes.flatMap(vote => {
    const context = vote.pairContext;
    const outcome = vote.vote || vote.choice;
    const a = context ? modelIndex.get(context.modelAId) : undefined;
    const b = context ? modelIndex.get(context.modelBId) : undefined;
    if (a === undefined || b === undefined || a === b || !['A', 'B', 'Tie'].includes(String(outcome))) return [];
    return [{
      a,
      b,
      outcome: outcome === 'A' ? 1 : outcome === 'B' ? 0 : 0.5,
      weight: getBradleyTerryAnalysisWeight(vote),
    }];
  });
  const weightMean = rawBattles.length
    ? rawBattles.reduce((sum, battle) => sum + battle.weight, 0) / rawBattles.length
    : 1;
  const battles = rawBattles.map(battle => ({ ...battle, weight: battle.weight / weightMean }));
  const { components, count: componentCount } = getComponents(models.length, battles);
  const anchor = models.length - 1;
  const parameterCount = models.length - 1;
  const regularization = zeroMatrix(parameterCount);
  for (let row = 0; row < parameterCount; row += 1) {
    for (let column = 0; column < parameterCount; column += 1) {
      regularization[row][column] = REGULARIZATION * ((row === column ? 1 : 0) - 1 / models.length);
    }
  }
  let beta = Array(parameterCount).fill(0);
  let information = zeroMatrix(parameterCount);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const gradient = Array(parameterCount).fill(0);
    information = zeroMatrix(parameterCount);
    battles.forEach(battle => {
      const valueA = battle.a === anchor ? 0 : beta[battle.a];
      const valueB = battle.b === anchor ? 0 : beta[battle.b];
      const probability = sigmoid(valueA - valueB);
      const variance = Math.max(probability * (1 - probability), 1e-8);
      for (let row = 0; row < parameterCount; row += 1) {
        const xRow = designValue(battle.a, row, anchor) - designValue(battle.b, row, anchor);
        if (!xRow) continue;
        gradient[row] += battle.weight * (battle.outcome - probability) * xRow;
        for (let column = 0; column < parameterCount; column += 1) {
          const xColumn = designValue(battle.a, column, anchor) - designValue(battle.b, column, anchor);
          information[row][column] += battle.weight * variance * xRow * xColumn;
        }
      }
    });
    for (let row = 0; row < parameterCount; row += 1) {
      for (let column = 0; column < parameterCount; column += 1) {
        gradient[row] -= regularization[row][column] * beta[column];
        information[row][column] += regularization[row][column];
      }
    }
    const step = solveLinearSystem(information, gradient).map(value => clamp(value, -2, 2));
    beta = beta.map((value, index) => value + step[index]);
    if (!step.length || Math.max(...step.map(Math.abs)) < 1e-8) break;
  }

  const bread = invertMatrix(information);
  const meat = zeroMatrix(parameterCount);
  battles.forEach(battle => {
    const probability = sigmoid((battle.a === anchor ? 0 : beta[battle.a]) - (battle.b === anchor ? 0 : beta[battle.b]));
    const residual = battle.weight * (battle.outcome - probability);
    for (let row = 0; row < parameterCount; row += 1) {
      const xRow = designValue(battle.a, row, anchor) - designValue(battle.b, row, anchor);
      for (let column = 0; column < parameterCount; column += 1) {
        const xColumn = designValue(battle.a, column, anchor) - designValue(battle.b, column, anchor);
        meat[row][column] += residual * residual * xRow * xColumn;
      }
    }
  });
  for (let row = 0; row < parameterCount; row += 1) {
    for (let column = 0; column < parameterCount; column += 1) {
      // Treat the weak symmetric prior as a pseudo-observation so tiny samples
      // do not produce falsely precise sandwich intervals under separation.
      meat[row][column] += regularization[row][column];
    }
  }
  const covariance = multiplyMatrices(multiplyMatrices(bread, meat), bread);
  const rawScores = [...beta, 0];
  const scoreMean = rawScores.reduce((sum, value) => sum + value, 0) / rawScores.length;
  const centered = rawScores.map(value => value - scoreMean);
  const modelCounts = models.map(() => ({ battles: 0, wins: 0, losses: 0, ties: 0 }));
  const pairCounts = new Map<string, BradleyTerryPairResult>();
  battles.forEach(battle => {
    modelCounts[battle.a].battles += 1;
    modelCounts[battle.b].battles += 1;
    if (battle.outcome === 1) {
      modelCounts[battle.a].wins += 1;
      modelCounts[battle.b].losses += 1;
    } else if (battle.outcome === 0) {
      modelCounts[battle.b].wins += 1;
      modelCounts[battle.a].losses += 1;
    } else {
      modelCounts[battle.a].ties += 1;
      modelCounts[battle.b].ties += 1;
    }
    const low = Math.min(battle.a, battle.b);
    const high = Math.max(battle.a, battle.b);
    const key = `${models[low].id}::${models[high].id}`;
    const pair = pairCounts.get(key) || {
      pairId: key,
      modelAId: models[low].id,
      modelBId: models[high].id,
      modelAWins: 0,
      modelBWins: 0,
      ties: 0,
      battles: 0,
    };
    pair.battles += 1;
    if (battle.outcome === 0.5) pair.ties += 1;
    else if ((battle.outcome === 1 && battle.a === low) || (battle.outcome === 0 && battle.b === low)) pair.modelAWins += 1;
    else pair.modelBWins += 1;
    pairCounts.set(key, pair);
  });

  const centeredVariance = models.map((_model, index) => {
    if (models.length === 1) return 0;
    const coefficients = Array(parameterCount).fill(-1 / models.length);
    if (index !== anchor) coefficients[index] += 1;
    let variance = 0;
    for (let row = 0; row < parameterCount; row += 1) {
      for (let column = 0; column < parameterCount; column += 1) {
        variance += coefficients[row] * (covariance[row]?.[column] || 0) * coefficients[column];
      }
    }
    return Math.max(variance, 0);
  });
  const unsorted = models.map((model, index) => {
    const standardError = Math.sqrt(centeredVariance[index]) * SCORE_SCALE;
    const rating = 1000 + centered[index] * SCORE_SCALE;
    return {
      modelId: model.id,
      modelName: model.name,
      rating,
      ratingLower: rating - 1.96 * standardError,
      ratingUpper: rating + 1.96 * standardError,
      standardError,
      rank: 0,
      rankLower: 0,
      rankUpper: 0,
      ...modelCounts[index],
      component: components[index],
    };
  });
  const sorted = [...unsorted].sort((left, right) => right.rating - left.rating || left.modelName.localeCompare(right.modelName));
  sorted.forEach((model, index) => {
    model.rank = index + 1;
    model.rankLower = 1 + unsorted.filter(other => other.modelId !== model.modelId && other.ratingLower > model.ratingUpper).length;
    model.rankUpper = 1 + unsorted.filter(other => other.modelId !== model.modelId && other.ratingUpper > model.ratingLower).length;
  });
  const sumWeights = battles.reduce((sum, battle) => sum + battle.weight, 0);
  const sumSquaredWeights = battles.reduce((sum, battle) => sum + battle.weight * battle.weight, 0);
  return {
    models: sorted,
    pairs: [...pairCounts.values()],
    connected: componentCount === 1,
    componentCount,
    effectiveSampleSize: sumSquaredWeights ? (sumWeights * sumWeights) / sumSquaredWeights : 0,
    totalBattles: battles.length,
  };
};

export const getExpectedInformationGain = (
  result: BradleyTerryResult,
  modelAId: string,
  modelBId: string
) => {
  const modelA = result.models.find(model => model.modelId === modelAId);
  const modelB = result.models.find(model => model.modelId === modelBId);
  if (!modelA || !modelB) return 1;
  const uncertainty = modelA.standardError * modelA.standardError + modelB.standardError * modelB.standardError;
  const ratingGap = Math.abs(modelA.rating - modelB.rating);
  const closeness = 1 / (1 + ratingGap / 400);
  return (Number.isFinite(uncertainty) ? uncertainty : 1) * closeness + 1 / (1 + modelA.battles + modelB.battles);
};
