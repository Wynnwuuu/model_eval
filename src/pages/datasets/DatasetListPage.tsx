import React from 'react';
import DatasetRepositoryScreen from '../../components/DatasetRepositoryScreen';

type DatasetListPageProps = React.ComponentProps<typeof DatasetRepositoryScreen>;

export default function DatasetListPage(props: DatasetListPageProps) {
  return <DatasetRepositoryScreen {...props} />;
}
