import React from 'react';
import { DashboardScreen } from '../../components/DashboardScreen';

type ProjectListPageProps = React.ComponentProps<typeof DashboardScreen>;

export default function ProjectListPage(props: ProjectListPageProps) {
  return <DashboardScreen {...props} />;
}
