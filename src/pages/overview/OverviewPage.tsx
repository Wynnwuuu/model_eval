import React from 'react';
import OverviewScreen from '../../components/OverviewScreen';

type OverviewPageProps = React.ComponentProps<typeof OverviewScreen>;

export default function OverviewPage(props: OverviewPageProps) {
  return <OverviewScreen {...props} />;
}
