import React from 'react';
import AnalysisScreen from '../../components/AnalysisScreen';

type InsightDashboardPageProps = React.ComponentProps<typeof AnalysisScreen>;

export default function InsightDashboardPage(props: InsightDashboardPageProps) {
  return <AnalysisScreen {...props} />;
}
