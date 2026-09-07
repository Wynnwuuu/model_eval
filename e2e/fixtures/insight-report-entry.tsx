import React from 'react';
import { createRoot } from 'react-dom/client';
import ResultsInsightsScreen from '../../src/components/ResultsInsightsScreen';
import ScoreInsightsScreen from '../../src/components/ScoreInsightsScreen';
import { makeReportRequests, reportModels } from '../../scripts/fixtures/insightReportFixtures';
import '../../src/index.css';

const index = Number(new URLSearchParams(location.search).get('method') || '0');
const request = makeReportRequests()[index];
const bundle = request.bundle;
createRoot(document.getElementById('root')!).render(
  bundle.mode === 'ab' || bundle.mode === 'rank'
    ? <ResultsInsightsScreen mode={bundle.mode} items={request.items} votes={request.votes} models={reportModels}
      modelNames={bundle.mode === 'ab' ? bundle.models : undefined} exportContext={request.context} reportSkippedVotes={[]} />
    : <ScoreInsightsScreen mode={bundle.mode} items={request.items} votes={request.votes || []} models={reportModels}
      config={bundle.mode === 'score' ? bundle.config : undefined} exportContext={request.context} reportSkippedVotes={[]} />,
);
