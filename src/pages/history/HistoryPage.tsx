import React from 'react';
import HistoryScreen from '../../components/HistoryScreen';

type HistoryPageProps = React.ComponentProps<typeof HistoryScreen>;

export default function HistoryPage(props: HistoryPageProps) {
  return <HistoryScreen {...props} />;
}
