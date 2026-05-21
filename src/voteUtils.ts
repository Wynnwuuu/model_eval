import { VoteRecord } from './types';

export const isSkippedVote = (vote?: Pick<VoteRecord, 'choice'>) => vote?.choice === 'skipped';

export const getSkippedVoteCount = (votes: VoteRecord[] = []) =>
  votes.filter(isSkippedVote).length;

export const getEffectiveVotes = (votes: VoteRecord[] = []) =>
  votes.filter(vote => !isSkippedVote(vote));
